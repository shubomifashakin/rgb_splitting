import { EventBridgeEvent, Handler, SQSEvent } from "aws-lambda";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";

import { Pool } from "pg";

import { PlanType, Status } from "../helpers/constants";
import { validatePlan } from "../helpers/fns/validatePlan";

import { ExpiredProject } from "../types/expiredSubscriptionProjectInfo";
import { CardInfo } from "../types/cardInfo";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

const region = process.env.REGION!;
const paymentGatewayUrl = process.env.PAYMENT_GATEWAY_URL!;
const paymentGatewaySecretName = process.env.PAYMENT_SECRET_NAME!;
const usagePlanSecretName = process.env.AVAILABLE_PLANS_SECRET_NAME!;
const resubscribeQueueUrl = process.env.RESUBSCRIBE_QUEUE_URL!;
const cancelSubscriptionQueueUrl = process.env.CANCEL_SUBSCRIPTION_QUEUE_URL!;

const dbHost = process.env.DB_HOST!;
const dbPort = process.env.DB_PORT!;
const dbSecretArn = process.env.DB_SECRET_ARN!;

const sqsQueue = new SQSClient({ apiVersion: "latest" });
const secretClient = new SecretsManagerClient({ region });

let pool: Pool | undefined;

//so this function works like this, every 7 days it is invoked by an event bridge rule,this is what starts the resubscription process for expired projects
//once that first invocation is complete, if there are still more expired projects that werent fetched (if we got more than our batch), it will send the information of the last processed user to the queue
//the queue will trigger the lambda again, and the process will repeat
//but the time the queue triggers the lambda we have a cursor, this is the last evaluated key from the previous batch
//this is where our queries start from

//i set a batch limit for fetching expired projects, howeve during the fetching process, i increased the limit by one to check if there a other batches
//this allows us to check for more batches while excluding the extra item from the resubscription process.
//if we do retrieve this extra item,it means that there are likely more batches to process, --- THEN WE KNOW WE HAVE A NEXT BATCH AND PASS THE LAST USERS INFO TO THE SQS

//this is a recursive design, the process would repeat until there are no more projects to process
export const handler: Handler = async (event) => {
  console.log("event", event);

  //this is the last evaluated key from the previous batch if this was a queue triggered invocation
  //if it wasnt, it will be undefined
  let cursor: { createdAt: Date; id: string } | null = null;

  if (event?.Records?.length > 0) {
    const messageBody = JSON.parse(event.Records[0].body) as {
      createdAt: Date;
      id: string;
    };

    cursor = messageBody;
  }

  console.log("STARTING RESUBSCRIPTION PROCESS");

  console.log("STARTING CURSOR", cursor);

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
      database: dbname,
      password,
      port: Number(dbPort),
      ssl: { rejectUnauthorized: false },
    });
  }

  const batchLimit = 5000;

  try {
    //fetch 1 more than the batchLimit, to check if there is a next batch
    const projects = await pool.query(
      `SELECT 
      id, 
      "projectName", 
      "nextPaymentDate", 
      "currentPlan", 
      "cardInfo", 
      "apiKeyInfo", 
      "createdAt", 
      "userId"
   FROM "Projects" 
   WHERE "status" = $1 
   AND "nextPaymentDate" <= $2 
   AND "currentPlan" <> $3
   AND ($4::timestamp IS NULL OR ("createdAt", id) > ($4, $5))  -- Cursor condition
   ORDER BY "createdAt" ASC, id ASC  -- Order by time, tie-break with UUID
   LIMIT $6`,
      [
        Status.Active,
        new Date(),
        PlanType.Free,
        cursor?.createdAt || null, // If no cursor, fetch first page
        cursor?.id || null,
        batchLimit + 1, //get one extra project
      ]
    );

    //if there are no project items and theres also no next batch, exit
    if (!projects.rowCount) {
      console.log("found no projects with expired subscriptions");

      return;
    }

    //remove the extra item added
    const projectsToProcess = projects.rows.slice(
      0,
      batchLimit
    ) as ExpiredProject[];

    //the expired projects to be processed
    console.log("EXPIRED PROJECTS", projects);

    //we loop through each user & try to resubscribe them, max 2 attempts
    for (const project of projectsToProcess) {
      let attempts = 0;

      const cardInfo = project.cardInfo as CardInfo;

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
                countryCode: "NG",
                token: cardInfo.token,
                email: cardInfo.email,
                amount: planDetails.amount,
                currency: planDetails.currency,
                tx_ref: `${project.id}-${project.nextPaymentDate.getTime()}`,
                narration: `Renewal Charge for project: ${project.projectName}`,
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

            console.error(
              `failed to charge user ${project.userId} for project: ${project.projectName} with projectId: ${project.id}, sending to queue`,
              errorMessage
            );

            await sqsQueue
              .send(
                new SendMessageCommand({
                  MessageBody: JSON.stringify(project),
                  QueueUrl: cancelSubscriptionQueueUrl,
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

          console.log(
            `successfully charged user ${project.userId} for ${project.projectName}`
          );

          //user was successfully charged
          break;
        } catch (error: unknown) {
          console.error(
            `Error charging user: ${project.userId} for project ${project.projectName}, projectId: ${project.id}`,
            error
          );

          attempts++;

          if (attempts >= 2) {
            await sqsQueue
              .send(
                new SendMessageCommand({
                  MessageBody: JSON.stringify(project),
                  QueueUrl: cancelSubscriptionQueueUrl,
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

    const lastItem = projects.rows[projects.rows.length - 1];

    //if there are possibly more projects to process, send them to the queue -- THIS IS TRUE IF WE GET MORE THAN THE EXPECTED BATCH, REMEMBER WE GOT AN EXTRA ONE
    if (projects.rowCount > batchLimit) {
      console.log("SENDING NEXT CURSOR");

      await sqsQueue.send(
        new SendMessageCommand({
          MessageBody: JSON.stringify({
            createdAt: lastItem.createdAt,
            id: lastItem.id,
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
