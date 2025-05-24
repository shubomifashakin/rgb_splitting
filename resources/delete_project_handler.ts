import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";

import { z } from "zod";

import { transformZodError } from "../helpers/fns/transformZodError";
import { projectIdValidator } from "../helpers/schemaValidator/projectIdValidator";
import {
  APIGatewayClient,
  DeleteApiKeyCommand,
} from "@aws-sdk/client-api-gateway";
import { ApiKeyInfo } from "../types/apiKeyInfo";
import { AuthorizedApiGatewayEvent } from "../types/AuthorizedApiGateway";

const region = process.env.REGION;
const tableName = process.env.TABLE_NAME;

const client = new DynamoDBClient({ region });
const dynamo = DynamoDBDocumentClient.from(client);

const apiGatewayClient = new APIGatewayClient({ region });

export async function handler(event: AuthorizedApiGatewayEvent) {
  try {
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Api-Key",
    };

    console.log(event);

    const userId = event.requestContext.authorizer?.principalId;

    if (!userId) {
      return {
        headers,
        statusCode: 401,
        body: JSON.stringify({ message: "Unauthorized" }),
      };
    }

    const pathParams = event.pathParameters;

    const { success, data, error } = z
      .object({
        projectId: projectIdValidator,
      })
      .safeParse(pathParams);

    if (!success) {
      return {
        headers,
        statusCode: 400,
        body: transformZodError(error),
      };
    }

    console.log("User id -->", userId);
    console.log("Project id -->", data.projectId);

    //first of all fetch the projectInfo for the apiKey
    const apiKeyInfo = await dynamo.send(
      new GetCommand({
        TableName: tableName,
        Key: {
          userId,
          projectId: data.projectId,
        },
        ProjectionExpression: "apiKeyInfo",
      })
    );

    if (!apiKeyInfo.Item) {
      return {
        headers,
        statusCode: 404,
        body: JSON.stringify({ message: "Project not found" }),
      };
    }

    const apiKey = apiKeyInfo.Item.apiKeyInfo as ApiKeyInfo;

    //delete the project and the apikey
    await Promise.all([
      dynamo.send(
        new DeleteCommand({
          TableName: tableName,
          Key: {
            userId,
            projectId: data.projectId,
          },
        })
      ),
      apiGatewayClient.send(
        new DeleteApiKeyCommand({
          apiKey: apiKey.apiKeyId,
        })
      ),
    ]);

    console.log("completed successfully");

    return {
      headers,
      statusCode: 200,
      body: JSON.stringify({ message: "Success" }),
    };
  } catch (error) {
    console.error("Failed to delete project", error);
    console.error("User id:", event.requestContext.authorizer?.principalId);

    throw error;
  }
}
