import { S3Event } from "aws-lambda";
import { Handler } from "aws-cdk-lib/aws-lambda";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { Pool } from "pg";
import { createCanvas, loadImage } from "canvas";

import { processImage } from "../processImageFns/processImage";

import { s3ImageMetadataValidator } from "../helpers/schemaValidator/s3ImageMetadataValidator";

const region = process.env.REGION!;

const dbHost = process.env.DB_HOST!;
const dbUser = process.env.DB_USER!;
const dbName = process.env.DB_NAME!;
const dbPort = process.env.DB_PORT!;
const dbPassword = process.env.DB_PASSWORD!;

const s3client = new S3Client({ region });

let pool: Pool | undefined;

export const handler: Handler = async (event: S3Event) => {
  try {
    if (!event.Records.length) {
      console.log("No records found");

      throw new Error("No records found");
    }

    if (!pool) {
      pool = new Pool({
        host: dbHost,
        user: dbUser,
        password: dbPassword,
        database: dbName,
        port: Number(dbPort),
        ssl: { rejectUnauthorized: false },
      });
    }

    const imageInfo = event.Records[0];
    console.log(imageInfo, "image info");

    const imageKey = imageInfo.s3.object.key;
    const imageBucket = imageInfo.s3.bucket.name;

    //get the image from s3
    const s3Image = await s3client.send(
      new GetObjectCommand({
        Key: imageKey,
        Bucket: imageBucket,
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
      keyPrefix: imageKey,
      bucketName: imageBucket,
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
          Bucket: imageBucket,
          Key: processedInfo[i].key,
        })
      );
    }

    const processedImages = processedInfo.map((processedImage) => {
      return {
        url: processedImage.url,
        grain: processedImage.grain,
        channels: processedImage.channel,
      };
    });

    console.log(processedImages);

    await pool.query(
      `INSERT INTO "Images" ("projectId", "results", "originalImageUrl", "createdAt", "id") VALUES ($1, $2, $3, $4, $5)`,
      [
        data.project_id,
        processedImages,
        `https://${imageBucket}.s3.us-east-1.amazonaws.com/${imageKey}`,
        new Date(),
        imageKey, //use the key of the original image as the id
      ]
    );

    console.log("completed successfully");

    return;
  } catch (error: unknown) {
    console.log(error);

    if (error instanceof Error) {
      console.log(error.message);
    }

    //so it can be caught by alarm
    throw error;
  }
};
