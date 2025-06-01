import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { APIGatewayProxyEventV2, Handler } from "aws-lambda";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

import { z } from "zod";

import { ProcessedImagesInfo } from "../types/processedResultInfo";

const region = process.env.REGION!;
const processedResultsTable = process.env.PROCESSED_IMAGES_TABLE_NAME!;

const client = new DynamoDBClient({ region });
const dynamo = DynamoDBDocumentClient.from(client);

export const handler: Handler = async (event: APIGatewayProxyEventV2) => {
  const pathParameters = event.pathParameters;

  if (!pathParameters) {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: "Bad Request" }),
    };
  }

  const { success, data, error } = z
    .object({
      imageId: z.string().uuid(),
    })
    .safeParse(pathParameters);

  if (!success) {
    console.error("Failed to validate image key --->", error.issues);

    return {
      statusCode: 400,
      body: JSON.stringify({ message: "Bad Request - Invalid image key" }),
    };
  }

  const { imageId } = data;

  console.log("image Id", imageId);

  try {
    const results = await dynamo.send(
      new QueryCommand({
        TableName: processedResultsTable,
        KeyConditionExpression: "imageId = :imageId",
        ExpressionAttributeValues: {
          ":imageId": imageId,
        },
        ProjectionExpression: "createdAt, originalImageUrl, results",
        Limit: 1,
      })
    );

    if (!results.Items || !results.Items.length) {
      return {
        statusCode: 404,
        body: JSON.stringify({ message: "Image not found" }),
      };
    }

    const processedResult = results.Items[0] as Pick<
      ProcessedImagesInfo,
      "createdAt" | "originalImageUrl" | "results"
    >;

    return {
      statusCode: 200,
      body: JSON.stringify(processedResult),
    };
  } catch (error: unknown) {
    console.error("Failed to get processed images", error);

    throw error;
  }
};
