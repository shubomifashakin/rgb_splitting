import { APIGatewayProxyEventV2, Handler } from "aws-lambda";

import { v4 as uuid } from "uuid";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { APIGatewayClient } from "@aws-sdk/client-api-gateway";
import {
  GetCommand,
  QueryCommand,
  UpdateCommand,
  DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";

import { ApiKeyInfo } from "../types/apiKeyInfo";
import { validatePlan } from "../helpers/fns/validatePlan";
import {
  PlanType,
  PROJECT_STATUS,
  planTypeToStatus,
  maxActiveFreeProjects,
} from "../helpers/constants";
import { transformZodError } from "../helpers/fns/transformZodError";
import { CreateApiKeyAndAttachToUsagePlan } from "../helpers/fns/createApiKey";
import { migrateExistingProjectApiKey } from "../helpers/fns/migrateExistingProjectApiKey";
import { newPaymentRequestBodyValidator } from "../helpers/schemaValidator/newPaymentRequestBodyValidator";

const region = process.env.REGION!;
const tableName = process.env.TABLE_NAME!;
const paymentGatewayUrl = process.env.PAYMENT_GATEWAY_URL!;
const paymentGatewaySecretName = process.env.PAYMENT_SECRET_NAME!;
const usagePlanSecretName = process.env.AVAILABLE_PLANS_SECRET_NAME!;

const apiGatewayClient = new APIGatewayClient({
  region,
});

const dynamo = new DynamoDBClient({ region });
const dynamoClient = DynamoDBDocumentClient.from(dynamo);

export const handler: Handler = async (event: APIGatewayProxyEventV2) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Api-Key",
  };

  if (!event.body) {
    return {
      headers,
      statusCode: 400,
      body: JSON.stringify({ error: "Bad Request - No body" }),
    };
  }

  const body = JSON.parse(event.body);

  const { data, success, error } =
    newPaymentRequestBodyValidator.safeParse(body);

  if (!success) {
    console.error(error.message);

    return {
      headers,
      statusCode: 400,
      body: transformZodError(error),
    };
  }

  console.log(data);

  const { planName, email, userId, fullName, projectId, projectName } = data;

  try {
    const { planDetails, chosenUsagePlanId, paymentGatewaySecret } =
      await validatePlan({
        region,
        planName,
        paymentGatewayUrl,
        usagePlanSecretName,
        paymentGatewaySecretName,
      });

    //if the plan is free, no need for payments, create the api, attach to the free usage plan & shikenah
    if (planName === PlanType.Free) {
      //checks if they already have too many free projects
      const freeProjects = await dynamo.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: "userIdSubStatusIndex",
          KeyConditionExpression: "userId = :userId and sub_status = :status",
          ExpressionAttributeValues: {
            ":userId": userId,
            ":status": planTypeToStatus[PlanType.Free],
          },
          Limit: maxActiveFreeProjects,
        })
      );

      console.log("Amount of free projects", freeProjects.Items?.length);

      //if they have the max active free projects, stop them from creating a new one
      if (
        freeProjects.Items &&
        freeProjects.Items.length >= maxActiveFreeProjects
      ) {
        return {
          headers,
          statusCode: 400,
          body: JSON.stringify({
            message: "You have reached the limit for free projects.",
          }),
        };
      }

      if (!projectId) {
        //creates the project, the api key, attaches it to the correct usage plan & stores in db
        const res = await CreateApiKeyAndAttachToUsagePlan({
          email,
          userId,
          tableName,
          projectId: uuid(),
          projectName,
          cardExpiry: "",
          cardToken: "",
          dynamoClient,
          apiGatewayClient,
          currentPlan: planName,
          usagePlanId: chosenUsagePlanId,
          createdAt: new Date().toDateString(),
        });

        return res;
      }

      //check if the project exists
      const existingProject = await dynamoClient.send(
        new GetCommand({
          TableName: tableName,
          Key: {
            userId,
            projectId,
          },
          ProjectionExpression: "apiKeyInfo, sub_status",
        })
      );

      //if the project was not found
      if (!existingProject.Item) {
        return {
          headers,
          statusCode: 404,
          body: JSON.stringify({ message: "Project not found" }),
        };
      }

      const projectInfo = existingProject.Item as {
        apiKeyInfo: ApiKeyInfo;
        sub_status: PROJECT_STATUS;
      };

      //migrate the api key to the new usage plan & activate it if it cancelled b4
      await migrateExistingProjectApiKey({
        apiGatewayClient,
        newUsagePlanId: chosenUsagePlanId,
        apiKeyInfo: projectInfo.apiKeyInfo,
        projectStatus: projectInfo.sub_status,
      });

      await dynamoClient.send(
        new UpdateCommand({
          TableName: tableName,
          Key: {
            userId,
            projectId,
          },
          ExpressionAttributeValues: {
            ":currentPlan": planName,
            ":usagePlanId": chosenUsagePlanId,
            ":sub_status": planTypeToStatus[planName],
          },
          UpdateExpression:
            "set sub_status = :sub_status, currentPlan = :currentPlan, apiKeyInfo.usagePlanId = :usagePlanId",
        })
      );

      return {
        headers,
        statusCode: 200,
        body: JSON.stringify({ message: "Api key generated" }),
      };
    }

    const paymentParams = {
      tx_ref: uuid(),
      narration: `Payment for project: ${data.projectName}`,
      amount: planDetails.amount,
      currency: planDetails.currency,
      redirect_url: "http://localhost:3000/dashboard/new", //TODO: CHANEG TO ACTUAL DOMAIN
      customer: {
        email,
        name: fullName ? fullName : "",
      },
      customizations: {
        title: "Rgbreak",
      },
      meta: {
        userId,
        planName,
        projectName,
        usagePlanId: chosenUsagePlanId,
        projectId: projectId ? projectId : uuid(),
      },
      payment_options: "card",
    };

    console.log(paymentParams);

    //trigger a payment
    const paymentReq = await fetch(`${paymentGatewayUrl}/payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${paymentGatewaySecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(paymentParams),
    });

    if (!paymentReq.ok) {
      const res = await paymentReq.json();

      throw new Error(`Failed to initialize payment ${JSON.stringify(res)}`);
    }

    const paymentResponse = await paymentReq.json();

    console.log("completed successfully");

    return {
      headers,
      statusCode: 200,
      body: JSON.stringify(paymentResponse),
    };
  } catch (error: unknown) {
    console.error(
      `ERROR INITIALIZING PAYMENT FOR USER ${userId} ${email}`,
      error
    );

    throw error;
  }
};
