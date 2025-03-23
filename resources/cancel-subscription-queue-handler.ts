import { SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import {
  GetSecretValueCommand,
  GetSecretValueCommandOutput,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  APIGatewayClient,
  NotFoundException,
  CreateUsagePlanKeyCommand,
  DeleteUsagePlanKeyCommand,
  GetUsagePlanKeyCommand,
} from "@aws-sdk/client-api-gateway";

import {
  GetCommand,
  UpdateCommand,
  DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";

import { ExpiredProject } from "../types/expiredSubscriptionProjectInfo";

import { PlanType } from "../helpers/constants";
import { usagePlanValidator } from "../helpers/schemaValidator/usagePlanValidator";

const region = process.env.REGION!;
const tableName = process.env.TABLE_NAME!;
const usagePlanSecretName = process.env.AVAILABLE_PLANS_SECRET_NAME!;

const client = new DynamoDBClient({ region });
const dynamo = DynamoDBDocumentClient.from(client);

const apiGatewayClient = new APIGatewayClient({
  region,
});

const secretClient = new SecretsManagerClient({
  region,
});

let allUsagePlanIds: GetSecretValueCommandOutput | undefined;

//if a message fails to process, mark is as failed
export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const cancelledProjects = event.Records;

  const batchItemFailures: SQSBatchItemFailure[] = [];

  await Promise.allSettled(
    cancelledProjects.map(async (project) => {
      try {
        const projectInfo = JSON.parse(project.body) as ExpiredProject;

        console.log("Processing project", {
          projectId: projectInfo.projectId,
          userId: projectInfo.userId,
        });

        //find the project
        const existingProject = await dynamo.send(
          new GetCommand({
            TableName: tableName,
            Key: {
              projectId: projectInfo.projectId,
              userId: projectInfo.userId,
            },
            ProjectionExpression: "apiKeyInfo",
          })
        );

        if (!existingProject.Item) {
          throw new Error(
            `Project not found for ${projectInfo.email}, projectId ${projectInfo.projectId}`
          );
        }

        //get all the available usagePlanIds, if not already available
        if (!allUsagePlanIds) {
          allUsagePlanIds = await secretClient.send(
            new GetSecretValueCommand({ SecretId: usagePlanSecretName })
          );
        }

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

        await dynamo.send(
          new UpdateCommand({
            TableName: tableName,
            Key: {
              userId: projectInfo.userId,
              projectId: projectInfo.projectId,
            },
            UpdateExpression:
              "set apiKeyInfo.usagePlanId = :usagePlanId, currentPlan = :planName",
            ExpressionAttributeValues: {
              ":planName": PlanType.Free,
              ":usagePlanId": allUsagePlans.free,
            },
          })
        );

        console.log("completed successfully");

        //TODO: send a message to the user stating that they have been downgraded
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
