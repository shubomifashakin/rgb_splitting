import { SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
  GetSecretValueCommandOutput,
} from "@aws-sdk/client-secrets-manager";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { APIGatewayClient } from "@aws-sdk/client-api-gateway";

import {
  GetCommand,
  QueryCommand,
  UpdateCommand,
  DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";

import { ApiKeyInfo } from "../types/apiKeyInfo";
import { ExpiredProject } from "../types/expiredSubscriptionProjectInfo";

import { updateApiKeyStatus } from "../helpers/fns/updateApiKeyStatus";
import {
  PlanType,
  PROJECT_STATUS,
  planTypeToStatus,
  maxActiveFreeProjects,
} from "../helpers/constants";
import { usagePlanValidator } from "../helpers/schemaValidator/usagePlanValidator";
import { migrateExistingProjectApiKey } from "../helpers/fns/migrateExistingProjectApiKey";

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
          userId: projectInfo.userId,
          projectId: projectInfo.projectId,
        });

        //find the project && check if they have up to maxactive free projects
        const [foundProject, freeProjects] = await Promise.allSettled([
          dynamo.send(
            new GetCommand({
              TableName: tableName,
              Key: {
                userId: projectInfo.userId,
                projectId: projectInfo.projectId,
              },
              ProjectionExpression: "apiKeyInfo, sub_status, currentPlan",
            })
          ),

          //checks if they have the max active free projects
          dynamo.send(
            new QueryCommand({
              TableName: tableName,
              IndexName: "userIdSubStatusIndex",
              KeyConditionExpression:
                "userId = :userId and sub_status = :status",
              ExpressionAttributeValues: {
                ":userId": projectInfo.userId,
                ":status": planTypeToStatus[PlanType.Free],
              },
              Limit: maxActiveFreeProjects,
            })
          ),
        ]);

        if (foundProject.status === "rejected") {
          console.error(
            `Error fetching project info, REASON ${foundProject.reason}`
          );

          throw new Error(
            `Failed to get information of project that was scheduled for downgrade ${projectInfo.projectId},`
          );
        }

        if (!foundProject.value.Item) {
          console.error(
            `Project not found for ${projectInfo.email}, projectId ${projectInfo.projectId}`
          );

          throw new Error(
            `Project not found for ${projectInfo.email}, projectId ${projectInfo.projectId}`
          );
        }

        if (freeProjects.status === "fulfilled") {
          console.log(
            "TOTAL ACTIVE FREE PROJECTS --->",
            freeProjects.value.Items?.length
          );
        }

        if (freeProjects.status === "rejected") {
          console.log("failed to get total active free plans");
        }

        const canHaveFreePlan =
          freeProjects.status === "fulfilled"
            ? freeProjects.value.Items &&
              freeProjects.value.Items.length < maxActiveFreeProjects
            : false;

        const {
          apiKeyInfo: { apiKeyId, usagePlanId },
          sub_status,
          currentPlan,
        } = foundProject.value.Item as {
          apiKeyInfo: ApiKeyInfo;
          sub_status: PROJECT_STATUS;
          currentPlan: PlanType;
        };

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

        //if they can have a free plan, remove the key from their old usage plan & attach to free usage plan
        if (canHaveFreePlan) {
          await migrateExistingProjectApiKey({
            apiGatewayClient,
            projectStatus: sub_status,
            newUsagePlanId: allUsagePlans.free,
            apiKeyInfo: { usagePlanId, apiKeyId },
          });
        }

        //disable the apikey if they cannot have a free plan
        if (!canHaveFreePlan) {
          await updateApiKeyStatus(
            apiGatewayClient,
            { apiKeyId, usagePlanId },
            "false"
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
              "set apiKeyInfo.usagePlanId = :usagePlanId, currentPlan = :planName, sub_status = :subStatus",
            ExpressionAttributeValues: {
              ":planName": canHaveFreePlan ? PlanType.Free : currentPlan,
              ":usagePlanId": canHaveFreePlan
                ? allUsagePlans.free
                : usagePlanId,
              ":subStatus": canHaveFreePlan
                ? planTypeToStatus[PlanType.Free]
                : PROJECT_STATUS.Inactive,
            },
          })
        );

        console.log("completed successfully");

        //TODO: send a message to the user stating that they have been downgraded or cancelled
        //your project {nameOfProject} has been downgraded or cancelled
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
