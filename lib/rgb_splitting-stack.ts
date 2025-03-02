import { Construct } from "constructs";

import { RgbApiStack } from "./RgbApiStack";

import * as cdk from "aws-cdk-lib";
import { LayerVersion, Runtime } from "aws-cdk-lib/aws-lambda";
import { BlockPublicAccess, Bucket, EventType } from "aws-cdk-lib/aws-s3";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import {
  AuthorizationType,
  LambdaIntegration,
  RestApi,
  TokenAuthorizer,
} from "aws-cdk-lib/aws-apigateway";
import { HttpMethod } from "aws-cdk-lib/aws-events";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { S3Bucket } from "aws-cdk-lib/aws-kinesisfirehose";
import { AttributeType, Table } from "aws-cdk-lib/aws-dynamodb";
import { LambdaDestination } from "aws-cdk-lib/aws-s3-notifications";

import * as dotenv from "dotenv";

dotenv.config();

const region = process.env.REGION!;
const paymentSecretName = process.env.PAYMENT_SECRET_NAME!;
const webhookSecretName = process.env.WEBHOOK_SECRET_NAME!;
const clerkJwtSecretName = process.env.CLERK_JWT_SECRET_NAME!;
const availablePlansSecretName = process.env.AVAILABLE_PLANS_SECRET_NAME!;

interface RgbSplittingStackProps extends cdk.StackProps {
  RGBApiStack: RgbApiStack;
}

export class RgbSplittingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: RgbSplittingStackProps) {
    super(scope, id, {
      ...props,
      env: {
        region,
      },
    });

    const rgbRestApiId = props.RGBApiStack.RgbRestApiId;
    const proTierUsagePlanId = props.RGBApiStack.proTierUsagePlanId;
    const freeTierUsagePlanId = props.RGBApiStack.freeTierUsagePlanId;
    const rgbRestApiRootResourceId = props.RGBApiStack.RgbRestApiRootResourceId;
    const executiveTierUsagePlanId = props.RGBApiStack.executiveTierUsagePlanId;

    const projectPrefix = "rgb-splitting";

    const s3Bucket = new Bucket(this, `${projectPrefix}-bucket-sh`, {
      versioned: true,
      publicReadAccess: true,
      bucketName: "rgb-split-bucket-sh",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      blockPublicAccess: BlockPublicAccess.BLOCK_ACLS,
    });

