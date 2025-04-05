import { Handler, SQSEvent } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

import { validatePlan } from "../helpers/fns/validatePlan";
import { PlanType, planTypeToStatus } from "../helpers/constants";

import { ExpiredProject } from "../types/expiredSubscriptionProjectInfo";

const region = process.env.REGION!;
const tableName = process.env.TABLE_NAME!;
const paymentGatewayUrl = process.env.PAYMENT_GATEWAY_URL!;
const paymentGatewaySecretName = process.env.PAYMENT_SECRET_NAME!;
const usagePlanSecretName = process.env.AVAILABLE_PLANS_SECRET_NAME!;
const resubscribeQueueUrl = process.env.RESUBSCRIBE_QUEUE_URL!;
const downgradeSubscriptionQueueUrl =
  process.env.DOWNGRADE_SUBSCRIPTION_QUEUE_URL!;

const client = new DynamoDBClient({ region });

const dynamo = DynamoDBDocumentClient.from(client);

const sqsQueue = new SQSClient({ apiVersion: "latest" });

//this works like this, it is initially triggered by an eventbridge schedule every 7 days
//on first invocation, it has no cursor, so we fetch from the beginning
//after initial fetch, if there is a last evaluated batch, then it means there are still more items in the table that satisfy our condition
//if there is a last evaluated key, we send it to the queue and the process will continue

//this is a recursive process, because the queue continues to trigger the lambda until there are no batches left
export const handler: Handler = async (event: SQSEvent | null) => {
  console.log("event", event);

  //this is the last evaluated key from the previous batch if this was a queue triggered invocation
  //if it wasnt, it will be undefined
  const cursor =
    event && event?.Records?.[0]?.body
      ? (JSON.parse(event.Records[0].body) as {
          pro: Record<string, any> | undefined;
          exec: Record<string, any> | undefined;
        })
      : undefined;

  console.log("STARTING CURSORS", cursor);

  const batchLimit = 2500; //TODO: CHANGE TO 2500

  try {
    //get all the projects with pro or exec subscriptions that are active & the nextPaymentDate is less than  or equal to the current date
    const [proExpiringProjectsReq, execExpiringProjectsReq] = await Promise.all(
      [
        dynamo.send(
          new QueryCommand({
            IndexName: "expiredSubscriptionIndex",
            TableName: tableName,
            KeyConditionExpression:
              "sub_status = :status AND nextPaymentDate <= :currentDate",
            ExpressionAttributeValues: {
              ":currentDate": Date.now(),
              ":status": planTypeToStatus[PlanType.Pro],
            },
            ProjectionExpression:
              "projectId, email, userId, projectName, nextPaymentDate, currentPlan, cardTokenInfo",
            Limit: batchLimit,
            ExclusiveStartKey: cursor?.pro,
          })
        ),
        dynamo.send(
          new QueryCommand({
            IndexName: "expiredSubscriptionIndex",
            TableName: tableName,
            KeyConditionExpression:
              "sub_status = :status AND nextPaymentDate <= :currentDate",
            ExpressionAttributeValues: {
              ":currentDate": Date.now(),
              ":status": planTypeToStatus[PlanType.Executive],
            },
            ProjectionExpression:
              "projectId, email, userId, projectName, nextPaymentDate, currentPlan, cardTokenInfo",
            Limit: batchLimit,
            ExclusiveStartKey: cursor?.exec,
          })
        ),
      ]
    );

    //if there are no expired projects at all, exit
    if (
      proExpiringProjectsReq.Items &&
      !proExpiringProjectsReq.Items.length &&
      execExpiringProjectsReq.Items &&
      !execExpiringProjectsReq.Items.length
    ) {
      console.log("found no projects with expired subscriptions");
      return;
    }

    const projects = [
      ...(proExpiringProjectsReq.Items || []),
      ...(execExpiringProjectsReq.Items || []),
    ] as ExpiredProject[];

    console.log("EXPIRED PROJECTS", projects);

    //we loop through each user & try to resubscribe them, max 2 attempts
    for (const project of projects) {
      let attempts = 0;

      while (attempts < 2) {
        //delay the execution by 1 second
        await new Promise((resolve) => setTimeout(resolve, 1000));

        try {
          const { planDetails, chosenUsagePlanId, paymentGatewaySecret } =
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
                email: project.email,
                currency: planDetails.currency,
                token: project.cardTokenInfo.cardToken,
                countryCode: "NG",
                amount: planDetails.amount,
                tx_ref: `${project.projectId}-${project.nextPaymentDate}`,
                narration: `Renewal Charge for project: ${project.projectName}`,
                meta: {
                  userId: project.userId,
                  projectId: project.projectId,
                  usagePlanId: chosenUsagePlanId,
                  planName: planDetails.name.toLowerCase().trim(),
                  projectName: project.projectName.toLowerCase().trim(),
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

            console.log("SENDING USER TO DOWNGRADE QUEUE", project);

            await sqsQueue
              .send(
                new SendMessageCommand({
                  MessageBody: JSON.stringify(project),
                  QueueUrl: downgradeSubscriptionQueueUrl,
                })
              )
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
          console.log("charged user  successfully");
          break;
        } catch (error: unknown) {
          console.error(`Error charging user: ${project.email}`, error);

          attempts++;

          if (attempts >= 2) {
            console.log("SENDING USER TO DOWNGRADE QUEUE", project);
            await sqsQueue
              .send(
                new SendMessageCommand({
                  MessageBody: JSON.stringify(project),
                  QueueUrl: downgradeSubscriptionQueueUrl,
                })
              )
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

    console.log(
      "NEXT CURSORS",
      proExpiringProjectsReq.LastEvaluatedKey,
      execExpiringProjectsReq.LastEvaluatedKey
    );

    //if there are more projects to process, send them to the queue -- THIS IS TRUE IF THERE IS A LAST EVALUATEDKEY RETURNED
    if (
      proExpiringProjectsReq.LastEvaluatedKey ||
      execExpiringProjectsReq.LastEvaluatedKey
    ) {
      console.log(
        "There are more unprocessed projects, sending cursors to resubscribe queue"
      );

      await sqsQueue.send(
        new SendMessageCommand({
          MessageBody: JSON.stringify({
            pro: proExpiringProjectsReq.LastEvaluatedKey,
            exec: execExpiringProjectsReq.LastEvaluatedKey,
          }),
          QueueUrl: resubscribeQueueUrl,
        })
      );
    }

    console.log("completed successfully");
    return;
  } catch (error: unknown) {
    //this would only catch errors caused when the initial fetch for all expired subs fails or when the sqs send fails
    //throw the error so they can be caught by the alarm
    if (error instanceof Error) {
      console.error(error.message);

      throw error;
    }

    console.error("ERROR: FAILED TO HANDLE RESUBSCRIBTION PROCESS", error);

    throw error;
  }
};
