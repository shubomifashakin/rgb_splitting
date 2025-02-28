import * as crypto from "crypto";
import { APIGateway, SecretsManager } from "aws-sdk";
import { APIGatewayProxyEventV2, Handler } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

import { v4 as uuid } from "uuid";

const region = process.env.REGION;
const tableName = process.env.TABLE_NAME;
const paymentSecretName = process.env.PAYMENT_SECRET_NAME!;
const freeTierUsagePlanId = process.env.FREE_TIER_PLAN_ID!;
const availablePlansSecretName = process.env.AVAILABLE_PLANS_SECRET_NAME!;

const client = new DynamoDBClient({ region });

const dynamo = DynamoDBDocumentClient.from(client);

const secretClient = new SecretsManager({
  region: "us-east-1",
});

//this acts as a  webhook url, only called by the payment gateway
export const handler: Handler = async (event: APIGatewayProxyEventV2) => {
  const apiGateway = new APIGateway();

  if (!event.body) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        message: "Bad Request - No body",
      }),
    };
  }

  try {
    //get the payment secret
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

    const hash = crypto
      .createHmac("sha512", paymentSecret.SecretString)
      .update(JSON.stringify(event.body))
      .digest("hex");

    if (hash !== event.headers["x-paystack-signature"]) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: "Bad Request - Invalid Signature",
        }),
      };
    }

    const apiKey = await apiGateway
      .createApiKey({
        value: uuid(),
        name: "rgb_splitting_key", //TODO: Include the users userId in this
        enabled: true,
      })
      .promise();

    if (!apiKey.id || !apiKey.value) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          message: "Internal server error - failed to create api key",
        }),
      };
    }

    const availablePlans = await secretClient
      .getSecretValue({ SecretId: availablePlansSecretName })
      .promise();

    if (!availablePlans.SecretString) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          message: "Internal Server Error",
        }),
      };
    }

    const allPlans = availablePlans.SecretString;

    console.log(allPlans);

    //TODO: ADD THE APIKEY TO THE USAGE PLAN, BASED ON WHAT THE USER PAID FOR
    //add the apikey generated to the usage plan
    await apiGateway
      .createUsagePlanKey({
        usagePlanId: freeTierUsagePlanId as string,
        keyId: apiKey.id,
        keyType: "API_KEY",
      })
      .promise();

    await dynamo.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          userId: "user1234", //TODO: THE USERS ID GOTTEN FROM THE WEBHOOK
          apiKey: apiKey.value,
          createdAt: Date.now(),
          id: uuid(),
          projectName: "project1", //TODO: THE NAME OF THE PROJECT GOTTEN FROM THE WEBHOOK
          currentPlan: "", //TODO: THE PLAN THE API KEY IS ON, BASED ON THE PLAN THEY PAID FOR
        },
      })
    );

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Api key generated", key: apiKey.value }),
    };
  } catch (error: unknown) {
    console.log(error);

    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Internal server error" }),
    };
  }
};
