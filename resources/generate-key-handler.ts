import { APIGateway } from "aws-sdk";
import { APIGatewayProxyEventV2, Handler } from "aws-lambda";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

import { v4 as uuid } from "uuid";

import { webHookValidationSchema } from "../helpers/schemaValidator/validators";

const region = process.env.REGION;
const tableName = process.env.TABLE_NAME;
const freeTierUsagePlanId = process.env.FREE_TIER_USAGE_PLAN_ID;
const proTierUsagePlanId = process.env.PRO_TIER_USAGE_PLAN_ID;
const executiveTierUsagePlanId = process.env.EXECUTIVE_TIER_USAGE_PLAN_ID;

const plans = [
  freeTierUsagePlanId,
  proTierUsagePlanId,
  executiveTierUsagePlanId,
];

const client = new DynamoDBClient({ region });

const dynamo = DynamoDBDocumentClient.from(client);

//this acts as a  webhook url, only called by the payment gateway
export const handler: Handler = async (event: APIGatewayProxyEventV2) => {
  const body = event.body;

  const apiGateway = new APIGateway();

  try {
    const apiKey = await apiGateway
      .createApiKey({
        value: uuid(),
        name: "rgb_splitting_key", //TODO: Include the users userId in this
        enabled: true,
      })
      .promise();

    if (!apiKey.id || !apiKey.value) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          message: "Internal server error - failed to create api key",
        }),
      };
    }

    //TODO: ADD THE APIKEY TO THE USAGE PLAN, BASED ON WHAT THE USER PAID FOR
    //add the apikey generated to the usage plan
    const usagePlans = await apiGateway
      .createUsagePlanKey({
        usagePlanId: freeTierUsagePlanId as string,
        keyId: apiKey.id,
        keyType: "API_KEY",
      })
      .promise();

    await dynamo.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          userId: "user1234", //TODO: THE USERS ID GOTTEN FROM THE WEBHOOK
          apiKey: apiKey.value,
          createdAt: Date.now(),
          id: uuid(),
          projectName: "project1", //TODO: THE NAME OF THE PROJECT GOTTEN FROM THE WEBHOOK
          currentPlan: "", //TODO: THE PLAN THE API KEY IS ON, BASED ON THE PLAN THEY PAID FOR
        },
      })
    );

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Api key generated", key: apiKey.value }),
    };
  } catch (error: unknown) {
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Internal server error", error }),
    };
  }
};
