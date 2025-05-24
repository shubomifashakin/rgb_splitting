import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  GetCommand,
  UpdateCommand,
  DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";

import { APIGatewayClient } from "@aws-sdk/client-api-gateway";

import { ApiKeyInfo } from "../types/apiKeyInfo";
import { AuthorizedApiGatewayEvent } from "../types/AuthorizedApiGateway";

import { PROJECT_STATUS } from "../helpers/constants";
import { transformZodError } from "../helpers/fns/transformZodError";
import { updateApiKeyStatus } from "../helpers/fns/updateApiKeyStatus";
import { projectIdValidator } from "../helpers/schemaValidator/projectIdValidator";

const region = process.env.REGION!;
const tableName = process.env.TABLE_NAME!;

const client = new DynamoDBClient({ region });
const dynamo = DynamoDBDocumentClient.from(client);

const apiGatewayClient = new APIGatewayClient({ region });

export const handler = async (event: AuthorizedApiGatewayEvent) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Api-Key",
  };

  console.log(event);

  if (!event.requestContext.authorizer) {
    return {
      headers,
      statusCode: 400,
      body: JSON.stringify({ message: "Unauthorized" }),
    };
  }

  const pathParams = event.pathParameters?.projectId;

  const {
    success,
    error,
    data: projectId,
  } = projectIdValidator.safeParse(pathParams);

  if (!success) {
    console.error(error);

    return { statusCode: 400, body: transformZodError(error), headers };
  }

  const userId = event.requestContext.authorizer.principalId;

  try {
    const usersApiKeys = await dynamo.send(
      new GetCommand({
        TableName: tableName,
        Key: {
          userId: userId,
          projectId: projectId,
        },
        ProjectionExpression: "apiKeyInfo",
      })
    );

    if (!usersApiKeys.Item) {
      console.log("Project not found");

      return {
        headers,
        statusCode: 404,
        body: JSON.stringify({ message: "Project not found" }),
      };
    }

    //get the apikey info
    const apiKeyInfo = usersApiKeys.Item.apiKeyInfo as ApiKeyInfo;

    console.log("disabling key");

    //disable the apikey
    await updateApiKeyStatus(apiGatewayClient, apiKeyInfo, "false");

    //update the status of the project
    await dynamo.send(
      new UpdateCommand({
        TableName: tableName,
        Key: {
          userId: userId,
          projectId: projectId,
        },
        ExpressionAttributeValues: {
          ":status": PROJECT_STATUS.Inactive,
        },
        UpdateExpression: "set sub_status = :status",
      })
    );

    console.log("completed successfully");

    return {
      headers,
      statusCode: 200,
      body: JSON.stringify({ message: "Successfully cancelled subscription" }),
    };
  } catch (error: unknown) {
    console.error("FAILED TO CANCEL USERS SUBSCRIPTION", error);

    throw error;
  }
};
