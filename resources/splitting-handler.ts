import { APIGatewayProxyEventV2 } from "aws-lambda";
import { Handler } from "aws-cdk-lib/aws-lambda";

import { createCanvas, loadImage } from "canvas";

import { z } from "zod";

//handler must be async
export const handler: Handler = async (event: APIGatewayProxyEventV2) => {
  try {
    const headers = {
      "Content-Type": "application/json",
    };

    console.log("first log");

    console.log(event.body);

    if (!event.isBase64Encoded || !event.body) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: "Unsupported format" }),
      };
    }

    console.log("event received");

    //get the api key from the headers
    // const apiKey = event.headers["x-api-key"];

    //receive the image
    const bufferArray = Buffer.from(event.body, "base64");

    console.log(bufferArray);

    //load the image
    const image = await loadImage(bufferArray);

    const canvas = createCanvas(image.width, image.height);

    const canvasCtx = canvas.getContext("2d");

    //draw the image on the canvas
    canvasCtx.drawImage(image, 0, 0);

    //get the image data from the canvasCtx
    const imageData = canvasCtx.getImageData(0, 0, image.width, image.height);

    //store the red green & blue images in the users in dynamo db for that particular api key that was used, and also include the date
    console.log("about to show image data");
    console.log(imageData);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: "Success!" }),
    };
  } catch (error: unknown) {
    if (error instanceof Error) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: error.message, status: "fail" }),
      };
    }

    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Internal Server Error",
        status: "fail",
      }),
    };
  }
};
