import { APIGateway } from "aws-sdk";
import { APIGatewayProxyEventV2, Handler } from "aws-lambda";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

import { v4 as uuid } from "uuid";

import { signUpBodyValidator } from "../helpers/schemaValidator/validators";

const region = process.env.REGION;
const tableName = process.env.TABLE_NAME;
const usagePlanId = process.env.USAGE_PLAN_ID;

const client = new DynamoDBClient({ region });

const dynamo = DynamoDBDocumentClient.from(client);

//this would be a web hook url, only called by the payment gateway
export const handler: Handler = async (event: APIGatewayProxyEventV2) => {
  //the body
  const body = event.body;

  //validdate  the body
  //TODO: The event should contain the username of the user that paid, also the signature & other relevant data
  const { data, success, error } = signUpBodyValidator.safeParse(body);

  if (!success) {
    return { statusCode: 400, body: JSON.stringify(error.message) };
  }

  if (typeof usagePlanId !== "string") {
    return { statusCode: 500, body: JSON.stringify("internal server error") };
  }

  //TODO: validate the webhook signature or origin
  if (false === false) {
    return {
      statusCode: 401,
      body: JSON.stringify({ message: "Invalid signature" }),
    };
  }

  ///use a uuid to generate a unique api key
  const newUserApiKey = uuid();

  const apiGateway = new APIGateway();

  //generate an api using the uuid generated
  const apiKey = await apiGateway
    .createApiKey({ value: newUserApiKey })
    .promise();

  if (!apiKey.id || !apiKey.value) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Internal server error - failed to create api key",
      }),
    };
  }

  //add the api key to the usage plan
  const usagePlanKeyParams: APIGateway.CreateUsagePlanKeyRequest = {
    usagePlanId: usagePlanId,
    keyId: apiKey.id,
    keyType: "API_KEY",
  };

  const usagePlan = await apiGateway
    .createUsagePlanKey(usagePlanKeyParams)
    .promise();

  if (!usagePlan.id || !usagePlan.value) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Internal server error - failed to add apikey to usage plan",
      }),
    };
  }

  //add the users apikey to the table

  //TODO: HASH THE USERS API KEY BEFORE STORING, USING A HASHING ALGORITHM
  await dynamo.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        username: "user1234", //TODO: THE USERS USERNAME
        apiKey: apiKey.value, //TODO: THE HASHED API KEY
      },
    })
  );

  return {
    statusCode: 200,
    body: JSON.stringify({ message: "Api key generated" }),
  };
};
