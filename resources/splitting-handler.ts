import { S3Event } from "aws-lambda";
import { Handler } from "aws-cdk-lib/aws-lambda";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { createCanvas, loadImage } from "canvas";

import { processImage } from "../processImageFns/processImage";

import { s3ImageMetadataValidator } from "../helpers/schemaValidator/s3ImageMetadataValidator";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const region = process.env.REGION!;
const tableName = process.env.TABLE_NAME!;

const s3client = new S3Client({ region });
const ddbClient = new DynamoDBClient({ region });
const dynamoClient = DynamoDBDocumentClient.from(ddbClient);

export const handler: Handler = async (event: S3Event) => {
  try {
    if (!event.Records.length) {
      console.log("No records found");

      throw new Error("No records found");
    }

    const imageInfo = event.Records[0];
    console.log(imageInfo, "image info");

    //get the image from s3
    const s3Image = await s3client.send(
      new GetObjectCommand({
        Bucket: imageInfo.s3.bucket.name,
        Key: imageInfo.s3.object.key,
      })
    );

    if (!s3Image.Body) {
      console.log("No image found");

      throw new Error("No image found");
    }

    //validate the metadata received
    const { data, success, error } = s3ImageMetadataValidator.safeParse(
      s3Image.Metadata
    );

    console.log(data, "image data");

    if (!success) {
      console.log(error.message);

      throw new Error(`Invalid image metadata ${error.message}`);
    }

    const { channels, grain } = data;

    console.log(channels, grain);

    const transformedImage = await s3Image.Body.transformToByteArray();
    const bufferArray = Buffer.from(transformedImage);

    const image = await loadImage(bufferArray);

    const canvas = createCanvas(image.width, image.height);

    const canvasCtx = canvas.getContext("2d");

    canvasCtx.drawImage(image, 0, 0);

    const imageData = canvasCtx.getImageData(0, 0, image.width, image.height);

    const { images, processedInfo } = await processImage({
      imageData,
      channels,
      grains: grain,
      keyPrefix: imageInfo.s3.object.key,
      bucketName: imageInfo.s3.bucket.name,
    });

    for (let i = 0; i < images.length; i++) {
      const processedImage = images[i];
      canvasCtx.clearRect(0, 0, canvas.width, canvas.height);

      canvasCtx.putImageData(processedImage, 0, 0);

      const buffer = canvas.toBuffer("image/jpeg");

      await s3client.send(
        new PutObjectCommand({
          Body: buffer,
          ContentType: "image/jpeg",
          Bucket: imageInfo.s3.bucket.name,
          Key: processedInfo[i].key,
        })
      );
    }

    //store the red green & blue images in the users in dynamo db for that particular api key that was used, and also include the date
    await dynamoClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: {
          id: data.project_id,
          userId: data.user_id,
        },
        ExpressionAttributeValues: {
          ":processedImages": [
            {
              createdAt: Date.now(),
              images: processedInfo,
              originalKey: imageInfo.s3.object.key,
              originalUrl: `https://${imageInfo.s3.bucket.name}.s3.us-east-1.amazonaws.com/${imageInfo.s3.object.key}`,
            },
          ],
          ":emptyList": [],
        },
        UpdateExpression:
          "set processedImages = list_append(if_not_exists(processedImages, :emptyList), :processedImages)",
      })
    );
    console.log(images, "images");

    return;
  } catch (error: unknown) {
    console.log(error);

    if (error instanceof Error) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: error.message, status: "fail" }),
      };
    }

    //so it can be caught by alarm
    throw error;
  }
};
