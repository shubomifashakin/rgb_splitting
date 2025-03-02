import { APIGateway, SecretsManager } from "aws-sdk";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { APIGatewayProxyEventV2, Handler } from "aws-lambda";
import {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";

import { v4 as uuid } from "uuid";

import {
  webHookEventSchema,
  ChargeCompletedData,
} from "../types/webHookEventTypes";
import { ChargeVerificationStatus } from "../types/chargeVerificationStatus";

import { getOneMonthFromNow } from "../helpers/oneMonthFromNow";
import { usagePlanValidator } from "../helpers/schemaValidator/validators";

const region = process.env.REGION;
const tableName = process.env.TABLE_NAME;
const paymentGatewaySecretName = process.env.PAYMENT_SECRET_NAME!;
const webhookEventVerifierSecretName = process.env.WEBHOOK_SECRET_NAME!;
const availableUsagePlansSecretName = process.env.AVAILABLE_PLANS_SECRET_NAME!;

const client = new DynamoDBClient({ region });

const dynamo = DynamoDBDocumentClient.from(client);

const secretClient = new SecretsManager({
  region,
});

export const handler: Handler = async (event: APIGatewayProxyEventV2) => {
  if (!event.body) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        message: "Bad Request - No body",
      }),
    };
  }

  try {
    const [paymentGatewaySecret, webhookEventVerifierSecret] =
      await Promise.all([
        secretClient
          .getSecretValue({ SecretId: paymentGatewaySecretName })
          .promise(),
        secretClient
          .getSecretValue({ SecretId: webhookEventVerifierSecretName })
          .promise(),
      ]);

    if (
      !paymentGatewaySecret.SecretString ||
      !webhookEventVerifierSecret.SecretString
    ) {
      console.log("Payment or Webhook secret is empty");

      return {
        statusCode: 500,
        body: JSON.stringify({
          message: "Internal Server Error",
        }),
      };
    }

    const body = JSON.parse(event.body);

    console.log(body);

    if (
      webhookEventVerifierSecret.SecretString !== event.headers["verif-hash"]
    ) {
      console.log("Signature does not match");

      return {
        statusCode: 400,
        body: JSON.stringify({
          message: "Bad Request - Invalid Signature",
        }),
      };
    }

    const {
      success,
      error,
      data: webHookEvent,
    } = webHookEventSchema.safeParse(body);

    if (!success) {
      console.log(error.issues, "WEBHOOK EVENT SCHEMA VALIDATION FAILED");

      return {
        statusCode: 400,
        body: JSON.stringify({
          message: error.issues,
        }),
      };
    }

    const apiGateway = new APIGateway();

    if (
      webHookEvent.event === "charge.completed" &&
      webHookEvent.data.status === "successful"
    ) {
      const eventData = webHookEvent.data as unknown as ChargeCompletedData;

      const chargeVerificationReq = await fetch(
        `https://api.flutterwave.com/v3/transactions/${eventData.id}/verify`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${paymentGatewaySecret.SecretString}`,
          },
        }
      );

      if (!chargeVerificationReq.ok) {
        const failureReason = await chargeVerificationReq.json();

        console.log(failureReason, "Failed to verify charge");

        return {
          statusCode: 400,
          body: JSON.stringify({
            message: "Failed to confirm payment",
          }),
        };
      }

      const chargeVerificationRes =
        (await chargeVerificationReq.json()) as ChargeVerificationStatus;

      if (chargeVerificationRes.data.status !== "successful") {
        console.log("Payment not successful");

        return {
          statusCode: 400,
          body: JSON.stringify({
            message: "Payment not successful",
          }),
        };
      }

      //check if the project already exists in the database
      const existingProject = await dynamo.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: "projectIdIndex",
          KeyConditionExpression: "id = :id",
          ExpressionAttributeValues: {
            ":id": webHookEvent.meta_data.projectId,
          },
          Limit: 1,
        })
      );

      if (!existingProject.Items || !existingProject.Items.length) {
        const apiKey = await apiGateway
          .createApiKey({
            value: uuid(),
            name: `${webHookEvent.meta_data.projectName.replace(" ", "_")}_${
              webHookEvent.meta_data.userId
            }`,
            enabled: true,
          })
          .promise();

        if (!apiKey.id || !apiKey.value) {
          console.log("Failed to create api key");

          return {
            statusCode: 500,
            body: JSON.stringify({
              message: "Internal server error - failed to create api key",
            }),
          };
        }

        //add the apikey generated to the usage plan
        await apiGateway
          .createUsagePlanKey({
            usagePlanId: webHookEvent.meta_data.usagePlanId,
            keyId: apiKey.id,
            keyType: "API_KEY",
          })
          .promise();

        await dynamo.send(
          new PutCommand({
            TableName: tableName,
            Item: {
              status: "active",
              email: eventData.customer.email,
              id: webHookEvent.meta_data.projectId,
              userId: webHookEvent.meta_data.userId,
              projectName: webHookEvent.meta_data.projectName,
              nextPaymentDate: getOneMonthFromNow().getTime(),
              createdAt: new Date(eventData.created_at).getTime(),
              apiKeyInfo: {
                apiKey: apiKey.value,
                currentPlan: webHookEvent.meta_data.planName,
                usagePlanId: webHookEvent.meta_data.usagePlanId,
              },
              cardTokenInfo: {
                token: chargeVerificationRes.data.card.token,
                expiry: chargeVerificationRes.data.card.expiry,
              },
            },
          })
        );

        return {
          statusCode: 200,
          body: JSON.stringify({ message: "Api key generated" }),
        };
      }

      //if there is an existing project, update the next payment date
      await dynamo.send(
        new UpdateCommand({
          TableName: tableName,
          Key: {
            id: webHookEvent.meta_data.projectId,
          },
          UpdateExpression: "SET nextPaymentDate = :nextPaymentDate",

          ExpressionAttributeValues: {
            ":nextPaymentDate": getOneMonthFromNow(),
          },
        })
      );
    }

    if (
      webHookEvent.event === "charge.completed" &&
      webHookEvent.data.status !== "successful"
    ) {
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Api key generated" }),
    };
  } catch (error: unknown) {
    console.log(error);

    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Internal server error" }),
    };
  }
};
