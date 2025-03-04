import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const region = process.env.REGION!;
const tableName = process.env.TABLE_NAME!;
const paymentGatewaySecretName = process.env.PAYMENT_SECRET_NAME!;
const availableUsagePlansSecretName = process.env.AVAILABLE_PLANS_SECRET_NAME!;

const client = new DynamoDBClient({ region });

const dynamo = DynamoDBDocumentClient.from(client);

export const handler = (event) => {
  console.log("Failed payment for project, Details:", webHookEvent.meta_data);

  //get the apikey info for the the project that the payment failed for
  const existingProject = await dynamo.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        id: webHookEvent.meta_data.projectId,
        userId: webHookEvent.meta_data.userId,
      },
      ProjectionExpression: "apiKeyInfo",
    })
  );

  if (!existingProject.Item) {
    console.log("Failed to find project in database");

    return { statusCode: 500 };
  }

  const apiKey = await apiGateway
    .getApiKey({ apiKey: existingProject.Item.apiKeyInfo.apiKey })
    .promise();

  if (!apiKey.id || !apiKey.value) {
    console.log("Failed to get apikey info of failed project");

    return { statusCode: 500, body: "failure" };
  }

  //get all the available usagePlanIds
  const allUsagePlanIds = await secretClient
    .getSecretValue({ SecretId: availablePlansSecretName })
    .promise();

  if (!allUsagePlanIds.SecretString) {
    console.log("Available usage plans secret not found, is empty");

    return { statusCode: 500, body: "failure" };
  }

  //validate the usage plans received
  const {
    success,
    error,
    data: allUsagePlans,
  } = usagePlanValidator.safeParse(JSON.parse(allUsagePlanIds.SecretString));

  if (!success) {
    console.log("Usage plans error", error.issues);

    return { statusCode: 500, body: "failure" };
  }

  //remove the user from the old usage plan
  await apiGateway
    .deleteUsagePlanKey({
      usagePlanId: webHookEvent.meta_data.usagePlanId,
      keyId: apiKey.id,
    })
    .promise();

  //add their apikey to the free usage plan
  await apiGateway
    .createUsagePlanKey({
      usagePlanId: allUsagePlans.free,
      keyId: apiKey.id,
      keyType: "API_KEY",
    })
    .promise();

  //update their planName and usagePlanId in the database
  await dynamo.send(
    new UpdateCommand({
      TableName: tableName,
      ExpressionAttributeValues: {
        ":planName": "free",
        ":usagePlanId": allUsagePlans.free,
      },

      Key: {
        id: webHookEvent.meta_data.projectId,
        userId: webHookEvent.meta_data.userId,
      },

      UpdateExpression:
        "set apiKeyInfo.usagePlanId = :usagePlanId, currentPlan = :planName",
    })
  );

  //send a mail to the user informing them about the downgrade of the project
};
