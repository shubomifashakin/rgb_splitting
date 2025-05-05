import {
  APIGatewayProxyEventV2,
  APIGatewayEventRequestContextV2,
} from "aws-lambda";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

import { z } from "zod";

import { transformZodError } from "../helpers/fns/transformZodError";

const region = process.env.REGION;
const tableName = process.env.TABLE_NAME;
const processedImagesTableName = process.env.PROCESSED_IMAGES_TABLE_NAME;

const client = new DynamoDBClient({ region });
const dynamo = DynamoDBDocumentClient.from(client);

interface CustomAPIGatewayEventV2 extends APIGatewayProxyEventV2 {
  requestContext: APIGatewayEventRequestContextV2 & {
    authorizer?: {
      principalId?: string;
    };
  };
}

export async function handler(event: CustomAPIGatewayEventV2) {
  try {
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Api-Key",
    };

    console.log(event);

    const userId = event.requestContext.authorizer?.principalId;

    if (!userId) {
      return {
        headers,
        statusCode: 400,
        body: JSON.stringify({ error: "Unauthorized" }),
      };
    }

    const { success, error, data } = z
      .object({
        projectId: z.string(),
      })
      .safeParse(event.pathParameters);

    if (!success) {
      console.error("Failed to validate project id", error.issues);

      return { statusCode: 400, body: transformZodError(error), headers };
    }

    const {
      data: searchParamsData,
      success: searchParamsIsSuccess,
      error: searchParamsError,
    } = z
      .object({
        field: z.enum(["gallery", "apikey", "settings", "plans"]),
      })
      .safeParse(event.queryStringParameters);

    if (!searchParamsIsSuccess) {
      console.error("Failed to validate project id", searchParamsError.issues);

      return {
        headers,
        statusCode: 400,
        body: transformZodError(searchParamsError),
      };
    }

    let projectionExpression = "*";

    if (searchParamsData.field === "apikey") {
      projectionExpression = "apiKey";
    }

    if (searchParamsData.field === "settings") {
      projectionExpression = "projectName";
    }

    if (searchParamsData.field === "plans") {
      projectionExpression =
        "currentPlan, nextPaymentDate, currentBillingDate, sub_status, projectName";
    }

    if (searchParamsData.field !== "gallery") {
      const item = await dynamo.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: "projectId = :projectId AND userId = :userId",
          ExpressionAttributeValues: {
            ":userId": userId,
            ":projectId": data.projectId,
          },
          ProjectionExpression: projectionExpression,
        })
      );

      if (!item.Items || !item.Items.length) {
        return {
          headers,
          statusCode: 404,
          body: JSON.stringify({ error: "Project not found" }),
        };
      }

      return {
        headers,
        statusCode: 200,
        body: JSON.stringify({ projectInfo: item.Items }),
      };
    }

    console.log(event.queryStringParameters?.query);

    //TODO: PAGINATE THIS
    const item = await dynamo.send(
      new QueryCommand({
        TableName: processedImagesTableName,
        KeyConditionExpression: "projectId = :projectId",
        ExpressionAttributeValues: {
          ":userId": userId,
          ":projectId": data.projectId,
        },
        ProjectionExpression: "originalImageUrl, createdAt, imageId",
        Limit: 12,
        ScanIndexForward: false,
        ExclusiveStartKey: event.queryStringParameters?.query
          ? JSON.parse(decodeURIComponent(event.queryStringParameters.query))
          : undefined,
        FilterExpression: "userId = :userId",
      })
    );

    if (!item.Items) {
      throw new Error("Failed to get project info");
    }

    console.log("completed successfully");

    return {
      headers,
      statusCode: 200,
      body: JSON.stringify({
        projectInfo: item.Items,
        nextKey: item.LastEvaluatedKey,
      }),
    };
  } catch (error) {
    console.error("Failed to get project info", error);

    throw error;
  }
}
