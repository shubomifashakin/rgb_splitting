import {
  APIGatewayEventRequestContextV2,
  APIGatewayProxyEventV2,
} from "aws-lambda";

import { Pool } from "pg";

const dbHost = process.env.DB_HOST!;
const dbUser = process.env.DB_USER!;
const dbName = process.env.DB_NAME!;
const dbPort = process.env.DB_PORT!;
const dbPassword = process.env.DB_PASSWORD!;

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
    pool = new Pool({
      host: dbHost,
      user: dbUser,
      password: dbPassword,
      database: dbName,
      port: Number(dbPort),
      ssl: { rejectUnauthorized: false },
    });
  }

  //TODO: PAGINATE THIS, ONLY 10 AT ONCE
  try {
    const keys = await pool.query(
      `SELECT id, "apiKey", "createdAt" , "projectName", "currentPlan" FROM "Projects" WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 10`,
      [userId]
    );

    console.log("completed successfully");

    return { statusCode: 200, body: JSON.stringify(keys.rows) };
  } catch (error: unknown) {
    console.log("FAILED TO GET USERS API KEYS FROM DB", error);

    return { statusCode: 500, body: "Internal server error" };
  }
};
