import {
  APIGatewayClient,
  CreateApiKeyCommand,
  CreateUsagePlanKeyCommand,
} from "@aws-sdk/client-api-gateway";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { v4 as uuid } from "uuid";

import { PlanType, planTypeToStatus } from "../constants";
import { getOneMonthFromDate } from "./oneMonthFromDate";

import { ApiKeyInfo } from "../../types/apiKeyInfo";
import { CardTokenInfo } from "../../types/cardTokenInfo";

/**
 *  This creates the apikey, attaches it to the specified usage plan & then stores the users result
 */
export async function CreateApiKeyAndAttachToUsagePlan({
  email,
  userId,
  projectId,
  tableName,
  cardToken,
  createdAt,
  cardExpiry,
  usagePlanId,
  currentPlan,
  projectName,
  dynamoClient,
  apiGatewayClient,
}: {
  email: string;
  userId: string;
  tableName: string;
  projectId: string;
  createdAt: string;
  projectName: string;
  currentPlan: PlanType;
  usagePlanId: string;
  cardExpiry: string;
  cardToken: string;
  apiGatewayClient: APIGatewayClient;
  dynamoClient: DynamoDBDocumentClient;
}) {
  const apiKey = await apiGatewayClient.send(
    new CreateApiKeyCommand({
      value: uuid(),
      name: `${projectName.replace(" ", "_")}_${userId}`,
      enabled: true,
    })
  );

  if (!apiKey.id || !apiKey.value) {
    console.error(
      `Failed to create api key for project ${projectName} by user ${userId}`
    );

    throw new Error("Internal server error - failed to create api key");
  }

  //add the apikey generated to the usage plan
  await apiGatewayClient.send(
    new CreateUsagePlanKeyCommand({
      usagePlanId: usagePlanId,
      keyId: apiKey.id,
      keyType: "API_KEY",
    })
  );

  const apiKeyInfo: ApiKeyInfo = {
    apiKeyId: apiKey.id,
    usagePlanId: usagePlanId,
  };

  let cardTokenInfo: CardTokenInfo = {
    cardToken,
    cardExpiry,
  };

  await dynamoClient.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        email,
        userId,
        projectId,
        apiKeyInfo,
        currentPlan,
        projectName,
        cardTokenInfo,

        apiKey: apiKey.value,

        nextPaymentDate: getOneMonthFromDate(createdAt), //TODO: CHANGE TO ONE MONTH FROM NOW
        sub_status: planTypeToStatus[currentPlan],
        currentBillingDate: new Date(createdAt).getTime(),
        createdAt: new Date(createdAt).getTime(),
      },
    })
  );

  console.log("completed successfully");

  return {
    statusCode: 200,
    body: JSON.stringify({ message: "Api key generated" }),
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Api-Key",
    },
  };
}
