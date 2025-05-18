import { S3Event } from "aws-lambda";
import { Handler } from "aws-cdk-lib/aws-lambda";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

import { createCanvas, loadImage } from "canvas";

import { processImage } from "../processImageFns/processImage";

import { s3ImageMetadataValidator } from "../helpers/schemaValidator/s3ImageMetadataValidator";

const region = process.env.REGION!;
const processedResultTable = process.env.RESULTS_TABLE_NAME!;

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
    console.log(imageInfo);

    const originalImageKey = imageInfo.s3.object.key;
    const bucketName = imageInfo.s3.bucket.name;

    //get the image from s3
    const s3Image = await s3client.send(
      new GetObjectCommand({
        Bucket: bucketName,
        Key: originalImageKey,
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

    if (!success) {
      console.log(error.message);

      throw new Error(`Invalid image metadata ${error.message}`);
    }

    const { channels, grains } = data;

    console.log(channels, grains);

    const transformedImage = await s3Image.Body.transformToByteArray();
    const bufferArray = Buffer.from(transformedImage);

    const image = await loadImage(bufferArray);

    const canvas = createCanvas(image.width, image.height);

    const canvasCtx = canvas.getContext("2d");

    canvasCtx.drawImage(image, 0, 0);

    const imageData = canvasCtx.getImageData(0, 0, image.width, image.height);

    const { images, processedInfo } = await processImage({
      grains,
      channels,
      imageData,
      bucketName,
      originalImageKey: originalImageKey.split("/")[0],
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
          Key: `${processedInfo[i].key}.jpg`,
        })
      );
    }

    console.log(images);

    const processedImages = processedInfo.map((processedImage) => {
      return {
        url: processedImage.url,
        grain: processedImage.grain,
        channels: processedImage.channel,
      };
    });

    //store the results in the results table
    await dynamoClient.send(
      new PutCommand({
        TableName: processedResultTable,
        Item: {
          userId: data.user_id,
          results: processedImages,
          imageId: originalImageKey.split("/")[0],
          projectId: data.project_id,
          originalImageUrl: `https://${bucketName}.s3.${region}.amazonaws.com/${originalImageKey}`,
          createdAt: Date.now(),
        },
      })
    );

    console.log("completed successfully");

    return;
  } catch (error: unknown) {
    console.error(error);

    //so it can be caught by alarm
    throw error;
  }
};
