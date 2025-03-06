import { SQS } from "aws-sdk";
import { Handler } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

import { validatePlan } from "../helpers/fns/validatePlan";
import { ExpiredProject } from "../types/expiredSubscriptionProjectInfo";

const region = process.env.REGION!;
const tableName = process.env.TABLE_NAME!;
const cancelSubscriptionQueueUrl = process.env.QUEUE_URL!;
const paymentGatewayUrl = process.env.PAYMENT_GATEWAY_URL!;
const paymentGatewaySecretName = process.env.PAYMENT_SECRET_NAME!;
const usagePlanSecretName = process.env.AVAILABLE_PLANS_SECRET_NAME!;

const client = new DynamoDBClient({ region });

const dynamo = DynamoDBDocumentClient.from(client);

const sqsQueue = new SQS({ apiVersion: "latest" });

export const handler: Handler = async () => {
  try {
    //get all the projects with pro or exec subscriptions that are active & the nextPaymentDate is less than  or equal to the current date
    const projectsReq = await dynamo.send(
      new QueryCommand({
        IndexName: "expiredSubscriptionIndex",
        TableName: tableName,
        KeyConditionExpression:
          "sub_status = :status AND nextPaymentDate <= :currentDate",
        ExpressionAttributeValues: {
          ":status": "active",
          ":currentDate": Date.now(),
          ":excludedPlan": "free",
        },
        FilterExpression: "currentPlan <> :excludedPlan",
        ProjectionExpression:
          "id, email, userId, projectName, nextPaymentDate, currentPlan, apiKeyInfo, cardTokenInfo",
      })
    );

    if (!projectsReq.Items || !projectsReq.Items.length) {
      console.log("found no projects with expired subscriptions");

      return;
    }

    const projects = projectsReq.Items as ExpiredProject[];

    console.log(projects);

    //we loop through each user & try to resubscribe them, max 2 attempts
    for (const project of projects) {
      let attempts = 0;

      while (attempts < 2) {
        try {
          const { planDetails, chosenUsagePlan, paymentGatewaySecret } =
            await validatePlan({
              paymentGatewaySecretName,
              usagePlanSecretName,
              planName: project.currentPlan,
              region,
              paymentGatewayUrl,
            });

          const chargeReq = await fetch(
            `${paymentGatewayUrl}/tokenized-charges`,
            {
              method: "POST",
              body: JSON.stringify({
                token: project.cardTokenInfo.token,
                email: project.email,
                currency: planDetails.currency,
                countryCode: "NG",
                amount: planDetails.amount,
                tx_ref: `${project.id}-${project.nextPaymentDate}`,
                meta: {
                  projectId: project.id,
                  userId: project.userId,
                  usagePlanId: chosenUsagePlan,
                  projectName: project.projectName.toLowerCase().trim(),
                  planName: planDetails.name.toLowerCase().trim(),
                },
              }),
              headers: {
                Authorization: `Bearer ${paymentGatewaySecret}`,
                "Content-Type": "application/json",
              },
            }
          );

          if (!chargeReq.ok) {
            const errorMessage = await chargeReq.json();

            //only retry for server/netwrk errors
            if (chargeReq.status >= 500) {
              throw new Error(errorMessage.message);
            }

            await sqsQueue
              .sendMessage({
                MessageBody: JSON.stringify(project),
                QueueUrl: cancelSubscriptionQueueUrl,
              })
              .promise()
              .catch((error: unknown) => {
                console.error(
                  "ERROR: Failed to send project with expired subscription to queue",
                  error,
                  project
                );
              });

            break;
          }

          //user was successfully charged
          break;
        } catch (error: unknown) {
          console.error(`Error charging user: ${project.email}`, error);

          attempts++;

          if (attempts >= 2) {
            await sqsQueue
              .sendMessage({
                MessageBody: JSON.stringify(project),
                QueueUrl: cancelSubscriptionQueueUrl,
              })
              .promise()
              .catch((error: unknown) => {
                console.error(
                  "ERROR: Failed to send project with expired subscription to queue",
                  error,
                  project
                );
              });
          }
        }
      }
    }

    return;
  } catch (error: unknown) {
    //this would only catch errors caused when the initial fetch for all expired subs fails
    //throw the error so they can be caught by the alarm
    if (error instanceof Error) {
      console.error(error.message);

      throw error;
    }

    console.error("ERROR: FAILED TO HANDLE RESUBSCRIBTION PROCESS", error);
    throw error;
  }
};
