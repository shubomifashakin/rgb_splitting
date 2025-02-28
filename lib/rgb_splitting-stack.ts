import { Construct } from "constructs";

import * as cdk from "aws-cdk-lib";
import { LayerVersion, Runtime } from "aws-cdk-lib/aws-lambda";
import { BlockPublicAccess, Bucket, EventType } from "aws-cdk-lib/aws-s3";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { CorsHttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import {
  ApiKeySourceType,
  AuthorizationType,
  Cors,
  LambdaIntegration,
  Period,
  RestApi,
  TokenAuthorizer,
  UsagePlan,
} from "aws-cdk-lib/aws-apigateway";
import { HttpMethod } from "aws-cdk-lib/aws-events";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { S3Bucket } from "aws-cdk-lib/aws-kinesisfirehose";
import { AttributeType, Table } from "aws-cdk-lib/aws-dynamodb";
import { LambdaDestination } from "aws-cdk-lib/aws-s3-notifications";

import * as dotenv from "dotenv";
import { RgbApiStack } from "./RgbApiStack";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";

dotenv.config();

const region = process.env.REGION;
const clerkJwtKey = process.env.CLERK_JWT_KEY;

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

    if (typeof region !== "string") {
      throw new Error("Region does not exist in environment");
    }

    if (typeof clerkJwtKey !== "string") {
      throw new Error("Clerk Jwt does not exist in environment");
    }

    const rgbRestApiId = props.RGBApiStack.RgbRestApiId;
    const rgbRestApiRootResourceId = props.RGBApiStack.RgbRestApiRootResourceId;
    const freeTierUsagePlanId = props.RGBApiStack.freeTierUsagePlanId;
    const proTierUsagePlanId = props.RGBApiStack.proTierUsagePlanId;
    const executiveTierUsagePlanId = props.RGBApiStack.executiveTierUsagePlanId;

    const s3Bucket = new Bucket(this, "rgb-splitting-bucket-sh", {
      versioned: true,
      publicReadAccess: true,
      bucketName: "rgb-split-bucket-sh",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      blockPublicAccess: BlockPublicAccess.BLOCK_ACLS,
    });

    const usersTable = new Table(this, "rgb-splitting-table-sh", {
      tableName: "rgb-splitting-table-sh",
      partitionKey: {
        name: "userId",
        type: AttributeType.STRING,
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

    usersTable.addGlobalSecondaryIndex({
      indexName: "createdAtIndex",
      partitionKey: {
        name: "userId",
        type: AttributeType.STRING,
      },
      sortKey: {
        name: "createdAt",
        type: AttributeType.NUMBER,
      },
    });

    const canvasLayer = LayerVersion.fromLayerVersionArn(
      this,
      "lambda-layer-canvas-nodejs",
      "arn:aws:lambda:us-east-1:266735801881:layer:canvas-nodejs:1"
    );

    const splittingLambda = new NodejsFunction(
      this,
      "rgb-splitting-lambda-sh",
      {
        functionName: "rgb-splitting-lambda-sh",
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

    //used to generate an api key and add that key to a usage plan
    const generateApiKeyLambda = new NodejsFunction(
      this,
      "generateApiKeyLambda",
      {
        functionName: "rgb-splitting-generate-key-lambda",
        description:
          "This lambda is used to generate an api key & add the generated api key to the usage plan passed",
        runtime: Runtime.NODEJS_22_X,
        entry: "./resources/generate-key-handler.ts",
        handler: "handler",
        environment: {
          REGION: region,
          TABLE_NAME: usersTable.tableName,
          FREE_TIER_USAGE_PLAN_ID: freeTierUsagePlanId,
          PRO_TIER_USAGE_PLAN_ID: proTierUsagePlanId,
          EXECUTIVE_TIER_USAGE_PLAN_ID: executiveTierUsagePlanId,
        },
        timeout: cdk.Duration.seconds(20),
      }
    );

    //used to get all the api keys owned by a particular user
    const getUsersApiKeysLambda = new NodejsFunction(
      this,
      "rgb-splitting-get-all-user-api-keys-lambda",
      {
        functionName: "rgb-splitting-get-all-user-api-keys-lambda",
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

    //the lambda that handles authorizations
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

    //route to generate the api key
    const generateApiKeyRoute = v1Root.addResource("generate-api-key");

    //route to fetch all the api keys a user has
    const allApiKeys = v1Root.addResource("keys");
    const getUsersApiKeysRoute = allApiKeys.addResource("{userId}");

    generatePresignedUrlRoute.addMethod(
      HttpMethod.POST,
      new LambdaIntegration(generatePresignedUrlLambda),
      {
        apiKeyRequired: true,
      }
    );

    generateApiKeyRoute.addMethod(
      HttpMethod.POST,
      new LambdaIntegration(generateApiKeyLambda)
    );

    getUsersApiKeysRoute.addMethod(
      HttpMethod.GET,
      new LambdaIntegration(getUsersApiKeysLambda),
      {
        authorizer: lambdaAuthorizer,
        authorizationType: AuthorizationType.CUSTOM,
      }
    );

    //grant the generate apiKey Lambda permission to create new ApiKeys & fetch all our available keys
    //grant it permission to modify our usage plans
    generateApiKeyLambda.addToRolePolicy(
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

    //allow the authorizer lambda to get the JWT public key from secret storage
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

    usersTable.grantWriteData(splittingLambda);

    usersTable.grantWriteData(generateApiKeyLambda);

    //allow the getUserApiKeys lambda to read from our database
    usersTable.grantReadData(getUsersApiKeysLambda);
  }
}
