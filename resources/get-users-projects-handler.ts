import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

import { AuthorizedApiGatewayEvent } from "../types/AuthorizedApiGateway";

const region = process.env.REGION;
const tableName = process.env.TABLE_NAME;

const client = new DynamoDBClient({ region });
const dynamo = DynamoDBDocumentClient.from(client);

export const handler = async (event: AuthorizedApiGatewayEvent) => {
  console.log(event);

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Api-Key",
  };

  if (!event.requestContext.authorizer) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Unauthorized" }),
      headers,
    };
  }

  const userId = event.requestContext.authorizer.principalId;

  const startKey = event.queryStringParameters?.query
    ? JSON.parse(decodeURIComponent(event.queryStringParameters.query))
    : undefined;

  console.log("start key --->", startKey);

  try {
    const usersApiKeys = await dynamo.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: "userIdIndex",
        KeyConditionExpression: "userId = :userId",
        ExpressionAttributeValues: {
          ":userId": userId,
        },
        Limit: 12,
        ScanIndexForward: false,
        ExclusiveStartKey: startKey,
        ProjectionExpression: "projectId, projectName, currentPlan, sub_status",
      })
    );

    console.log("completed successfully");

    return {
      statusCode: 200,
      body: JSON.stringify({
        projects: usersApiKeys.Items,
        nextKey: usersApiKeys.LastEvaluatedKey,
      }),
      headers,
    };
  } catch (error: unknown) {
    console.log("FAILED TO GET USERS API KEYS FROM DB", error);

    throw error;
  }
};
