import { S3Client } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { APIGatewayProxyEventV2, Handler } from "aws-lambda";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

import { v4 as uuid } from "uuid";

import {
  PlanType,
  defaultGrain,
  defaultNormalizedChannel,
} from "../helpers/constants";
import { transformZodError } from "../helpers/fns/transformZodError";
import { processValidator } from "../helpers/schemaValidator/processValidator";

import { ProjectInfo } from "../types/projectInfo";

const region = process.env.REGION!;
const s3Bucket = process.env.BUCKET_NAME!;
const tableName = process.env.TABLE_NAME!;

const maxPlanSizes = {
  [PlanType.Free]: 10 * 1024 * 1024,
  [PlanType.Pro]: 20 * 1024 * 1024,
  [PlanType.Executive]: 80 * 1024 * 1024,
};

const s3 = new S3Client({
  region,
});
const ddbClient = new DynamoDBClient({ region });
const dynamoClient = DynamoDBDocumentClient.from(ddbClient);

export const handler: Handler = async (event: APIGatewayProxyEventV2) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Api-Key",
  };

  if (!event.body) {
    console.info("No event body received");

    return {
      headers,
      statusCode: 400,
      body: JSON.stringify({
        error: "No process specified",
      }),
    };
  }

  const apiKey = event.headers?.["x-api-key"];

  if (!apiKey) {
    console.info("No api key in header");

    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Unauthorized" }),
      headers,
    };
  }

  const body = JSON.parse(event.body);
  console.log("event body", body);

  const { data, success, error } = processValidator.safeParse(body);

  if (!success) {
    console.error("Error verifying process specified by user -->", error);

    return {
      headers,
      statusCode: 400,
      body: transformZodError(error),
    };
  }

  const { channels, grain } = data;

  //if everything in the array the user sent is a default then do not proceed because
  //this process would not generate a new image, so do not respond
  if (
    channels.every((channel) => defaultNormalizedChannel.includes(channel)) &&
    grain.every((grain) => defaultGrain.includes(grain))
  ) {
    return {
      headers,
      statusCode: 400,
      body: JSON.stringify({
        error: "Process results in same image! Your post body may be empty.",
      }),
    };
  }

  //get the project the apikey is attached to && the maxPlan sizes from secret manager
  const project = await dynamoClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "apiKey = :apiKey",
      IndexName: "apiKeyIndex",
      ExpressionAttributeValues: {
        ":apiKey": apiKey,
      },
      ProjectionExpression: "projectId, userId, currentPlan",
      Limit: 1,
    })
  );

  if (!project.Items || !project.Items.length) {
    return {
      headers,
      statusCode: 404,
      body: JSON.stringify({
        error: "No project found for corresponding apikey",
      }),
    };
  }

  const projectData = project.Items[0] as Pick<
    ProjectInfo,
    "projectId" | "userId" | "currentPlan"
  >;

  //if a free user tried to get multiple channels or grains from an image, shut it down. you not paying enough my g 🤷‍♂️
  if (
    projectData.currentPlan === PlanType.Free &&
    (channels.length > 1 || grain.length > 1)
  ) {
    return {
      headers,
      statusCode: 400,
      body: JSON.stringify({
        error: "Free Plan does not support multiple channels or grains.",
      }),
    };
  }

  const imageKey = uuid();

  try {
    const grainValue = JSON.stringify(grain);
    const channelsValue = JSON.stringify(channels);

    const { url, fields } = await createPresignedPost(s3, {
      Bucket: s3Bucket,
      Key: `${imageKey}` + "/${filename}", //this would use the actual file name so the resulting key would be uuid/the actual name of the file
      Conditions: [
        { bucket: s3Bucket },

        ["starts-with", "$key", `${imageKey}`],
        ["starts-with", "$Content-Type", "image/"],
        [
          "content-length-range",
          1,
          maxPlanSizes[projectData.currentPlan as keyof typeof maxPlanSizes],
        ], //the content length should not exceed this rAnge

        ["eq", "$x-amz-meta-grains", grainValue],
        ["eq", "$x-amz-meta-channels", channelsValue],
        ["eq", "$x-amz-meta-project_id", projectData.projectId],
      ],

      //other fields that we want returned with the url, they must be attached to the formdata
      //if the user changes it, it wont work 😭😭 got them right?
      Fields: {
        "x-amz-meta-grains": grainValue,
        "x-amz-meta-channels": channelsValue,
        "x-amz-meta-user_id": projectData.userId,
        "x-amz-meta-project_id": projectData.projectId,
      },

      Expires: 180,
    });

    //create a record in another db, the key of the image should be the id
    //then return the poll url, which should be a get endpoint like this .../image/{id} id being the image key

    console.log("completed successfully");
    return { statusCode: 200, body: JSON.stringify({ url, fields }), headers };
  } catch (error: unknown) {
    console.error("ERROR GENERATING PRESIGNED URL", error);

    throw error;
  }
};
