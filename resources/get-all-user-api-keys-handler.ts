import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import {
  APIGatewayEventRequestContextV2,
  APIGatewayProxyEventV2,
} from "aws-lambda";

import { Pool } from "pg";

const region = process.env.REGION!;

const dbHost = process.env.DB_HOST!;
const dbPort = process.env.DB_PORT!;
const dbSecretArn = process.env.DB_SECRET_ARN!;

const secretClient = new SecretsManagerClient({ region });

let pool: Pool | undefined;

interface CustomAPIGatewayEventV2 extends APIGatewayProxyEventV2 {
  requestContext: APIGatewayEventRequestContextV2 & {
    authorizer?: {
      principalId?: string;
    };
  };
}

export const handler = async (event: CustomAPIGatewayEventV2) => {
  console.log(event);

  if (!event.requestContext.authorizer) {
    return { statusCode: 400, body: "Unauthorized" };
  }

  const userId = event.requestContext.authorizer.principalId;

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

  //TODO: PAGINATE THIS, ONLY 10 AT ONCE
  try {
    const query = {
      // give the query a unique name
      name: "fetch-all-user-api-keys",
      text: `SELECT id, "apiKey", "createdAt" , "projectName", "currentPlan" FROM "Projects" WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 10`,
      values: [userId],
    };

    const keys = await pool.query(query);

    console.log("completed successfully");

    return { statusCode: 200, body: JSON.stringify(keys.rows) };
  } catch (error: unknown) {
    console.log("FAILED TO GET USERS API KEYS FROM DB", error);

    return { statusCode: 500, body: "Internal server error" };
  }
};
