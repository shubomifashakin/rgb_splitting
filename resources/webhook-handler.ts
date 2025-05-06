import { APIGatewayClient } from "@aws-sdk/client-api-gateway";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
  GetSecretValueCommandOutput,
} from "@aws-sdk/client-secrets-manager";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { APIGatewayProxyEventV2, Handler } from "aws-lambda";
import {
  GetCommand,
  UpdateCommand,
  DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";

import { ApiKeyInfo } from "../types/apiKeyInfo";
import { ChargeCompletedData } from "../types/webHookEventTypes";
import { ChargeVerificationStatus } from "../types/chargeVerificationStatus";

import {
  PlanType,
  planTypeToStatus,
  PROJECT_STATUS,
} from "../helpers/constants";
import { getOneMonthFromDate } from "../helpers/fns/oneMonthFromDate";
import { CreateApiKeyAndAttachToUsagePlan } from "../helpers/fns/createApiKey";
import { webHookEventValidator } from "../helpers/schemaValidator/webhookEventValidator";
import { migrateExistingProjectApiKey } from "../helpers/fns/migrateExistingProjectApiKey";

const region = process.env.REGION!;
const tableName = process.env.TABLE_NAME!;
const paymentGatewayUrl = process.env.PAYMENT_GATEWAY_URL!;
const paymentGatewaySecretName = process.env.PAYMENT_SECRET_NAME!;
const paymentGatewayWebhookVerifierSecretName =
  process.env.WEBHOOK_SECRET_NAME!;

const client = new DynamoDBClient({ region });

const dynamo = DynamoDBDocumentClient.from(client);

const apiGatewayClient = new APIGatewayClient({
  region,
});

const secretClient = new SecretsManagerClient({
  region,
});

let paymentGatewaySecret: GetSecretValueCommandOutput | undefined;
let paymentGatewayWebhookVerifierSecret:
  | GetSecretValueCommandOutput
  | undefined;

export const handler: Handler = async (event: APIGatewayProxyEventV2) => {
  if (!event.body) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        message: "Bad Request - No body",
      }),
    };
  }

  const body = JSON.parse(event.body);

  console.log(body);

  try {
    //gets the payment gateway secret key & the verif hash that is sent by the payment gateway
    if (!paymentGatewaySecret || !paymentGatewayWebhookVerifierSecret) {
      console.log("cold start, so fetching secrets");

      [paymentGatewaySecret, paymentGatewayWebhookVerifierSecret] =
        await Promise.all([
          secretClient.send(
            new GetSecretValueCommand({ SecretId: paymentGatewaySecretName })
          ),
          secretClient.send(
            new GetSecretValueCommand({
              SecretId: paymentGatewayWebhookVerifierSecretName,
            })
          ),
        ]);
    }

    if (
      !paymentGatewaySecret.SecretString ||
      !paymentGatewayWebhookVerifierSecret.SecretString
    ) {
      console.error("Payment or Webhook secret is empty");

      throw new Error("Payment or Webhook secret is empty");
    }

    if (
      paymentGatewayWebhookVerifierSecret.SecretString !==
      event.headers["verif-hash"]
    ) {
      console.error("Signature does not match");

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
    } = webHookEventValidator.safeParse(body);

    if (!success) {
      console.error(error.issues, "WEBHOOK EVENT SCHEMA VALIDATION FAILED");

      throw new Error("WEBHOOK EVENT SCHEMA VALIDATION FAILED");
    }

    console.info("verified webhook event data successfully");

    if (
      webHookEvent.event === "charge.completed" &&
      webHookEvent.data.status === "successful"
    ) {
      const eventData = webHookEvent.data as unknown as ChargeCompletedData;

      const url = `${paymentGatewayUrl}/transactions/${eventData.id}/verify`;

      const chargeVerificationReq = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${paymentGatewaySecret.SecretString}`,
        },
      });

      if (!chargeVerificationReq.ok) {
        const failureReason = await chargeVerificationReq.json();

        console.error(
          `Failed to verify charge for ${eventData.customer.email}, PROJECT: ${webHookEvent.meta_data.projectName}, USER: ${webHookEvent.meta_data.userId}`,
          failureReason
        );

        throw new Error("Failed to verify payment");
      }

      const chargeVerificationRes =
        (await chargeVerificationReq.json()) as ChargeVerificationStatus;

      if (chargeVerificationRes.data.status.toLowerCase() !== "successful") {
        console.error("Payment not successful");

        return {
          statusCode: 400,
          body: JSON.stringify({
            message: "Payment not successful",
          }),
        };
      }

      //check if the project already exists in the database
      const existingProject = await dynamo.send(
        new GetCommand({
          TableName: tableName,
          Key: {
            projectId: webHookEvent.meta_data.projectId,
            userId: webHookEvent.meta_data.userId,
          },
          ProjectionExpression: "apiKeyInfo, sub_status",
        })
      );

      //if the project does not exist, then its a new project
      if (!existingProject.Item) {
        const res = await CreateApiKeyAndAttachToUsagePlan({
          tableName,
          apiGatewayClient,
          dynamoClient: dynamo,
          createdAt: eventData.created_at,
          email: eventData.customer.email,
          userId: webHookEvent.meta_data.userId,
          projectId: webHookEvent.meta_data.projectId,
          projectName: webHookEvent.meta_data.projectName,
          currentPlan: webHookEvent.meta_data.planName,
          usagePlanId: webHookEvent.meta_data.usagePlanId,
          cardExpiry: chargeVerificationRes.data.card.expiry,
          cardToken: chargeVerificationRes.data.card.token,
        });

        return res;
      }

      const { apiKeyInfo, sub_status } = existingProject.Item as {
        apiKeyInfo: ApiKeyInfo;
        sub_status: PROJECT_STATUS;
      };

      // EXISTING PROJECT

      //if the plan has changed, update the usage plan
      await migrateExistingProjectApiKey({
        apiKeyInfo,
        apiGatewayClient,
        projectStatus: sub_status,
        newUsagePlanId: webHookEvent.meta_data.usagePlanId,
      });

      await dynamo.send(
        new UpdateCommand({
          TableName: tableName,
          Key: {
            userId: webHookEvent.meta_data.userId,
            projectId: webHookEvent.meta_data.projectId,
          },
          UpdateExpression:
            "set nextPaymentDate = :currentTimestamp, currentBillingDate = :currentBillingDate, apiKeyInfo.usagePlanId = :usagePlanId, currentPlan = :planName, cardTokenInfo.cardToken = :cardToken, cardTokenInfo.cardExpiry = :cardExpiry, sub_status = :sub_status",
          ExpressionAttributeValues: {
            ":sub_status":
              planTypeToStatus[webHookEvent.meta_data.planName as PlanType], //if they cancelled their account b4, activate it
            ":planName": webHookEvent.meta_data.planName,
            ":usagePlanId": webHookEvent.meta_data.usagePlanId, //update the usagePlanId to the one they paid for
            ":cardToken": chargeVerificationRes.data.card.token, //if the user was on free plan b4, they would have an emoty cardToken info so update it
            ":cardExpiry": chargeVerificationRes.data.card.expiry,
            ":currentTimestamp": getOneMonthFromDate(eventData.created_at), //TODO: CHANGE TO ONE MONTH FROM NOW
            ":currentBillingDate": new Date(eventData.created_at).getTime(),
          },
        })
      );

      console.info("completed successfully");
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Api key generated" }),
    };
  } catch (error: unknown) {
    console.error("ERROR HANDLING WEBHOOK", error);

    //let it be caught by the alarm
    throw error;
  }
};
