import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { APIGatewayProxyEventV2 } from "aws-lambda";

import { Pool } from "pg";

import { z } from "zod";

import { imageRouteVar } from "../helpers/constants";
import { projectIdValidator } from "../helpers/schemaValidator/validators";

const region = process.env.REGION!;

const dbHost = process.env.DB_HOST!;
const dbPort = process.env.DB_PORT!;
const dbSecretArn = process.env.DB_SECRET_ARN!;

const secretClient = new SecretsManagerClient({ region });

let pool: Pool | undefined;

export const handler = async (event: APIGatewayProxyEventV2) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Api-Key",
  };

  console.log(event);

  const pathParams = event.pathParameters;

  if (!pathParams || !pathParams.imageId || !pathParams.projectId) {
    return { statusCode: 400, body: "No image id" };
  }

  //validate the image id & projectId
  const { success, data } = z
    .object({
      projectId: projectIdValidator,
      imageId: z.string().uuid(),
    })
    .safeParse(pathParams);

  if (!success) {
    return { statusCode: 400, body: "Invalid imageId or projectId" };
  }

  const { imageId, projectId } = data;

  const imageKey = `${projectId}/${imageRouteVar}/${imageId}`;

  const apiKey = event.headers?.["x-api-key"];

  if (!apiKey) {
    return { statusCode: 400, body: JSON.stringify("Unauthorized"), headers };
  }

  if (!pool) {
    const secret = await secretClient.send(
      new GetSecretValueCommand({
        SecretId: dbSecretArn,
      })
    );

    const { username, password, dbname } = JSON.parse(secret.SecretString!);

    pool = new Pool({
      host: dbHost,
      user: username,
      password,
      database: dbname,
      port: Number(dbPort),
      ssl: { rejectUnauthorized: false },
    });
  }

  try {
    const query = {
      name: "fetch-processed-results",
      text: `
    SELECT i."originalImageUrl", i."results", i."createdAt"
    FROM "Images" i
    JOIN "Projects" p ON i."projectId" = p."id"
    WHERE i."id" = $1 AND p."apiKey" = $2
  `,
      values: [imageKey, apiKey],
    };

    const images = await pool.query(query);

    console.log("completed successfully");

    return { statusCode: 200, body: JSON.stringify(images.rows) };
  } catch (error: unknown) {
    console.log("FAILED TO GET USERS API KEYS FROM DB", error);

    return { statusCode: 500, body: "Internal server error" };
  }
};
