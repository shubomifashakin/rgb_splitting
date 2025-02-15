import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { BlockPublicAccess, Bucket } from "aws-cdk-lib/aws-s3";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { CorsHttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import {
  ApiKeySourceType,
  Cors,
  LambdaIntegration,
  Period,
  RestApi,
  UsagePlan,
} from "aws-cdk-lib/aws-apigateway";
import { HttpMethod } from "aws-cdk-lib/aws-events";
import { AttributeType, Table } from "aws-cdk-lib/aws-dynamodb";

const region = "us-east-1";
const webHookVerificationKey = process.env.WEBHOOK_VERIFICATION_KEY;

export class RgbSplittingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, {
      ...props,
      env: {
        region,
      },
    });

    //bucket to store the processed images
    const s3Bucket = new Bucket(this, "rgb-splitting-bucket-sh", {
      bucketName: "rgb-split-bucket-sh",
      publicReadAccess: true,
      versioned: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ACLS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    //dynamo db to store processed images for a particular user
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

    const splittingLambda = new NodejsFunction(
      this,
      "rgb-splitting-lambda-sh",
      {
        functionName: "rgb-splitting-lambda-sh",
        timeout: cdk.Duration.minutes(3),
        runtime: Runtime.NODEJS_LATEST,
        environment: {
          BUCKET_NAME: s3Bucket.bucketName,
          TABLE_NAME: usersTable.tableName,
        },
        entry: "./resources/splitting-handler.ts",
        handler: "handler",
      }
    );

    //used to generate the api key
    const userSignupLambda = new NodejsFunction(this, "UserSignupLambda", {
      functionName: "rgb-splitting-signup-lambda",
      runtime: Runtime.NODEJS_LATEST,
      entry: "./resources/user-signup-handler.ts",
      handler: "handler",
      environment: {
        REGION: region,
        TABLE_NAME: usersTable.tableName,
        WEBHOOK_VERIFICATION_KEY: webHookVerificationKey as string,
      },
    });

    //create the rest api
    const restApi = new RestApi(this, "rgb-splitting-rest-api-sh", {
      restApiName: "rgb-splitting-rest-api-sh",
      description: "this rest api allows users to upload images",
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
        allowMethods: [CorsHttpMethod.POST],
      },
      apiKeySourceType: ApiKeySourceType.HEADER, //the api key should be included in their headers
      binaryMediaTypes: ["image/png", "image/jpeg"],
    });

    //setup a usage plan
    const usagePlan = new UsagePlan(this, "rgb-splitting-usage-plan", {
      name: "rgb-splitting-usage-plan",
      apiStages: [{ api: restApi, stage: restApi.deploymentStage }],
      throttle: {
        rateLimit: 5, //the user can call the api 5 times in 1 second
        burstLimit: 10,
      },
      quota: {
        limit: 5, //the user with this apikey can use the api 200 times in a month
        period: Period.MONTH,
      },
      description: "usage plan for the rgb splitting key",
    });

    //this is the route integrated with our lambda
    const processRoute = restApi.root.addResource("process");

    //route to generate the api key
    const generateApiKeyRoute = restApi.root.addResource("generate-key");

    //create the lambda integration
    const processRouteIntegration = new LambdaIntegration(splittingLambda);

    const signUpLambaIntegration = new LambdaIntegration(userSignupLambda);

    //integrate the process route with our lambda
    //this technical says that the process route has a post method that is handled by this particular resoucrse
    processRoute.addMethod(HttpMethod.POST, processRouteIntegration, {
      apiKeyRequired: true,
    });

    generateApiKeyRoute.addMethod(HttpMethod.POST, signUpLambaIntegration);

    s3Bucket.grantWrite(splittingLambda);

    //allow the splitting lambda write to the database
    usersTable.grantWriteData(splittingLambda);

    //allow the sign up lambda write to the database
    usersTable.grantWriteData(userSignupLambda);
  }
}
