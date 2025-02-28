import { APIGatewayProxyEventV2 } from "aws-lambda";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

import { allUserApiKeysPathParamtersValidator } from "../helpers/schemaValidator/validators";

const region = process.env.REGION;
const tableName = process.env.TABLE_NAME;

const client = new DynamoDBClient({ region });

const dynamo = DynamoDBDocumentClient.from(client);

export const handler = async (event: APIGatewayProxyEventV2) => {
  const pathParameters = event.pathParameters;

  const { data, success, error } =
    allUserApiKeysPathParamtersValidator.safeParse(pathParameters);

  if (!success) {
    console.log("Invalid Request Body", error.issues);

    return { statusCode: 400, body: JSON.stringify(error.issues) };
  }

  //TODO: PAGINATE THIS, ONLY 10 AT ONCE
  try {
    const usersApiKeys = await dynamo.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: "createdAtIndex",
        KeyConditionExpression: "userId = :userId",
        ExpressionAttributeValues: {
          ":userId": data.userId,
        },
        ScanIndexForward: false,
        Limit: 10,
      })
    );

    console.log(usersApiKeys.Items);

    return { statusCode: 200, body: JSON.stringify(usersApiKeys.Items) };
  } catch (error: unknown) {
    console.log(
      "FAILED TO GET USERS API KEYS FROM DB",
      JSON.stringify({ context: "get-all-api-keys", error, date: new Date() })
    );

    return { statusCode: 500, body: "Internal server error" };
  }
};
