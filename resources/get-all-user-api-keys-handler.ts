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

  //validate the path parameters
  const { data, success, error } =
    allUserApiKeysPathParamtersValidator.safeParse(pathParameters);

  if (!success) {
    return { statusCode: 400, body: JSON.stringify(error.message) };
  }

  //fetch the users api keys from dynamo
  //TODO: PAGINATE THIS, ONLY 10 AT ONCE
  const usersApiKeys = await dynamo.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "userId = :userId",
      ExpressionAttributeValues: {
        ":userId": data.userId,
      },
    })
  );

  return { statusCode: 200, body: JSON.stringify(usersApiKeys.Items) };
};
