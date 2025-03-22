import {
  APIGatewayClient,
  CreateApiKeyCommand,
  CreateUsagePlanKeyCommand,
} from "@aws-sdk/client-api-gateway";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { APIGatewayProxyEventV2, Handler } from "aws-lambda";

import { Pool } from "pg";

import { v4 as uuid } from "uuid";

import { ApiKeyInfo } from "../types/apiKeyInfo";

const region = process.env.REGION!;

const dbHost = process.env.DB_HOST!;
const dbPort = process.env.DB_PORT!;
const dbSecretArn = process.env.DB_SECRET_ARN!;

const apiGatewayClient = new APIGatewayClient({
  region,
});

const secretClient = new SecretsManagerClient({
  region,
});

let pool: Pool | undefined;

export const handler: Handler = async (event: APIGatewayProxyEventV2) => {
  if (!event.body) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        message: "Bad Request - No body",
      }),
    };
  }

  //needs to contain the projectName, the userID

  if (!pool) {
    //fetch the database credentials from the secret manager
    const secret = await secretClient.send(
      new GetSecretValueCommand({
        SecretId: dbSecretArn,
      })
    );

    const { username, password, dbname } = JSON.parse(secret.SecretString!);

    pool = new Pool({
      host: dbHost,
      user: username,
      password: password,
      database: dbname,
      port: Number(dbPort),
      ssl: { rejectUnauthorized: false },
    });
  }

  const body = JSON.parse(event.body);

  console.log(body);

  try {
    const apiKey = await apiGatewayClient.send(
      new CreateApiKeyCommand({
        value: uuid(),
        name: `${body.projectName.replace(" ", "_")}_${body.userId}`,
        enabled: true,
        description: `This api key belongs to project: ${webHookEvent.meta_data.projectName} by user: ${webHookEvent.meta_data.userId} for RGBreak.`,
      })
    );

    if (!apiKey.id || !apiKey.value) {
      console.error(
        `Failed to create api key for project ${webHookEvent.meta_data.projectName} by user ${webHookEvent.meta_data.userId}`
      );

      throw new Error("Internal server error - failed to create api key");
    }

    //add the apikey generated to the usage plan
    await apiGatewayClient.send(
      new CreateUsagePlanKeyCommand({
        usagePlanId: webHookEvent.meta_data.usagePlanId,
        keyId: apiKey.id,
        keyType: "API_KEY",
      })
    );

    const apiKeyInfo = {
      apiKeyId: apiKey.id,
      usagePlanId: webHookEvent.meta_data.usagePlanId,
    } as ApiKeyInfo;

    const createProjectQueryText = `INSERT INTO "Projects"(id, "userId", "projectName", "apiKey", "apiKeyInfo", "createdAt") VALUES($1, $2, $3, $4, $5, $6) RETURNING id`;
    await pool.query(createProjectQueryText, [
      uuid(),
      body.userId,
      body.projectName,
      apiKey.value,
      apiKey.value,
      apiKeyInfo,
      cardInfo,
      Status.Active,
      new Date(eventData.created_at),
      getOneMonthFromNow(), //TODO: CHANGE TO ONE MONTH FROM NOW
      new Date(eventData.created_at),
    ]);

    console.log("completed successfully");

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Api key generated" }),
    };
  } catch (error: unknown) {
    console.error(error);

    //let it be caught by the alarm
    throw error;
  }
};
