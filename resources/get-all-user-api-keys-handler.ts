import { APIGatewayProxyEventV2 } from "aws-lambda";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

const region = process.env.REGION;
const tableName = process.env.TABLE_NAME;

const client = new DynamoDBClient({ region });

const dynamo = DynamoDBDocumentClient.from(client);

export const handler = async (event: APIGatewayProxyEventV2) => {
  const pathParameters = event.pathParameters;

  if (!pathParameters) {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: "No user id provided" }),
    };
  }

  if (!pathParameters.userId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: "No user Id provided" }),
    };
  }

  //TODO: PAGINATE THIS, ONLY 10 AT ONCE
  try {
    const usersApiKeys = await dynamo.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "userId = :userId",
        ExpressionAttributeValues: {
          ":userId": pathParameters.userId,
        },
        Limit: 10,
        ScanIndexForward: false,
        ProjectionExpression: "createdAt, apiKeyInfo.apiKey, id, projectName",
      })
    );

    return { statusCode: 200, body: JSON.stringify(usersApiKeys.Items) };
  } catch (error: unknown) {
    console.log(
      "FAILED TO GET USERS API KEYS FROM DB",
      JSON.stringify({ context: "get-all-api-keys", error, date: new Date() })
    );

    return { statusCode: 500, body: "Internal server error" };
  }
};
