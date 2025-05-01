import { APIGatewayProxyEventV2 } from "aws-lambda";

import { z } from "zod";

import { projectIdValidator } from "../helpers/schemaValidator/projectIdValidator";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";

const region = process.env.REGION;
const processedImagesTableName = process.env.PROCESSED_IMAGES_TABLE_NAME;

const client = new DynamoDBClient({ region });
const dynamo = DynamoDBDocumentClient.from(client);

export async function handler(event: APIGatewayProxyEventV2) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Api-Key",
  };

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

    return { statusCode: 400, body: "Bad Request" };
  }

  try {
    //get the results from the processed results table
    const results = await dynamo.send(
      new GetCommand({
        TableName: processedImagesTableName,
        Key: {
          imageId: data.imageId,
          projectId: data.projectId,
        },
      })
    );

    if (!results.Item) {
      return { body: "Image not found", statusCode: 404, headers };
    }

    return {
      headers,
      statusCode: 200,
      body: JSON.stringify(results.Item),
    };
  } catch (error) {
    console.log("Failed to get processed results -->", error);

    throw error;
  }
}
