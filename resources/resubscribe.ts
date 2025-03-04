import { Handler } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

import { v4 as uuid } from "uuid";
import { validatePlan } from "../helpers/fns/validatePlan";

const region = process.env.REGION!;
const tableName = process.env.TABLE_NAME!;
const paymentGatewaySecretName = process.env.PAYMENT_SECRET_NAME!;
const availableUsagePlansSecretName = process.env.AVAILABLE_PLANS_SECRET_NAME!;

const client = new DynamoDBClient({ region });

const dynamo = DynamoDBDocumentClient.from(client);

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const handler: Handler = async () => {
  try {
    //get all the users with pro or exec subscriptions that are active & the nextPaymentDate is less than  or equal to the current date
    const usersReq = await dynamo.send(
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

    if (!usersReq.Items || !usersReq.Items.length) {
      console.log("found no users with expired subscriptions");

      return;
    }

    const users = usersReq.Items as {
      id: string;
      email: string;
      userId: string;
      projectName: string;
      nextPaymentDate: number;
      currentPlan: string;

      apiKeyInfo: {
        apiKey: string;
        usagePlanId: string;
      };

      cardTokenInfo: {
        token: string;
        expiry: string;
      };
    }[];

    const failedPayments = [];

    //we loop through each user & try to resubscribe them, max 2 attempts
    for (const user of users) {
      let attempts = 0;
      let chargeSuccessful = false;

      while (!chargeSuccessful && attempts < 2) {
        try {
          const { planDetails, chosenUsagePlan, paymentGatewaySecret } =
            await validatePlan(
              paymentGatewaySecretName,
              availableUsagePlansSecretName,
              user.currentPlan,
              region
            );

          // Delay for 2 second before retrying
          if (attempts > 0) {
            await delay(2000);
          }

          const chargeReq = await fetch(
            "https://api.flutterwave.com/v3/tokenized-charges",
            {
              method: "POST",
              body: JSON.stringify({
                token: user.cardTokenInfo.token,
                email: user.email,
                currency: planDetails.currency,
                countryCode: "NG",
                amount: planDetails.amount,
                tx_ref: uuid(),
                meta: {
                  projectId: user.id,
                  userId: user.userId,
                  usagePlanId: chosenUsagePlan,
                  projectName: user.projectName.toLowerCase().trim(),
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

            throw new Error(errorMessage.message);
          }

          //user was successfully cahrged
          chargeSuccessful = true;
        } catch (error: unknown) {
          console.log(`Error charging user: ${user.email}`, error);

          attempts++;

          if (attempts >= 2) {
            failedPayments.push({
              user,
              error,
            });
          }
        }
      }
    }

    //TODO:  //after the for loop has finished, if there are failed payments, send them to the cancellation queue
    // if (failedPayments.length) {
    // }

    return;
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.log(error.message);

      return;
    }

    console.log("FAILED TO  RESUBSCRIBE", error);
  }
};
