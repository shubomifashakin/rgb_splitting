import { APIGatewayProxyEventV2 } from "aws-lambda";

import { Pool } from "pg";

const dbHost = process.env.DB_HOST!;
const dbUser = process.env.DB_USER!;
const dbName = process.env.DB_NAME!;
const dbPort = process.env.DB_PORT!;
const dbPassword = process.env.DB_PASSWORD!;

let pool: Pool | undefined;

export const handler = async (event: APIGatewayProxyEventV2) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Api-Key",
  };

  console.log(event);

  const pathParams = event.pathParameters;

  if (!pathParams || !pathParams.imageId) {
    return { statusCode: 400, body: "No image id" };
  }

  const imageId = pathParams.imageId;
  console.log(imageId);

  const apiKey = event.headers?.["x-api-key"];

  if (!apiKey) {
    return { statusCode: 400, body: JSON.stringify("Unauthorized"), headers };
  }

  if (!pool) {
    pool = new Pool({
      host: dbHost,
      user: dbUser,
      password: dbPassword,
      database: dbName,
      port: Number(dbPort),
      ssl: { rejectUnauthorized: false },
    });
  }

  try {
    const images = await pool.query(
      `SELECT i."originalImageUrl", i."results", i."createdAt"
   FROM "Images" i
   JOIN "Projects" p ON i."projectId" = p."id"
   WHERE i."id" = $1 AND p."apiKey" = $2`,
      [imageId, apiKey]
    );

    console.log("completed successfully");

    return { statusCode: 200, body: JSON.stringify(images.rows) };
  } catch (error: unknown) {
    console.log("FAILED TO GET USERS API KEYS FROM DB", error);

    return { statusCode: 500, body: "Internal server error" };
  }
};
