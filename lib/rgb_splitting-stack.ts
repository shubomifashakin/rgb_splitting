import { Construct } from "constructs";

import * as cdk from "aws-cdk-lib";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { BlockPublicAccess, Bucket } from "aws-cdk-lib/aws-s3";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { CorsHttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import {
  ApiKeySourceType,
  Cors,
  LambdaIntegration,
  RestApi,
} from "aws-cdk-lib/aws-apigateway";
import { HttpMethod } from "aws-cdk-lib/aws-events";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { AttributeType, Table } from "aws-cdk-lib/aws-dynamodb";
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from "aws-cdk-lib/custom-resources";

import * as dotenv from "dotenv";

dotenv.config();

const region = process.env.REGION;
const usagePlanId = process.env.USAGE_PLAN_ID;

export class RgbSplittingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, {
      ...props,
      env: {
        region,
      },
    });

    if (typeof usagePlanId !== "string") {
      throw new Error("Usage plan id does not exist in environment");
    }

    if (typeof region !== "string") {
      throw new Error("Region does not exist in environment");
    }

    //bucket to store the processed images
    const s3Bucket = new Bucket(this, "rgb-splitting-bucket-sh", {
      versioned: true,
      publicReadAccess: true,
      bucketName: "rgb-split-bucket-sh",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      blockPublicAccess: BlockPublicAccess.BLOCK_ACLS,
    });

    //dynamo db to store the apikey and the images that have been processed using that api key
    const usersTable = new Table(this, "rgb-splitting-table-sh", {
      tableName: "rgb-splitting-table-sh",
      partitionKey: {
        type: AttributeType.STRING,
        name: "username",
      },
      sortKey: {
        name: "apiKey",
        type: AttributeType.STRING,
      },
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // handles the splitting of the uploaded image
    const splittingLambda = new NodejsFunction(
      this,
      "rgb-splitting-lambda-sh",
      {
        functionName: "rgb-splitting-lambda-sh",
        timeout: cdk.Duration.minutes(3),
        runtime: Runtime.NODEJS_LATEST,
        environment: {
          REGION: region,
          BUCKET_NAME: s3Bucket.bucketName,
          TABLE_NAME: usersTable.tableName,
        },
        entry: "./resources/splitting-handler.ts",
        handler: "handler",
      }
    );

    //used to generate an api key and add that key to a usage plan
    const generateApiKeyLambda = new NodejsFunction(
      this,
      "generateApiKeyLambda",
      {
        functionName: "rgb-splitting-generate-key-lambda",
        description:
          "This lambda is used to generate an api key & add the generated api key to the usage plan passed",
        runtime: Runtime.NODEJS_LATEST,
        entry: "./resources/generate-key-handler.ts",
        handler: "handler",
        environment: {
          REGION: region,
          TABLE_NAME: usersTable.tableName,
          USAGE_PLAN_ID: usagePlanId,
        },
      }
    );

    //create the rest api
    const restApi = new RestApi(this, "rgb-splitting-rest-api-sh", {
      restApiName: "rgb-splitting-rest-api-sh",
      description: "the base rest api for the rgb splitting",
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
        allowMethods: [CorsHttpMethod.POST],
      },
      apiKeySourceType: ApiKeySourceType.HEADER, //the api key should be included in their headers
      binaryMediaTypes: ["image/png", "image/jpeg"],
      cloudWatchRoleRemovalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    //this is the route integrated with our lambda
    const processRoute = restApi.root.addResource("process");

    //route to generate the api key
    const generateApiKeyRoute = restApi.root.addResource("generate-api-key");

    // integrate the process route with the splitting lambda
    const processRouteIntegration = new LambdaIntegration(splittingLambda);

    // integrate generate api key route with the generate lambda
    const generateApiKeyIntegration = new LambdaIntegration(
      generateApiKeyLambda
    );

    //when the rest api is created, this custome resource would run,
    //it's function is to attach the rest api created to the specified usage plan
    new AwsCustomResource(this, "AttachApiToUsagePlan", {
      onCreate: {
        service: "APIGateway",
        action: "updateUsagePlan",
        parameters: {
          usagePlanId,
          patchOperations: [
            {
              op: "add",
              path: "/apiStages",
              value: `${restApi.restApiId}:${restApi.deploymentStage.stageName}`,
            },
          ],
        },
        physicalResourceId: PhysicalResourceId.of("rgb-usage-plan-attacher"),
      },
      policy: AwsCustomResourcePolicy.fromStatements([
        new PolicyStatement({
          actions: ["apigateway:PATCH"],
          resources: [
            `arn:aws:apigateway:${region}::/usageplans/${usagePlanId}`, // give the custom resouce permission to perform pacth updates on this particular usage plan
          ],
        }),
      ]),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    //integrate the process route with our splitting lambda
    processRoute.addMethod(HttpMethod.POST, processRouteIntegration, {
      apiKeyRequired: true,
    });

    generateApiKeyRoute.addMethod(HttpMethod.POST, generateApiKeyIntegration);

    generateApiKeyLambda.addToRolePolicy(
      new PolicyStatement({
        actions: [
          "apigateway:POST", // Allow creating API keys
        ],
        resources: [
          "arn:aws:apigateway:us-east-1::/apikeys", //allow the lambda generate api keys in us-east-1 obly
          `arn:aws:apigateway:us-east-1::/usageplans/${usagePlanId}/keys`, //allow the lambda get all the keys in this particular usage plan
        ],
      })
    );

    //allow the generate key lambda to update our usage plan
    //this allows the lambda function to add the api key generated to our usage plan
    generateApiKeyLambda.addToRolePolicy(
      new PolicyStatement({
        actions: ["apigateway:PATCH"],
        resources: [`arn:aws:apigateway:us-east-1::/usageplans/${usagePlanId}`],
      })
    );

    s3Bucket.grantWrite(splittingLambda);

    //allow the splitting lambda write to the database
    usersTable.grantWriteData(splittingLambda);

    //allow the sign up lambda write to the database
    usersTable.grantWriteData(generateApiKeyLambda);
  }
}
