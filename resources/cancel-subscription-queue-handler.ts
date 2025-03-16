import { SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import {
  APIGatewayClient,
  CreateUsagePlanKeyCommand,
  DeleteUsagePlanKeyCommand,
  GetUsagePlanKeyCommand,
  NotFoundException,
} from "@aws-sdk/client-api-gateway";

import { Pool } from "pg";

import { ExpiredProject } from "../types/expiredSubscriptionProjectInfo";

import { usagePlanValidator } from "../helpers/schemaValidator/validators";
import { PlanType } from "../helpers/constants";

const region = process.env.REGION!;
const dbHost = process.env.DB_HOST!;
const dbUser = process.env.DB_USER!;
const dbName = process.env.DB_NAME!;
const dbPort = process.env.DB_PORT!;
const dbPassword = process.env.DB_PASSWORD!;
const usagePlanSecretName = process.env.AVAILABLE_PLANS_SECRET_NAME!;

const apiGatewayClient = new APIGatewayClient({
  region,
});

const secretClient = new SecretsManagerClient({
  region,
});

let pool: Pool | undefined;

//if a message fails to process, mark is as failed
export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const cancelledProjects = event.Records;

  const batchItemFailures: SQSBatchItemFailure[] = [];

  console.log("started", cancelledProjects);

  if (!pool) {
    pool = new Pool({
      host: dbHost,
      user: dbUser,
      password: dbPassword,
      database: dbName,
      port: Number(dbPort),
      ssl: { rejectUnauthorized: false },
    });
  }

  await Promise.allSettled(
    cancelledProjects.map(async (project) => {
      try {
        const projectInfo = JSON.parse(project.body) as ExpiredProject;

        console.log("Processing project", {
          projectId: projectInfo.id,
          userId: projectInfo.userId,
          userEmail: projectInfo.userEmail,
        });

        if (!pool) {
          throw new Error("Pool not initialized");
        }

        //get all the available usagePlanIds
        const allUsagePlanIds = await secretClient.send(
          new GetSecretValueCommand({ SecretId: usagePlanSecretName })
        );

        if (!allUsagePlanIds.SecretString) {
          console.error("Available usage plans secret not found, is empty");

          throw new Error("Missing usage plans");
        }

        //validate the usage plans received
        const {
          success,
          error,
          data: allUsagePlans,
        } = usagePlanValidator.safeParse(
          JSON.parse(allUsagePlanIds.SecretString)
        );

        if (!success) {
          console.error("Usage plans error", error.issues);

          throw new Error(`Invalid usage plan structure ${error.issues}`);
        }

        //I DO THIS CUS, IF THIS PARTICULAR BATCH RECORD IN THE LOOP FAILS AT ANY POINT HERE, WE KNOW WHAT PART TO SKIP WHEN ITS RETRYING

        // Check if attached to old plan
        let isAttachedToOldPlan = false;

        try {
          await apiGatewayClient.send(
            new GetUsagePlanKeyCommand({
              usagePlanId: projectInfo.apiKeyInfo.usagePlanId,
              keyId: projectInfo.apiKeyInfo.apiKeyId,
            })
          );

          isAttachedToOldPlan = true;
        } catch (error: unknown) {
          //if it is not, it throws this error
          if (error instanceof NotFoundException) {
            isAttachedToOldPlan = false;
          } else {
            //throw alll other errorss
            throw error;
          }
        }

        //if it is attached to the old plan, remove it, if not skip
        if (isAttachedToOldPlan) {
          await apiGatewayClient.send(
            new DeleteUsagePlanKeyCommand({
              usagePlanId: projectInfo.apiKeyInfo.usagePlanId,
              keyId: projectInfo.apiKeyInfo.apiKeyId,
            })
          );
        }

        //check if it has already been attached to free plan
        let isAttachedToFreePlan = false;

        try {
          await apiGatewayClient.send(
            new GetUsagePlanKeyCommand({
              usagePlanId: allUsagePlans.free,
              keyId: projectInfo.apiKeyInfo.apiKeyId,
            })
          );

          isAttachedToFreePlan = true;
        } catch (error: unknown) {
          // If NotFoundException, the key is not in the free plan
          if (error instanceof NotFoundException) {
            isAttachedToFreePlan = false;
          } else {
            throw error;
          }
        }

        //if not attached to free plan, add it
        if (!isAttachedToFreePlan) {
          await apiGatewayClient.send(
            new CreateUsagePlanKeyCommand({
              usagePlanId: allUsagePlans.free,
              keyId: projectInfo.apiKeyInfo.apiKeyId,
              keyType: "API_KEY",
            })
          );
        }

        await pool.query(
          `UPDATE "Projects" SET "currentPlan" = $1, "apiKeyInfo" = $2 WHERE id = $3`,
          [
            PlanType.Free,
            { ...projectInfo.apiKeyInfo, usagePlanId: allUsagePlans.free },
            projectInfo.id,
          ]
        );

        //send a message to the user stating that they have been downgraded
        //your project {nameOfProject} has been downgraded to free plan
      } catch (error) {
        console.error(error);

        batchItemFailures.push({
          itemIdentifier: project.messageId,
        });
      }
    })
  );

  console.log("Batch item failures", batchItemFailures);

  return { batchItemFailures: batchItemFailures };
};
