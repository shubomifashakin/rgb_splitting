import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { APIGatewayProxyEventV2, Handler } from "aws-lambda";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";

import { z } from "zod";

import { processedImagesRouteVar } from "../helpers/constants";
import { projectIdValidator } from "../helpers/schemaValidator/validators";

const region = process.env.REGION!;
const processedResultsTable = process.env.PROCESSED_IMAGES_TABLE_NAME!;

const client = new DynamoDBClient({ region });
const dynamo = DynamoDBDocumentClient.from(client);

export const handler: Handler = async (event: APIGatewayProxyEventV2) => {
  const pathParameters = event.pathParameters;

  if (!pathParameters) {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: "Missing path parameters" }),
    };
  }

  const { success, data } = z
    .object({
      projectId: projectIdValidator,
      imageId: z.string().uuid(),
    })
    .safeParse(pathParameters);

  if (!success) {
    return { statusCode: 400, body: "Invalid imageId or projectId" };
  }

  const { imageId, projectId } = data;

  console.log("image Id", imageId);
  console.log("project Id", projectId);

  const fullImageId = `${projectId}/${processedImagesRouteVar}/${imageId}`;

  try {
    const results = await dynamo.send(
      new GetCommand({
        TableName: processedResultsTable,
        Key: {
          imageId: fullImageId,
          projectId,
        },
        ProjectionExpression: "createdAt, originalImageUrl, results",
      })
    );

    if (!results.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ message: "Image not found" }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify(results.Item),
    };
  } catch (error: unknown) {
    console.error("Failed to get processed images", error);

    throw error;
  }
};
