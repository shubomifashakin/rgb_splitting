import { APIGatewayProxyEventV2, Handler } from "aws-lambda";

import { v4 as uuid } from "uuid";

import { newPaymentRequestBodyValidator } from "../helpers/schemaValidator/validators";
import { validatePlan } from "../helpers/fns/validatePlan";

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

  try {
    const { planDetails, chosenUsagePlan, paymentGatewaySecret } =
      await validatePlan({
        paymentGatewaySecretName,
        usagePlanSecretName,
        planName: data.planName,
        region,
        paymentGatewayUrl,
      });

    const paymentParams = {
      tx_ref: uuid(),
      amount: planDetails.amount,
      currency: planDetails.currency,
      redirect_url: "http://localhost:3000/dashboard/new",
      customer: {
        email: data.email,
        name: data?.fullName ? data.fullName : "",
      },
      customizations: {
        title: "Rgbreak",
      },
      meta: {
        projectId: data.projectId ? data.projectId : uuid(),
        userId: data.userId,
        planName: data.planName,
        usagePlanId: chosenUsagePlan,
        projectName: data.projectName,
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

      console.error("failed to initialize payment", res);

      return {
        statusCode: 500,
        body: JSON.stringify({ message: "Internal Server Error" }),
        headers,
      };
    }

    const paymentResponse = await paymentReq.json();

    return {
      statusCode: 200,
      body: JSON.stringify(paymentResponse),
      headers,
    };
  } catch (error: unknown) {
    console.error(error, "HELLO WORLD");

    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Internal Server Error" }),
      headers,
    };
  }
};
