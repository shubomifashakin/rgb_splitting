import { S3Client } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { APIGatewayProxyEventV2, Handler } from "aws-lambda";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

import { v4 as uuid } from "uuid";

import {
  PlanType,
  defaultGrain,
  defaultNormalizedChannel,
} from "../helpers/constants";
import { processValidator } from "../helpers/schemaValidator/processValidator";
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
  console.log("event body", body);

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

  const { channels, grain } = data;

  //this process would not generate a new image, so do not respond
  if (
    channels.length === defaultNormalizedChannel.length &&
    channels.every((channel) => defaultNormalizedChannel.includes(channel)) &&
    grain.length === defaultGrain.length &&
    grain.every((dist) => defaultGrain.includes(dist))
  ) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        message: "Process results in same image! Your post body may be empty.",
      }),
      headers,
    };
  }

  const apiKey = event.headers?.["x-api-key"];

  if (!apiKey) {
    return { statusCode: 400, body: JSON.stringify("Unauthorized"), headers };
  }

  //get the project the apikey is attached to && the maxPlan sizes from secret manager
  const [project, maxPlanSizes] = await Promise.all([
    dynamoClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "apiKey = :apiKey",
        IndexName: "apiKeyIndex",
        ExpressionAttributeValues: {
          ":apiKey": apiKey,
        },
        ProjectionExpression: "id, userId, currentPlan, projectName",
        Limit: 1,
      })
    ),
    secretClient.send(
      new GetSecretValueCommand({
        SecretId: maxPlanSizesSecretName,
      })
    ),
  ]);

  if (!maxPlanSizes.SecretString) {
    console.error("Max plan size secret is empty");

    throw new Error("Max plan size secret is empty");
  }

  if (!project.Items || !project.Items.length) {
    return {
      statusCode: 404,
      body: JSON.stringify({
        message: "No project found for corresponding apikey",
      }),
      headers,
    };
  }

  const projectData = project.Items[0];

  //if a free user tried to get multiple channels or grains from an image, shut it down. you not paying enough my g 🤷‍♂️
  if (
    projectData.currentPlan === PlanType.Free &&
    (channels.length > 1 || grain.length > 1)
  ) {
    return {
      headers,
      statusCode: 400,
      body: JSON.stringify({
        message: "Free Plan does not support multiple channels",
      }),
    };
  }

  const parsedMaxPlanSizes = JSON.parse(maxPlanSizes.SecretString);

  const {
    data: maxSizesData,
    error: maxSizesError,
    success: maxSizesSuccess,
  } = planSizesValidator.safeParse(parsedMaxPlanSizes);

  if (!maxSizesSuccess) {
    console.log(maxSizesError.message);

    throw new Error(
      `Invalid max plan sizes schema received from secret manager ${maxSizesError.message}`
    );
  }

  const imageKey = uuid();

  try {
    //this was not good enough for my use case, it wasnt alowing me limit the file size & content type
    // const command = new PutObjectCommand({
    //   Bucket: s3Bucket,
    //   Key: imageKey,
    //   Metadata: {
    //     channels: channels || "",
    //     grain: grain ? String(grain) : "",
    //     projectId: project.Items[0].id,
    //   },
    //   ContentType: "image/png",
    //   // ContentLength: 1 * 1024 * 1024, //this limits the file size that a user can upload to thr presigned url
    // });

    //they have 2 minutes to upload the image
    // const signedUrl = await getSignedUrl(s3, command, { expiresIn: 180 });

    const grainValue = JSON.stringify(grain);
    const channelsValue = JSON.stringify(channels);

    const { url, fields } = await createPresignedPost(s3, {
      Bucket: s3Bucket,
      Key: imageKey,
      Conditions: [
        { bucket: s3Bucket },
        { key: imageKey },

        ["starts-with", "$Content-Type", "image/"],
        [
          "content-length-range",
          1,
          maxSizesData[projectData.currentPlan as keyof typeof maxSizesData],
        ], //the content length should not exceed this rAnge

        ["eq", "$x-amz-meta-grain", grainValue],
        ["eq", "$x-amz-meta-channels", channelsValue],
        ["eq", "$x-amz-meta-project_id", projectData.id],
        ["eq", "$x-amz-meta-user_id", projectData.userId],
        ["eq", "$x-amz-meta-project_name", projectData.projectName],
      ],

      //other fields that we want returned with the url, they must be attached to the formdata
      //if the user changes it, it wont work 😭😭 got them right?
      Fields: {
        "x-amz-meta-grain": grainValue,
        "x-amz-meta-channels": channelsValue,
        "x-amz-meta-project_id": projectData.id,
        "x-amz-meta-user_id": projectData.userId,
        "x-amz-meta-project_name": projectData.projectName,
      },

      Expires: 180,
    });

    //create a record in another db, the key of the image should be the id
    //then return the poll url, which should be a get endpoint like this .../image/{id} id being the image key

    return { statusCode: 200, body: JSON.stringify({ url, fields }), headers };
  } catch (error: unknown) {
    console.error("ERROR GENERATING PRESIGNED URL", error);

    throw error;
  }
};
