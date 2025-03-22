import { S3Client } from "@aws-sdk/client-s3";
import { APIGatewayProxyEventV2, Handler } from "aws-lambda";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

import { Pool } from "pg";
import { v4 as uuid } from "uuid";

import {
  PlanType,
  defaultGrain,
  defaultNormalizedChannel,
  imageRouteVar,
} from "../helpers/constants";
import { processValidator } from "../helpers/schemaValidator/processValidator";
import { planSizesValidator } from "../helpers/schemaValidator/planSizesValidator";

const region = process.env.REGION!;
const s3Bucket = process.env.BUCKET_NAME!;

const dbHost = process.env.DB_HOST!;
const dbPort = process.env.DB_PORT!;
const dbSecretArn = process.env.DB_SECRET_ARN!;

const maxPlanSizesSecretName = process.env.MAX_PLAN_SIZES_SECRET_NAME!;

const s3 = new S3Client({
  region,
});
const secretClient = new SecretsManagerClient({ region });

let pool: Pool | undefined;

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
      password: password,
      database: dbname,
      port: Number(dbPort),
      ssl: { rejectUnauthorized: false },
    });
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
  //essentially if everything is a default, do not generate a new image, reject the request
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
    pool.query(
      `SELECT id, "userId", "projectName", "currentPlan" FROM "Projects" WHERE "apiKey" = $1`,
      [apiKey]
    ),

    secretClient.send(
      new GetSecretValueCommand({
        SecretId: maxPlanSizesSecretName,
      })
    ),
  ]);

  console.log(project);

  if (!maxPlanSizes.SecretString) {
    console.error("Max plan size secret is empty");

    throw new Error("Max plan size secret is empty");
  }

  if (!project.rowCount) {
    return {
      statusCode: 404,
      body: JSON.stringify({
        message: "No project found for corresponding apikey",
      }),
      headers,
    };
  }

  const projectInfo = project.rows[0];

  //if a free user tried to get multiple channels or grains from an image, shut it down. you not paying enough my g 🤷‍♂️
  if (
    projectInfo.currentPlan === PlanType.Free &&
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

  const imageId = uuid();
  const imageKey = `${projectInfo.id}/${imageRouteVar}/${imageId}`;

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
          maxSizesData[
            project.rows[0].currentPlan as keyof typeof maxSizesData
          ],
        ], //the content length should not exceed this rAnge

        ["eq", "$x-amz-meta-grain", grainValue],
        ["eq", "$x-amz-meta-channels", channelsValue],
        ["eq", "$x-amz-meta-project_id", projectInfo.id],
        ["eq", "$x-amz-meta-user_id", projectInfo.userId],
        ["eq", "$x-amz-meta-project_name", projectInfo.projectName],
      ],

      //other fields that we want returned with the url, they must be attached to the formdata
      //if the user changes it, it wont work 😭😭 got them right?
      Fields: {
        "x-amz-meta-grain": grainValue,
        "x-amz-meta-channels": channelsValue,
        "x-amz-meta-project_id": projectInfo.id,
        "x-amz-meta-user_id": projectInfo.userId,
        "x-amz-meta-project_name": projectInfo.projectName,
      },

      Expires: 180,
    });

    console.log("completed successfully");

    return { statusCode: 200, body: JSON.stringify({ url, fields }), headers };
  } catch (error: unknown) {
    console.error("ERROR GENERATING PRESIGNED URL", error);

    throw error;
  }
};
