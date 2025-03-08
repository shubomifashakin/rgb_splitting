import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { APIGatewayProxyEventV2, Handler } from "aws-lambda";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { v4 as uuid } from "uuid";

const region = process.env.REGION;
const s3Bucket = process.env.BUCKET_NAME;

export const handler: Handler = async (event: APIGatewayProxyEventV2) => {
  if (!region || !s3Bucket) {
    return { statusCode: 500, body: JSON.stringify("Internal server error") };
  }

  //  TODO: //check the post body for the process they want to make
  //post body should contain the type of processes they want to perform on the image as well as the email of the user that should receive the result

  const imageName = uuid();

  const s3 = new S3Client({
    region,
  });

  try {
    const command = new PutObjectCommand({
      Bucket: s3Bucket,
      Key: imageName,
      Metadata: {
        process: "",
        email: "", //the email
      },
      ContentType: "image/png",
      ContentLength: 5 * 1024 * 1024, //this limits the file size that a user can upload to thr presigned url
    });

    const signedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

    return { statusCode: 200, body: signedUrl };
  } catch (error: unknown) {
    console.error(
      "ERROR GENERATING PRESIGNED URL",
      JSON.stringify({
        date: new Date(),
        error,
        context: "Generating Presigned Url -- Process",
      })
    );

    if (error instanceof Error) {
      return { statusCode: 400, body: JSON.stringify(error.message) };
    }

    return { statusCode: 500, body: "Internal server error" };
  }
};
