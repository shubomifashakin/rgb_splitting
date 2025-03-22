import {
  APIGatewayClient,
  CreateApiKeyCommand,
  CreateUsagePlanKeyCommand,
  DeleteUsagePlanKeyCommand,
} from "@aws-sdk/client-api-gateway";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { APIGatewayProxyEventV2, Handler } from "aws-lambda";

import { Pool } from "pg";

import { v4 as uuid } from "uuid";

import {
  webHookEventValidator,
  ChargeCompletedData,
} from "../types/webHookEventTypes";
import { CardInfo } from "../types/cardInfo";
import { ApiKeyInfo } from "../types/apiKeyInfo";
import { ChargeVerificationStatus } from "../types/chargeVerificationStatus";

import { Status } from "../helpers/constants";
import { getOneMonthFromNow } from "../helpers/fns/oneMonthFromNow";

const region = process.env.REGION;
const paymentGatewayUrl = process.env.PAYMENT_GATEWAY_URL!;
const paymentGatewaySecretName = process.env.PAYMENT_SECRET_NAME!;
const webhookEventVerifierSecretName = process.env.WEBHOOK_SECRET_NAME!;

const dbHost = process.env.DB_HOST!;
const dbPort = process.env.DB_PORT!;
const dbSecretArn = process.env.DB_SECRET_ARN!;

const apiGatewayClient = new APIGatewayClient({
  region,
});

const secretClient = new SecretsManagerClient({
  region,
});

let pool: Pool | undefined;

export const handler: Handler = async (event: APIGatewayProxyEventV2) => {
  if (!event.body) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        message: "Bad Request - No body",
      }),
    };
  }

  if (!pool) {
    //fetch the database credentials from the secret manager
    const secret = await secretClient.send(
      new GetSecretValueCommand({
        SecretId: dbSecretArn,
      })
    );

    const { username, password, dbname } = JSON.parse(secret.SecretString!);

    pool = new Pool({
      host: dbHost,
      user: username,
      password: password,
      database: dbname,
      port: Number(dbPort),
      ssl: { rejectUnauthorized: false },
    });
  }

  const body = JSON.parse(event.body);

  console.log(body);

  try {
    const [paymentGatewaySecret, webhookEventVerifierSecret] =
      await Promise.all([
        secretClient.send(
          new GetSecretValueCommand({ SecretId: paymentGatewaySecretName })
        ),
        secretClient.send(
          new GetSecretValueCommand({
            SecretId: webhookEventVerifierSecretName,
          })
        ),
      ]);

    if (
      !paymentGatewaySecret.SecretString ||
      !webhookEventVerifierSecret.SecretString
    ) {
      console.error("Payment or Webhook secret is empty");

      throw new Error("Payment or Webhook secret is empty");
    }

    if (
      webhookEventVerifierSecret.SecretString !== event.headers["verif-hash"]
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

      if (chargeVerificationRes.data.status !== "successful") {
        console.error("Payment not successful");

        return {
          statusCode: 400,
          body: JSON.stringify({
            message: "Payment not successful",
          }),
        };
      }

      //check if the project already exists in the database
      const existingProject = await pool.query(
        `SELECT id, "apiKeyInfo" FROM "Projects" WHERE id = $1`,
        [webHookEvent.meta_data.projectId]
      );

      if (!existingProject.rowCount) {
        const apiKey = await apiGatewayClient.send(
          new CreateApiKeyCommand({
            value: uuid(),
            name: `${webHookEvent.meta_data.projectName.replace(" ", "_")}_${
              webHookEvent.meta_data.userId
            }`,
            enabled: true,
            description: `This api key belongs to project: ${webHookEvent.meta_data.projectName} by user: ${webHookEvent.meta_data.userId} for RGBreak.`,
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

        const apiKeyInfo = {
          apiKeyId: apiKey.id,
          usagePlanId: webHookEvent.meta_data.usagePlanId,
        } as ApiKeyInfo;

        const cardInfo = {
          email: eventData.customer.email,
          token: chargeVerificationRes.data.card.token,
          expiry: chargeVerificationRes.data.card.expiry,
        } as CardInfo;

        const createProjectQueryText = `INSERT INTO "Projects"(id, "userId", "projectName", "currentPlan", "apiKey", "apiKeyInfo", "cardInfo", "status", "currentBillingDate", "nextPaymentDate", "createdAt") VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`;
        await pool.query(createProjectQueryText, [
          uuid(),
          webHookEvent.meta_data.userId,
          webHookEvent.meta_data.projectName,
          webHookEvent.meta_data.planName,
          apiKey.value,
          apiKeyInfo,
          cardInfo,
          Status.Active,
          new Date(eventData.created_at),
          getOneMonthFromNow(), //TODO: CHANGE TO ONE MONTH FROM NOW
          new Date(eventData.created_at),
        ]);

        console.log("completed successfully");

        return {
          statusCode: 200,
          body: JSON.stringify({ message: "Api key generated" }),
        };
      }

      console.log("resubscription");

      const apiKeyInfo = existingProject.rows[0].apiKeyInfo as ApiKeyInfo;

      //if there is an existing project, update the next payment date
      // & if they changed their plan, update the usage plan
      if (apiKeyInfo.usagePlanId !== webHookEvent.meta_data.usagePlanId) {
        //CANT RUN IN PARALLEl BECAUSE AN APIKEY CAN ONLY BELONG TO 1 USAGE PLAN AT A TIME
        //remove the user from the old usage plan
        await apiGatewayClient.send(
          new DeleteUsagePlanKeyCommand({
            usagePlanId: apiKeyInfo.usagePlanId,
            keyId: apiKeyInfo.apiKeyId,
          })
        );

        //add their apikey to the new usage plan
        await apiGatewayClient.send(
          new CreateUsagePlanKeyCommand({
            usagePlanId: webHookEvent.meta_data.usagePlanId,
            keyId: apiKeyInfo.apiKeyId,
            keyType: "API_KEY",
          })
        );
      }

      const updateProjectQueryText = `UPDATE "Projects" SET "nextPaymentDate" = $1, "currentBillingDate" = $2, "apiKeyInfo" = $3, "currentPlan" = $4 WHERE id = $5`;
      await pool.query(updateProjectQueryText, [
        getOneMonthFromNow(), //TODO: CHANGE TO ONE MONTH FROM NOW
        new Date(eventData.created_at),
        { ...apiKeyInfo, usagePlanId: webHookEvent.meta_data.usagePlanId },
        webHookEvent.meta_data.planName,
        webHookEvent.meta_data.projectId,
      ]);
    }

    console.log("completed successfully");

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Api key generated" }),
    };
  } catch (error: unknown) {
    console.error(error);

    //let it be caught by the alarm
    throw error;
  }
};
