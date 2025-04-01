import {
  APIGatewayProxyEventV2,
  APIGatewayEventRequestContextV2,
} from "aws-lambda";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

const region = process.env.REGION;
const tableName = process.env.TABLE_NAME;

const client = new DynamoDBClient({ region });
const dynamo = DynamoDBDocumentClient.from(client);

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

  //TODO: PAGINATE THIS, ONLY 10 AT ONCE
  try {
    const usersApiKeys = await dynamo.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: "userIdIndex",
        KeyConditionExpression: "userId = :userId",
        ExpressionAttributeValues: {
          ":userId": userId,
        },
        Limit: 10,
        ScanIndexForward: false,
        ProjectionExpression:
          "createdAt, apiKey, projectId, projectName, currentPlan, sub_status",
      })
    );

    console.log("completed successfully");

    return { statusCode: 200, body: JSON.stringify(usersApiKeys.Items) };
  } catch (error: unknown) {
    console.log("FAILED TO GET USERS API KEYS FROM DB", error);

    throw error;
  }
};
