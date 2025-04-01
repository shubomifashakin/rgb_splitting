import { SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
  GetSecretValueCommandOutput,
} from "@aws-sdk/client-secrets-manager";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  APIGatewayClient,
  NotFoundException,
  GetUsagePlanKeyCommand,
  CreateUsagePlanKeyCommand,
  UpdateApiKeyCommand,
} from "@aws-sdk/client-api-gateway";

import {
  GetCommand,
  QueryCommand,
  UpdateCommand,
  DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";

import { ApiKeyInfo } from "../types/apiKeyInfo";
import { ExpiredProject } from "../types/expiredSubscriptionProjectInfo";

import { updateApiKey } from "../helpers/fns/updateApiKey";
import { PlanType, PROJECT_STATUS } from "../helpers/constants";
import { removeFromOldPlan } from "../helpers/fns/removeFromOldPlan";
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
          userId: projectInfo.userId,
          projectId: projectInfo.projectId,
        });

        //find the project && check if they have up to 3 active free projects
        const [foundProject, freeProjects] = await Promise.all([
          dynamo.send(
            new GetCommand({
              TableName: tableName,
              Key: {
                projectId: projectInfo.projectId,
                userId: projectInfo.userId,
              },
              ProjectionExpression: "apiKeyInfo",
            })
          ),

          dynamo.send(
            new QueryCommand({
              TableName: tableName,
              IndexName: "userIdIndex",
              KeyConditionExpression: "userId = :userId",
              ExpressionAttributeValues: {
                ":planName": PlanType.Free,
                ":userId": projectInfo.userId,
                ":status": PROJECT_STATUS.Active,
              },
              FilterExpression:
                "currentPlan = :planName AND sub_status = :status",
              Limit: 3,
            })
          ),
        ]);

        if (!foundProject.Item) {
          throw new Error(
            `Project not found for ${projectInfo.email}, projectId ${projectInfo.projectId}`
          );
        }

        console.log(
          "AMOUNT OF ACTIVE FREE PROJECTS",
          freeProjects.Items?.length
        );

        const canHaveFreePlan =
          freeProjects.Items && freeProjects.Items.length < 3;

        const {
          apiKeyInfo: { apiKeyId, usagePlanId },
        } = foundProject.Item as {
          apiKeyInfo: ApiKeyInfo;
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
          await removeFromOldPlan({ apiKeyId, usagePlanId }, apiGatewayClient);

          let isAttachedToFreePlan = false;

          try {
            await apiGatewayClient.send(
              new GetUsagePlanKeyCommand({
                usagePlanId: allUsagePlans.free,
                keyId: apiKeyId,
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

          console.log("is attached to free plan", isAttachedToFreePlan);

          if (!isAttachedToFreePlan) {
            console.log("attaching to free plan");

            await apiGatewayClient.send(
              new CreateUsagePlanKeyCommand({
                usagePlanId: allUsagePlans.free,
                keyId: apiKeyId,
                keyType: "API_KEY",
              })
            );
          }
        }

        //disable the apikey if they cannot have a free plan
        if (!canHaveFreePlan) {
          await updateApiKey(
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
              ":planName": PlanType.Free,
              ":usagePlanId": canHaveFreePlan
                ? allUsagePlans.free
                : usagePlanId,
              ":subStatus": canHaveFreePlan
                ? PROJECT_STATUS.Active
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
