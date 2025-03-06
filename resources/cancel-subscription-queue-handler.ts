import { SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { APIGateway, SecretsManager } from "aws-sdk";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

import { ExpiredProject } from "../types/expiredSubscriptionProjectInfo";

import { usagePlanValidator } from "../helpers/schemaValidator/validators";

const region = process.env.REGION!;
const tableName = process.env.TABLE_NAME!;
const usagePlanSecretName = process.env.AVAILABLE_PLANS_SECRET_NAME!;

const client = new DynamoDBClient({ region });
const dynamo = DynamoDBDocumentClient.from(client);

const apiGateway = new APIGateway();

const secretClient = new SecretsManager({
  region,
});

//if a message fails to process, mark is as failed
export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const cancelledProjects = event.Records;

  const batchItemFailures: SQSBatchItemFailure[] = [];

  await Promise.allSettled(
    cancelledProjects.map(async (project) => {
      try {
        const projectInfo = JSON.parse(project.body) as ExpiredProject;

        console.log("Processing project", {
          projectId: projectInfo.id,
          userId: projectInfo.userId,
        });

        //find the project
        const existingProject = await dynamo.send(
          new GetCommand({
            TableName: tableName,
            Key: { id: projectInfo.id, userId: projectInfo.userId },
            ProjectionExpression: "apiKeyInfo",
          })
        );

        if (!existingProject.Item) {
          throw new Error(
            `Project not found for ${projectInfo.email}, projectId ${projectInfo.id}`
          );
        }

        //get all the available usagePlanIds
        const allUsagePlanIds = await secretClient
          .getSecretValue({ SecretId: usagePlanSecretName })
          .promise();

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

        //remove the user from the old usage plan
        await apiGateway
          .deleteUsagePlanKey({
            usagePlanId: projectInfo.apiKeyInfo.usagePlanId,
            keyId: projectInfo.apiKeyInfo.apiKeyId,
          })
          .promise();

        //add their apikey to the free usage plan
        await apiGateway
          .createUsagePlanKey({
            usagePlanId: allUsagePlans.free,
            keyId: projectInfo.apiKeyInfo.apiKeyId,
            keyType: "API_KEY",
          })
          .promise();

        await dynamo.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { id: projectInfo.id, userId: projectInfo.userId },
            UpdateExpression:
              "set apiKeyInfo.usagePlanId = :usagePlanId, currentPlan = :planName",
            ExpressionAttributeValues: {
              ":planName": "free",
              ":usagePlanId": allUsagePlans.free,
            },
          })
        );
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
