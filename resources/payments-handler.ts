import { APIGatewayProxyEventV2, Handler } from "aws-lambda";

import { v4 as uuid } from "uuid";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { APIGatewayClient } from "@aws-sdk/client-api-gateway";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { PlanType } from "../helpers/constants";
import { validatePlan } from "../helpers/fns/validatePlan";
import { transformZodError } from "../helpers/fns/transformZodError";
import { newPaymentRequestBodyValidator } from "../helpers/schemaValidator/newPaymentRequestBodyValidator";
import { CreateApiKeyAndAttachToUsagePlan } from "../helpers/fns/createApiKey";

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
      statusCode: 400,
      body: JSON.stringify({ message: "Bad Request - No body" }),
      headers,
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
    const { planDetails, chosenUsagePlan, paymentGatewaySecret } =
      await validatePlan({
        region,
        planName,
        paymentGatewayUrl,
        usagePlanSecretName,
        paymentGatewaySecretName,
      });

    //if the plan is free, no need for payments, create the api, attach to the free usage plan & shekinah
    if (planName === PlanType.Free) {
      //creates the api key, attaches it to the correct usage plan & stores in db
      const res = await CreateApiKeyAndAttachToUsagePlan({
        email,
        userId,
        tableName,
        projectId: uuid(),
        createdAt: new Date().toDateString(),
        projectName,
        currentPlan: planName,
        usagePlanId: chosenUsagePlan,
        cardExpiry: "",
        cardToken: "",
        apiGatewayClient,
        dynamoClient,
      });

      return res;
    }

    const paymentParams = {
      tx_ref: uuid(),
      narration: `Payment for project: ${data.projectName}`,
      amount: planDetails.amount,
      currency: planDetails.currency,
      redirect_url: "http://localhost:3000/dashboard/new",
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
        usagePlanId: chosenUsagePlan,
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
      statusCode: 200,
      body: JSON.stringify(paymentResponse),
      headers,
    };
  } catch (error: unknown) {
    console.error(
      `ERROR INITIALIZING PAYMENT FOR USER ${userId} ${email}`,
      error
    );

    throw error;
  }
};
