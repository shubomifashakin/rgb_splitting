import { S3Client } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { APIGatewayProxyEventV2, Handler } from "aws-lambda";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

import { v4 as uuid } from "uuid";

import { processValidator } from "../helpers/schemaValidator/processValidator";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { planNameValidator } from "../helpers/schemaValidator/planNameValidator";
import { planSizesValidator } from "../helpers/schemaValidator/planSizesValidator";

const region = process.env.REGION!;
const s3Bucket = process.env.BUCKET_NAME!;
const tableName = process.env.TABLE_NAME!;
const maxPlanSizesSecretName = process.env.MAX_PLAN_SIZES_SECRET_NAME!;

const s3 = new S3Client({
  region,
});
const ddbClient = new DynamoDBClient({ region });
const secretClient = new SecretsManagerClient({ region });
const dynamoClient = DynamoDBDocumentClient.from(ddbClient);

export const handler: Handler = async (event: APIGatewayProxyEventV2) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Api-Key",
  };

  if (!event.body) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        message: "No process specified",
      }),
      headers,
    };
  }

  const body = JSON.parse(event.body);

  const { data, success, error } = processValidator.safeParse(body);

  if (!success) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        message: error.issues,
      }),
      headers,
    };
  }

  const { channels, distortion } = data;

  const apiKey = event.headers?.["x-api-key"];

  if (!apiKey) {
    return { statusCode: 400, body: JSON.stringify("Unauthorized"), headers };
  }

  //get the project the apikey is attached to
  const project = await dynamoClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "apiKey = :apiKey",
      IndexName: "apiKeyIndex",
      ExpressionAttributeValues: {
        ":apiKey": apiKey,
      },
      ProjectionExpression: "id, userId, currentPlan",
      Limit: 1,
    })
  );

  if (!project.Items || !project.Items.length) {
    return {
      statusCode: 404,
      body: JSON.stringify({
        message: "No project found for corresponding apikey",
      }),
      headers,
    };
  }

  const { currentPlan } = project.Items[0];

  const {
    data: planName,
    success: planNameSuccess,
    error: planNameError,
  } = planNameValidator.safeParse(currentPlan);

  if (!planNameSuccess) {
    throw new Error(`Invalid plan name ${planNameError.message}`);
  }

  //here, i fetch the maximum file sizes the user is allowed to upload based on their plan
  const maxPlanSizes = await secretClient.send(
    new GetSecretValueCommand({
      SecretId: maxPlanSizesSecretName,
    })
  );

  if (!maxPlanSizes.SecretString) {
    console.error("Max plan size secret is empty");

    throw new Error("Max plan size secret is empty");
  }

  const parsedMaxPlanSizes = JSON.parse(maxPlanSizes.SecretString);

  const {
    data: maxSizesData,
    error: maxSizesError,
    success: maxSizesSuccess,
  } = planSizesValidator.safeParse(parsedMaxPlanSizes);

  if (!maxSizesSuccess) {
    console.log(maxSizesError.message);

    throw new Error(`Invalid max plan sizes data ${maxSizesError.message}`);
  }

  console.log(maxSizesData, currentPlan);

  const imageName = uuid();

  try {
    //this was not good enough for my use case, it wasnt alowing me limit the file size & content type
    // const command = new PutObjectCommand({
    //   Bucket: s3Bucket,
    //   Key: imageName,
    //   Metadata: {
    //     channels: channels || "",
    //     distortion: distortion ? String(distortion) : "",
    //     projectId: project.Items[0].id,
    //   },
    //   ContentType: "image/png",
    //   // ContentLength: 1 * 1024 * 1024, //this limits the file size that a user can upload to thr presigned url
    // });

    //they have 2 minutes to upload the image
    // const signedUrl = await getSignedUrl(s3, command, { expiresIn: 180 });

    const { url, fields } = await createPresignedPost(s3, {
      Bucket: s3Bucket,
      Key: imageName,
      Conditions: [
        { bucket: s3Bucket },
        { key: imageName },

        ["starts-with", "$Content-Type", "image/"],
        [
          "content-length-range",
          1,
          maxSizesData[planName as keyof typeof maxSizesData],
        ], //the content length should not exceed this rAnge

        ["eq", "$x-amz-meta-channels", channels || ""],
        ["eq", "$x-amz-meta-project_id", project.Items[0].id],
        ["eq", "$x-amz-meta-distortion", distortion ? String(distortion) : ""],
      ],

      //other fields that we want returned with the url, they must be attached to the formdata
      //if the user changes it, it wont work 😭😭 got them right?
      Fields: {
        "x-amz-meta-channels": channels || "",
        "x-amz-meta-project_id": project.Items[0].id,
        "x-amz-meta-distortion": distortion ? String(distortion) : "",
      },

      Expires: 180,
    });

    return { statusCode: 200, body: JSON.stringify({ url, fields }), headers };
  } catch (error: unknown) {
    console.error("ERROR GENERATING PRESIGNED URL", error);

    throw error;
  }
};
