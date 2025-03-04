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
    //get all the users with subscriptions that are active but the nextPaymentDate is less than the current date
    const usersReq = await dynamo.send(
      new QueryCommand({
        IndexName: "expiredSubscriptionIndex",
        TableName: tableName,
        KeyConditionExpression:
          "sub_status = :status AND nextPaymentDate <= :currentDate",
        ExpressionAttributeValues: {
          ":status": "active",
          ":currentDate": Date.now(),
        },
        ProjectionExpression:
          "nextPaymentDate, apiKeyInfo, id, email, userId, sub_status, cardTokenInfo, projectName",
      })
    );

    if (!usersReq.Items || !usersReq.Items.length) {
      return;
    }

    const users = usersReq.Items as {
      id: string;
      email: string;
      sub_status: string;
      userId: string;
      nextPaymentDate: number;
      projectName: string;

      apiKeyInfo: {
        apiKey: string;
        currentPlan: string;
        usagePlanId: string;
      };

      cardTokenInfo: {
        token: string;
        expiry: string;
      };
    }[];

    for (const user of users) {
      let attempts = 0;
      let chargeSuccessful = false;

      while (!chargeSuccessful && attempts < 2) {
        try {
          const { planDetails, chosenUsagePlan, paymentGatewaySecret } =
            await validatePlan(
              paymentGatewaySecretName,
              availableUsagePlansSecretName,
              user.apiKeyInfo.currentPlan,
              region
            );

          // Delay for 2 seconds
          await delay(2000);

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
                  planName: planDetails.name.toLowerCase().trim(),
                  usagePlanId: chosenUsagePlan,
                  projectName: user.projectName.toLowerCase().trim(),
                },
              }),
              headers: {
                Authorization: `Bearer ${paymentGatewaySecret}`,
                "Content-Type": "application/json",
              },
            }
          );

          if (!chargeReq.ok) {
            attempts++;

            continue;
          }

          //user was successfully cahrged
          chargeSuccessful = true;
        } catch (error: unknown) {
          console.log(`Error charging user: ${user.email}`, error);

          attempts++;

          if (attempts >= 3) {
            const cancelParams = {
              TableName: tableName,
              Key: { userId: user.userId },
              UpdateExpression: "set sub_status = :cancelled",
              ExpressionAttributeValues: {
                ":cancelled": "cancelled",
              },
            };
          }
        }
      }
    }
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.log(error.message);

      return;
    }

    console.log("FAILED TO  RESUBSCRIBE", error);
  }
};
