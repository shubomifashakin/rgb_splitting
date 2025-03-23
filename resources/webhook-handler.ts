import {
  APIGatewayClient,
  CreateApiKeyCommand,
  CreateUsagePlanKeyCommand,
  DeleteUsagePlanKeyCommand,
} from "@aws-sdk/client-api-gateway";
import {
  GetSecretValueCommand,
  GetSecretValueCommandOutput,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { APIGatewayProxyEventV2, Handler } from "aws-lambda";
import {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";

import { v4 as uuid } from "uuid";

import { ApiKeyInfo } from "../types/apiKeyInfo";
import { CardTokenInfo } from "../types/cardTokenInfo";
import { ChargeCompletedData } from "../types/webHookEventTypes";
import { ChargeVerificationStatus } from "../types/chargeVerificationStatus";

import { PROJECT_STATUS } from "../helpers/constants";
import { getOneMonthFromNow } from "../helpers/fns/oneMonthFromNow";
import { webHookEventValidator } from "../helpers/schemaValidator/webhookEventValidator";

const region = process.env.REGION;
const tableName = process.env.TABLE_NAME;
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
          ProjectionExpression: "apiKeyInfo, userId, createdAt",
        })
      );

      //if the project does not exist, then its a new project
      if (!existingProject.Item) {
        const apiKey = await apiGatewayClient.send(
          new CreateApiKeyCommand({
            value: uuid(),
            name: `${webHookEvent.meta_data.projectName.replace(" ", "_")}_${
              webHookEvent.meta_data.userId
            }`,
            enabled: true,
          })
        );

        if (!apiKey.id || !apiKey.value) {
          console.error(
            `Failed to create api key for project ${webHookEvent.meta_data.projectName} by user ${webHookEvent.meta_data.userId}`
          );

          throw new Error("Internal server error - failed to create api key");
        }

        //add the apikey generated to the usage plan
        await apiGatewayClient.send(
          new CreateUsagePlanKeyCommand({
            usagePlanId: webHookEvent.meta_data.usagePlanId,
            keyId: apiKey.id,
            keyType: "API_KEY",
          })
        );

        const apiKeyInfo: ApiKeyInfo = {
          apiKeyId: apiKey.id,
          usagePlanId: webHookEvent.meta_data.usagePlanId,
        };

        const cardTokenInfo: CardTokenInfo = {
          token: chargeVerificationRes.data.card.token,
          expiry: chargeVerificationRes.data.card.expiry,
        };

        await dynamo.send(
          new PutCommand({
            TableName: tableName,
            Item: {
              sub_status: PROJECT_STATUS.Active as PROJECT_STATUS,
              email: eventData.customer.email,
              projectId: webHookEvent.meta_data.projectId,
              userId: webHookEvent.meta_data.userId,
              projectName: webHookEvent.meta_data.projectName,
              nextPaymentDate: getOneMonthFromNow(), //TODO: CHANGE TO ONE MONTH FROM NOW
              currentBillingDate: new Date(eventData.created_at).getTime(),
              createdAt: new Date(eventData.created_at).getTime(),
              currentPlan: webHookEvent.meta_data.planName,
              apiKey: apiKey.value,
              apiKeyInfo,
              cardTokenInfo,
            },
          })
        );

        return {
          statusCode: 200,
          body: JSON.stringify({ message: "Api key generated" }),
        };
      }

      //if there is an existing project, update the next payment date
      //if the plan has changed, update the usage plan
      if (
        existingProject.Item.apiKeyInfo.usagePlanId !==
        webHookEvent.meta_data.usagePlanId
      ) {
        //CANT RUN IN PARALLEl BECAUSE AN APIKEY CAN ONLY BELONG TO 1 USAGE PLAN AT A TIME
        //remove the user from the old usage plan
        await apiGatewayClient.send(
          new DeleteUsagePlanKeyCommand({
            usagePlanId: existingProject.Item.apiKeyInfo.usagePlanId,
            keyId: existingProject.Item.apiKeyInfo.apiKeyId,
          })
        );

        //add their apikey to the new usage plan
        await apiGatewayClient.send(
          new CreateUsagePlanKeyCommand({
            usagePlanId: webHookEvent.meta_data.usagePlanId,
            keyId: existingProject.Item.apiKeyInfo.apiKeyId,
            keyType: "API_KEY",
          })
        );
      }

      await dynamo.send(
        new UpdateCommand({
          TableName: tableName,
          Key: {
            projectId: webHookEvent.meta_data.projectId,
            userId: webHookEvent.meta_data.userId,
          },
          UpdateExpression:
            "set nextPaymentDate = :currentTimestamp, currentBillingDate = :currentBillingDate, apiKeyInfo.usagePlanId = :usagePlanId, currentPlan = :planName",
          ExpressionAttributeValues: {
            ":currentTimestamp": getOneMonthFromNow(), //TODO: CHANGE TO ONE MONTH FROM NOW
            ":currentBillingDate": new Date(eventData.created_at).getTime(),
            ":usagePlanId": webHookEvent.meta_data.usagePlanId,
            ":planName": webHookEvent.meta_data.planName,
          },
        })
      );

      console.log("completed successfully");
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
