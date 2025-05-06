import { z } from "zod";

import { projectIdValidator } from "../helpers/schemaValidator/projectIdValidator";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { QueryCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { AuthorizedApiGatewayEvent } from "../types/AuthorizedApiGateway";

const region = process.env.REGION;
const processedImagesTableName = process.env.PROCESSED_IMAGES_TABLE_NAME;

const client = new DynamoDBClient({ region });
const dynamo = DynamoDBDocumentClient.from(client);

export async function handler(event: AuthorizedApiGatewayEvent) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Api-Key",
  };

  const userId = event.requestContext.authorizer?.principalId;

  if (!userId) {
    return {
      headers,
      statusCode: 400,
      body: JSON.stringify({ message: "Unauthorized" }),
    };
  }

  const pathParameters = event.pathParameters;

  if (!pathParameters) {
    return {
      headers,
      statusCode: 400,
      body: JSON.stringify({ message: "Bad Request" }),
    };
  }

  const { success, data, error } = z
    .object({
      imageId: z.string().uuid(),
      projectId: projectIdValidator,
    })
    .safeParse(pathParameters);

  if (!success) {
    console.error("Failed to validate image key --->", error.issues);

    return {
      headers,
      statusCode: 400,
      body: JSON.stringify({ message: "Bad Request" }),
    };
  }

  try {
    //get the results from the processed results table
    const results = await dynamo.send(
      new QueryCommand({
        TableName: processedImagesTableName,
        KeyConditionExpression: "imageId = :imageId AND projectId = :projectId",
        ExpressionAttributeValues: {
          ":userId": userId,
          ":imageId": data.imageId,
          ":projectId": data.projectId,
        },
        FilterExpression: "userId = :userId",
        Limit: 1,
        ProjectionExpression:
          "createdAt, originalImageUrl, results, imageId, projectId",
      })
    );

    if (!results.Items || !results.Items.length) {
      return {
        headers,
        statusCode: 404,
        body: JSON.stringify({ message: "Not found" }),
      };
    }

    return {
      headers,
      statusCode: 200,
      body: JSON.stringify(results.Items[0]),
    };
  } catch (error) {
    console.log("Failed to get processed results -->", error);

    throw error;
  }
}
