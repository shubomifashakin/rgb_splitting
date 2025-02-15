import { Handler } from "aws-cdk-lib/aws-lambda";
import { APIGatewayProxyEventV2 } from "aws-lambda";

//handler must be async
export const handler: Handler = async (event: APIGatewayProxyEventV2) => {
  const headers = {
    "Content-Type": "application/json",
  };

  //get the api key from the headers
  //get the users username from the headers

  //receive the image

  //process the image

  //store the red green & blue images in the users in dynamo db for that particular api key that was used, and also include the date

  console.log("hello world");

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Success!" }),
  };
};
