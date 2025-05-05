import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { z } from "zod";

import { transformZodError } from "../helpers/fns/transformZodError";
import { projectIdValidator } from "../helpers/schemaValidator/projectIdValidator";
import { projectNameValidator } from "../helpers/schemaValidator/newPaymentRequestBodyValidator";

import { AuthorizedApiGatewayEvent } from "../types/AuthorizedApiGateway";

const region = process.env.REGION;
const tableName = process.env.TABLE_NAME;

const client = new DynamoDBClient({ region });
const dynamo = DynamoDBDocumentClient.from(client);

export async function handler(event: AuthorizedApiGatewayEvent) {
  try {
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Api-Key",
    };

    console.log(event);

    const userId = event.requestContext.authorizer?.principalId;

    if (!userId) {
      console.log("Unauthorized");

      return {
        headers,
        statusCode: 400,
        body: JSON.stringify({ error: "Unauthorized" }),
      };
    }

    const eventBody = event.body;

    if (!eventBody) {
      console.error("No event body", event.body);

      return {
        headers,
        statusCode: 400,
        body: JSON.stringify({ error: "No event body" }),
      };
    }

    const pathParams = event.pathParameters;

    const {
      success: pathParamsSuccess,
      data: pathParamsData,
      error: pathParamsError,
    } = z
      .object({
        projectId: projectIdValidator,
      })
      .safeParse(pathParams);

    if (!pathParamsSuccess) {
      console.error(
        "Failed to validate project id -->",
        pathParamsError.issues
      );

      return {
        headers,
        statusCode: 400,
        body: transformZodError(pathParamsError),
      };
    }

    const parsedEventBody = JSON.parse(eventBody);

    const { success, data, error } = z
      .object({
        projectName: projectNameValidator,
      })
      .safeParse(parsedEventBody);

    if (!success) {
      console.error("Failed to validate project name -->", error.issues);

      return { statusCode: 400, body: transformZodError(error), headers };
    }

    const { projectName } = data;
    const { projectId } = pathParamsData;

    await dynamo.send(
      new UpdateCommand({
        TableName: tableName,
        Key: {
          userId,
          projectId,
        },
        ExpressionAttributeValues: {
          ":projectName": projectName,
        },
        UpdateExpression: "set projectName = :projectName",
      })
    );

    console.log("completed successfully");

    return {
      headers,
      statusCode: 200,
      body: JSON.stringify({ message: "Success" }),
    };
  } catch (error) {
    console.error("Failed to update project info", error);

    throw error;
  }
}
