import { APIGatewayProxyEventV2, Handler } from "aws-lambda";

import { v4 as uuid } from "uuid";

import { validatePlan } from "../helpers/fns/validatePlan";
import { newPaymentRequestBodyValidator } from "../helpers/schemaValidator/newPaymentRequestBodyValidator";

const region = process.env.REGION!;
const paymentGatewayUrl = process.env.PAYMENT_GATEWAY_URL!;
const paymentGatewaySecretName = process.env.PAYMENT_SECRET_NAME!;
const usagePlanSecretName = process.env.AVAILABLE_PLANS_SECRET_NAME!;

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
    return { statusCode: 400, body: JSON.stringify(error.issues), headers };
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