    const usersTable = new Table(this, `${projectPrefix}-table-sh`, {
      tableName: `${projectPrefix}-table-sh`,
      partitionKey: {
        name: "userId",
        type: AttributeType.STRING,
      },
      sortKey: {
        name: "createdAt",
        type: AttributeType.NUMBER,
      },
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    usersTable.addGlobalSecondaryIndex({
      indexName: "createdAtIndex",
      partitionKey: {
        name: "createdAt",
        type: AttributeType.NUMBER,
      },
    });

    usersTable.addGlobalSecondaryIndex({
      indexName: "projectIdIndex",
      partitionKey: {
        name: "id",
        type: AttributeType.STRING,
      },
    });

    const canvasLayer = LayerVersion.fromLayerVersionArn(
      this,
      "lambda-layer-canvas-nodejs",
      "arn:aws:lambda:us-east-1:266735801881:layer:canvas-nodejs:1"
    );

    const splittingLambda = new NodejsFunction(
      this,
      `${projectPrefix}-lambda-sh`,
      {
        functionName: `${projectPrefix}-lambda-sh`,
        description:
          "this lambda is used for processing the image that was uploaded to s3",
        timeout: cdk.Duration.minutes(1.5),
        runtime: Runtime.NODEJS_20_X,
        environment: {
          REGION: region,
          BUCKET_NAME: s3Bucket.bucketName,
          TABLE_NAME: usersTable.tableName,
        },
        entry: "./resources/splitting-handler.ts",
        handler: "handler",
        memorySize: 1536,
        layers: [canvasLayer],
        bundling: {
          loader: {
            ".node": "file", // tells esbuild ti treat the .node files as external files rather than trying to bundle it
          },
          sourceMap: true,
          minify: true,
          externalModules: ["canvas"], //since we included the canvas layer in our lambda, exclude the canvas module from bundling
        },
      }
    );

    //lambda used to generate the presigned urls
    const generatePresignedUrlLambda = new NodejsFunction(
      this,
      "rgb-generate-presigned-url-lambda",
      {
        functionName: "generate-presigned-url-lambda",
        description:
          "This lambda generates presigned urls to users with valid apikeys",
        timeout: cdk.Duration.seconds(10),
        runtime: Runtime.NODEJS_20_X,
        environment: {
          BUCKET_NAME: S3Bucket.name,
          REGION: region,
        },
        entry: "./resources/generate-presigned-url.ts",
        handler: "handler",
      }
    );

    //used to verify webhooks,
    const webHookLambda = new NodejsFunction(this, "rgb-webHook-Lambda", {
      functionName: `${projectPrefix}-webhook-lambda`,
      description:
        "This lambda receives webhook events from our payment gateway",
      runtime: Runtime.NODEJS_22_X,
      entry: "./resources/webhook-handler.ts",
      handler: "handler",
      environment: {
        REGION: region,
        TABLE_NAME: usersTable.tableName,
        PAYMENT_SECRET_NAME: paymentSecretName,
        AVAILABLE_PLANS_SECRET_NAME: availablePlansSecretName,
        WEBHOOK_SECRET_NAME: webhookSecretName,
      },
      timeout: cdk.Duration.seconds(20),
    });

    //used to get all the api keys owned by a particular user
    const getUsersApiKeysLambda = new NodejsFunction(
      this,
      `${projectPrefix}-get-all-user-api-keys-lambda`,
      {
        functionName: `${projectPrefix}-get-all-user-api-keys-lambda`,
        description:
          "This lambda is used for getting all the api keys for a particula user",
        runtime: Runtime.NODEJS_22_X,
        entry: "./resources/get-all-user-api-keys-handler.ts",
        handler: "handler",
        environment: {
          REGION: region,
          TABLE_NAME: usersTable.tableName,
        },
        timeout: cdk.Duration.seconds(30),
      }
    );

    const requestPaymentLambda = new NodejsFunction(
      this,
      `${projectPrefix}-Payments-Lambda`,
      {
        functionName: `${projectPrefix}-payments-lambda`,
        description: "This lambda is used to handle subcriptions.",
        runtime: Runtime.NODEJS_22_X,
        entry: "./resources/payments-handler.ts",
        handler: "handler",
        environment: {
          REGION: region,
          PAYMENT_SECRET_NAME: paymentSecretName,
          AVAILABLE_PLANS_SECRET_NAME: availablePlansSecretName,
        },
        timeout: cdk.Duration.seconds(30),
      }
    );

    const getAllUserApiKeysAuthorizerLambda = new NodejsFunction(
      this,
      "rgbAllApiKeysAuthorizer",
      {
        functionName: "rgb-All-ApiKeys-Authorizer-lambda",
        description:
          "This lambda acts as an authorizer for the getAllUserApiKeysRoute",
        runtime: Runtime.NODEJS_22_X,
        entry: "./resources/authorizer-lambda-handler.ts",
        handler: "handler",
        timeout: cdk.Duration.seconds(20),
        environment: {
          CLERK_JWT_SECRET_NAME: clerkJwtSecretName,
        },
      }
    );

    const lambdaAuthorizer = new TokenAuthorizer(this, "rgbRestApiAuthorizer", {
      handler: getAllUserApiKeysAuthorizerLambda,
      authorizerName: "rgb-rest-api-token-authorizer",
      identitySource: "method.request.header.Authorization",
    });

    //get the rest api we created in the api stack
    const rgbRestApi = RestApi.fromRestApiAttributes(this, "rgb-rest-api", {
      restApiId: rgbRestApiId,
      rootResourceId: rgbRestApiRootResourceId,
    });

    const v1Root = rgbRestApi.root.addResource("v1");

    // route to generate presigned url
    const generatePresignedUrlRoute = v1Root.addResource("process");

    //route for webhook events
    const webHookEventsRoute = v1Root.addResource("webhook");

    //route to fetch all the api keys a user has
    const allApiKeys = v1Root.addResource("keys");
    const getUsersApiKeysRoute = allApiKeys.addResource("{userId}");

    //route to request payments
    const requestPayment = v1Root.addResource("trigger-payment");

    generatePresignedUrlRoute.addMethod(
      HttpMethod.POST,
      new LambdaIntegration(generatePresignedUrlLambda),
      {
        apiKeyRequired: true,
      }
    );

    webHookEventsRoute.addMethod(
      HttpMethod.POST,
      new LambdaIntegration(webHookLambda)
    );

    getUsersApiKeysRoute.addMethod(
      HttpMethod.GET,
      new LambdaIntegration(getUsersApiKeysLambda),
      {
        authorizer: lambdaAuthorizer,
        authorizationType: AuthorizationType.CUSTOM,
      }
    );

    requestPayment.addMethod(
      HttpMethod.POST,
      new LambdaIntegration(requestPaymentLambda)
    );

    //grant the webhook Lambda permission to create new ApiKeys & fetch all our available keys
    //grant it permission to modify our usage plans
    webHookLambda.addToRolePolicy(
      new PolicyStatement({
        actions: ["apigateway:POST", "apigateway:PATCH"],
        resources: [
          `arn:aws:apigateway:${region}::/apikeys`,
          `arn:aws:apigateway:${region}::/usageplans/${freeTierUsagePlanId}`,
          `arn:aws:apigateway:${region}::/usageplans/${proTierUsagePlanId}`,
          `arn:aws:apigateway:${region}::/usageplans/${executiveTierUsagePlanId}`,
          `arn:aws:apigateway:${region}::/usageplans/${freeTierUsagePlanId}/keys`,
          `arn:aws:apigateway:${region}::/usageplans/${proTierUsagePlanId}/keys`,
          `arn:aws:apigateway:${region}::/usageplans/${executiveTierUsagePlanId}/keys`,
        ],
      })
    );

    //allow the webHookLambda to get the necessary secrets from secret manager
    webHookLambda.addToRolePolicy(
      new PolicyStatement({
        actions: ["secretsmanager:GetSecretValue"],
        resources: [
          `arn:aws:secretsmanager:us-east-1:266735801881:secret:RGB_PAYMENT_SECRET-XlWWaB`,
          "arn:aws:secretsmanager:us-east-1:266735801881:secret:RGB_Splitting_Plans-5l3O6l",
          "arn:aws:secretsmanager:us-east-1:266735801881:secret:RGB_WEBHOOK_SECRET-dZnzxj",
        ],
      })
    );

    requestPaymentLambda.addToRolePolicy(
      new PolicyStatement({
        actions: ["secretsmanager:GetSecretValue"],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:RGB_PAYMENT_SECRET*`,
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:RGB_Splitting_Plans*`,
        ],
      })
    );

    getAllUserApiKeysAuthorizerLambda.addToRolePolicy(
      new PolicyStatement({
        actions: ["secretsmanager:GetSecretValue"],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:RGB_CLERK_JWT_PUBLIC_KEY*`,
        ],
      })
    );

    s3Bucket.grantReadWrite(splittingLambda);

    s3Bucket.grantPut(generatePresignedUrlLambda);

    //trigger the splitting lambda when there is a new object added to the s3 bucket
    s3Bucket.addEventNotification(
      EventType.OBJECT_CREATED_PUT,
      new LambdaDestination(splittingLambda)
    );

    usersTable.grantReadWriteData(webHookLambda);

    usersTable.grantWriteData(splittingLambda);

    usersTable.grantReadData(getUsersApiKeysLambda);
  }
}
