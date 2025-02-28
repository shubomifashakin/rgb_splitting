import { SecretsManager } from "aws-sdk";
import { APIGatewayProxyEventV2 } from "aws-lambda";

const paymentSecretName = process.env.PAYMENT_SECRET_NAME!;

const secretClient = new SecretsManager({
  region: "us-east-1",
});

export async function handler(event: APIGatewayProxyEventV2) {
  if (!event.body) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        message: "Bad Request - No body",
      }),
    };
  }

  try {
    const paymentSecret = await secretClient
      .getSecretValue({ SecretId: paymentSecretName })
      .promise();

    if (!paymentSecret.SecretString) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          message: "Internal Server Error",
        }),
      };
    }

    //TODO: GET THE PLAN NAME FROM THE REQUEST

    const params = {
      email: "customer@email.com", //TODO: GET THIS FROM THE REQUEST
      amount: "500000", //TODO: GET THIS FROM THE REQUEST
    };

    const paymentReq = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${paymentSecret.SecretString}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params),
      }
    );

    if (!paymentReq.ok) {
      return {
        statusCode: 500,
        body: JSON.stringify({ message: "Internal Server Error" }),
      };
    }

    const paymentRes = await paymentReq.json();

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: JSON.stringify(paymentRes),
    };
  } catch (error: unknown) {
    console.log(error);

    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Internal Server Error" }),
    };
  }
}
