import {
  APIGatewayProxyEventV2,
  APIGatewayEventRequestContextV2,
} from "aws-lambda";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  GetCommand,
  UpdateCommand,
  DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";

import {
  APIGatewayClient,
  UpdateApiKeyCommand,
} from "@aws-sdk/client-api-gateway";

import { ApiKeyInfo } from "../types/apiKeyInfo";

import { PROJECT_STATUS } from "../helpers/constants";
import { transformZodError } from "../helpers/fns/transformZodError";
import { projectIdValidator } from "../helpers/schemaValidator/projectIdValidator";
import { updateApiKey } from "../helpers/fns/updateApiKey";

const region = process.env.REGION!;
const tableName = process.env.TABLE_NAME!;

const client = new DynamoDBClient({ region });
const dynamo = DynamoDBDocumentClient.from(client);

const apiGatewayClient = new APIGatewayClient({ region });

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

  if (!event.body) {
    return { statusCode: 400, body: "Bad Request" };
  }

  const body = JSON.parse(event.body);

  if (!body.projectId) {
    return { statusCode: 400, body: "Bad Request -- No Project Id" };
  }

  const {
    success,
    error,
    data: projectId,
  } = projectIdValidator.safeParse(body.projectId);

  if (!success) {
    console.error(error);

    return { statusCode: 400, body: transformZodError(error) };
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

      return { statusCode: 404, body: "No Project Found" };
    }

    //get the apikey info
    const apiKeyInfo = usersApiKeys.Item.apiKeyInfo as ApiKeyInfo;

    console.log("disabling key");

    //disable the apikey
    await updateApiKey(apiGatewayClient, apiKeyInfo, "false");

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
      statusCode: 200,
      body: JSON.stringify({ message: "Successfully cancelled subscription" }),
    };
  } catch (error: unknown) {
    console.log("FAILED TO CANCEL USERS SUBSCRIPTION", error);

    throw error;
  }
};
