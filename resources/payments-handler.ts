import { SecretsManager } from "aws-sdk";
import { APIGatewayProxyEventV2, Handler } from "aws-lambda";

import { v4 as uuid } from "uuid";

import { PaymentPlansResponse } from "../types/paymentPlans";

import {
  newPaymentRequestBodyValidator,
  usagePlanValidator,
} from "../helpers/schemaValidator/validators";

const region = process.env.REGION!;
const paymentGatewaySecretName = process.env.PAYMENT_SECRET_NAME!;
const availableUsagePlansSecretName = process.env.AVAILABLE_PLANS_SECRET_NAME!;

const secretClient = new SecretsManager({
  region,
});

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

  try {
    //fetch the payment gateway secret and the available usage plans secret
    const [paymentGatewaySecret, availableUsagePlans] = await Promise.all([
      secretClient
        .getSecretValue({ SecretId: paymentGatewaySecretName })
        .promise(),
      secretClient
        .getSecretValue({ SecretId: availableUsagePlansSecretName })
        .promise(),
    ]);

    if (!paymentGatewaySecret.SecretString) {
      console.log("Payment gateway secret not found");

      return {
        statusCode: 500,
        body: JSON.stringify({
          message: "Internal Server Error",
        }),
        headers,
      };
    }

    if (!availableUsagePlans.SecretString) {
      console.log("failed to get  usage plans from secret storage");

      return {
        statusCode: 500,
        body: JSON.stringify({
          message: "Internal Server Error",
        }),
      };
    }

    //validate the usage plans received
    const {
      success,
      error,
      data: allUsagePlans,
    } = usagePlanValidator.safeParse(
      JSON.parse(availableUsagePlans.SecretString)
    );

    if (!success) {
      console.log(error.issues, "error message");

      return {
        statusCode: 400,
        body: JSON.stringify({ message: error.message }),
      };
    }

    ///fetch all the plans set on the payment gateway
    const url = `https://api.flutterwave.com/v3/payment-plans?status=active`;

    const getAllPlansOnPaymentGatewayReq = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${paymentGatewaySecret.SecretString}`,
        "Content-Type": "application/json",
        accept: "application/json",
      },
    });

    if (!getAllPlansOnPaymentGatewayReq.ok) {
      const res = await getAllPlansOnPaymentGatewayReq.json();

      return {
        statusCode: 500,
        body: JSON.stringify({ message: "Internal Server Error" }),
        headers,
      };
    }

    const allPlansInPaymentGateway =
      (await getAllPlansOnPaymentGatewayReq.json()) as PaymentPlansResponse;

    //find the plan with th name the customer selected
    const planDetails = allPlansInPaymentGateway.data.find(
      (plan) => data.planName === plan.name.toLowerCase()
    );

    if (!planDetails) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: "Plan not found" }),
        headers,
      };
    }

    if (!(data.planName in allUsagePlans)) {
      console.log("Failed to find plan in available plans");

      return {
        statusCode: 500,
        body: JSON.stringify({
          message: "Internal Server Error",
        }),
      };
    }

    const chosenUsagePlan =
      allUsagePlans[data.planName as keyof typeof allUsagePlans];

    const paymentParams = {
      tx_ref: uuid(),
      amount: planDetails.amount,
      currency: planDetails.currency,
      redirect_url: "http://localhost:3000/dashboard/new",
      customer: {
        email: data.email,
      },
      customizations: {
        title: "Rgbreak",
      },
      meta: {
        projectId: uuid(),
        userId: data.userId,
        planName: data.planName,
        usagePlanId: chosenUsagePlan,
        projectName: data.projectName,
      },
      payment_options: "card",
    };

    //trigger a payment
    const paymentReq = await fetch("https://api.flutterwave.com/v3/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${paymentGatewaySecret.SecretString}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(paymentParams),
    });

    if (!paymentReq.ok) {
      const res = await paymentReq.json();

      console.log(res, "failed payment request response");

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
    console.log(error);

    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Internal Server Error" }),
      headers,
    };
  }
};
