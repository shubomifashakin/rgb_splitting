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
import { HttpMethod, Schedule } from "aws-cdk-lib/aws-events";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { S3Bucket } from "aws-cdk-lib/aws-kinesisfirehose";
import { AttributeType, Table } from "aws-cdk-lib/aws-dynamodb";
import { LambdaDestination } from "aws-cdk-lib/aws-s3-notifications";

import * as dotenv from "dotenv";
import {
  EventBridgeSchedulerCreateScheduleTask,
  EventBridgeSchedulerTarget,
} from "aws-cdk-lib/aws-stepfunctions-tasks";

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
        name: "id",
        type: AttributeType.STRING,
      },
      sortKey: {
        name: "userId",
        type: AttributeType.STRING,
      },
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    usersTable.addGlobalSecondaryIndex({
      indexName: "expiredSubscriptionIndex",
      partitionKey: {
        name: "sub_status",
        type: AttributeType.STRING,
      },

      sortKey: {
        name: "nextPaymentDate",
        type: AttributeType.NUMBER,
      },
    });

    usersTable.addGlobalSecondaryIndex({
      indexName: "userIdIndex",
      partitionKey: {
        name: "userId",
        type: AttributeType.STRING,
      },
    });

    const canvasLayer = LayerVersion.fromLayerVersionArn(
      this,
      "lambda-layer-canvas-nodejs",
      `arn:aws:lambda:${this.region}:${this.account}:layer:canvas-nodejs:1`
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
          REGION: this.region,
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
      `${projectPrefix}-generate-presigned-url-lambda`,
      {
        functionName: `${projectPrefix}-generate-presigned-url-lambda`,
        description:
          "This lambda generates presigned urls to users with valid apikeys",
        timeout: cdk.Duration.seconds(10),
        runtime: Runtime.NODEJS_20_X,
        environment: {
          BUCKET_NAME: S3Bucket.name,
          REGION: this.region,
        },
        entry: "./resources/generate-presigned-url.ts",
        handler: "handler",
      }
    );

    //used to verify webhooks,
    const webHookLambda = new NodejsFunction(
      this,
      `${projectPrefix}-webHook-Lambda`,
      {
        functionName: `${projectPrefix}-webhook-lambda`,
        description:
          "This lambda receives webhook events from our payment gateway",
        runtime: Runtime.NODEJS_22_X,
        entry: "./resources/webhook-handler.ts",
        handler: "handler",
        environment: {
          REGION: this.region,
          TABLE_NAME: usersTable.tableName,
          PAYMENT_SECRET_NAME: paymentSecretName,
          AVAILABLE_PLANS_SECRET_NAME: availablePlansSecretName,
          WEBHOOK_SECRET_NAME: webhookSecretName,
        },
        timeout: cdk.Duration.seconds(20),
      }
    );

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
          REGION: this.region,
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
          REGION: this.region,
          PAYMENT_SECRET_NAME: paymentSecretName,
          AVAILABLE_PLANS_SECRET_NAME: availablePlansSecretName,
        },
        timeout: cdk.Duration.seconds(30),
      }
    );

    const getAllUserApiKeysAuthorizerLambda = new NodejsFunction(
      this,
      `${projectPrefix}-all-apiKeys-authorizer-lambda`,
      {
        functionName: `${projectPrefix}-all-apiKeys-authorizer-lambda`,
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
    const resubscribeLambda = new NodejsFunction(
      this,
      `${projectPrefix}-resubscribe-lambda`,
      {
        functionName: `${projectPrefix}-resubscribe-lambda`,
        description:
          "This lambda is used for resubscribing all users with expired subscriptions to their plan. It runs every week, triggered by the event bridge rule",
        runtime: Runtime.NODEJS_22_X,
        entry: "./resources/resubscribe.ts",
        handler: "handler",
        environment: {
          REGION: this.region,
          TABLE_NAME: usersTable.tableName,
          PAYMENT_SECRET_NAME: paymentSecretName,
          AVAILABLE_PLANS_SECRET_NAME: availablePlansSecretName,
        },
        timeout: cdk.Duration.minutes(2), //TODO: CHANGE TO 7 DAYS
      }
    );

    const lambdaAuthorizer = new TokenAuthorizer(
      this,
      `${projectPrefix}-all-ApiKeys-Authorizer`,
      {
        handler: getAllUserApiKeysAuthorizerLambda,
        authorizerName: `${projectPrefix}-rest-api-token-authorizer`,
        identitySource: "method.request.header.Authorization",
      }
    );

    //get the rest api we created in the api stack
    const rgbRestApi = RestApi.fromRestApiAttributes(
      this,
      `${projectPrefix}-rest-api`,
      {
        restApiId: rgbRestApiId,
        rootResourceId: rgbRestApiRootResourceId,
      }
    );

    const v1Root = rgbRestApi.root.addResource("v1");

    // route to generate presigned url
    const generatePresignedUrlRoute = v1Root.addResource("process");

    //route for webhook events
    const webHookEventsRoute = v1Root.addResource("webhook");

    //route to fetch all the api keys a user has
    const getUsersApiKeysRoute = v1Root.addResource("keys");

    //route to request payments
    const triggerChargeRoute = v1Root.addResource("trigger-payment");

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

    triggerChargeRoute.addMethod(
      HttpMethod.POST,
      new LambdaIntegration(requestPaymentLambda)
    );

    //grant the webhook Lambda permission to create new ApiKeys & fetch all our available keys
    //grant it permission to modify our usage plans
    webHookLambda.addToRolePolicy(
      new PolicyStatement({
        actions: [
          "apigateway:POST",
          "apigateway:PATCH",
          "secretsmanager:GetSecretValue",
        ],
        resources: [
          `arn:aws:apigateway:${this.region}::/apikeys`,
          `arn:aws:apigateway:${this.region}::/usageplans/${freeTierUsagePlanId}`,
          `arn:aws:apigateway:${this.region}::/usageplans/${proTierUsagePlanId}`,
          `arn:aws:apigateway:${this.region}::/usageplans/${executiveTierUsagePlanId}`,
          `arn:aws:apigateway:${this.region}::/usageplans/${freeTierUsagePlanId}/keys`,
          `arn:aws:apigateway:${this.region}::/usageplans/${proTierUsagePlanId}/keys`,
          `arn:aws:apigateway:${this.region}::/usageplans/${executiveTierUsagePlanId}/keys`,
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:RGB_PAYMENT_SECRET*`,
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:RGB_Splitting_Plans*`,
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:RGB_WEBHOOK_SECRET*`,
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

    resubscribeLambda.addToRolePolicy(
      new PolicyStatement({
        actions: [
          "apigateway:POST",
          "apigateway:PATCH",
          "secretsmanager:GetSecretValue",
        ],
        resources: [
          `arn:aws:apigateway:${this.region}::/apikeys`,
          `arn:aws:apigateway:${this.region}::/usageplans/${freeTierUsagePlanId}`,
          `arn:aws:apigateway:${this.region}::/usageplans/${proTierUsagePlanId}`,
          `arn:aws:apigateway:${this.region}::/usageplans/${executiveTierUsagePlanId}`,
          `arn:aws:apigateway:${this.region}::/usageplans/${freeTierUsagePlanId}/keys`,
          `arn:aws:apigateway:${this.region}::/usageplans/${proTierUsagePlanId}/keys`,
          `arn:aws:apigateway:${this.region}::/usageplans/${executiveTierUsagePlanId}/keys`,
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:RGB_PAYMENT_SECRET*`,
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:RGB_Splitting_Plans*`,
        ],
      })
    );

    const eventBridgeRole = new cdk.aws_iam.Role(
      this,
      `${projectPrefix}-resubscribe-event-role`,
      {
        roleName: `${projectPrefix}-resubscribe-event-role`,
        description:
          "This role allows eventbridge to trigger our resubscription lambda",
        assumedBy: new cdk.aws_iam.ServicePrincipal("events.amazonaws.com"),
      }
    );

    //allow eventbridge to trigger lambda function
    eventBridgeRole.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ["lambda:InvokeFunction"],
        resources: [resubscribeLambda.functionArn],
      })
    );

    //this event bridge rule is used to cancel all expired subscriptions
    //calls the cancel lambda every week
    const eventBridgeTask = new EventBridgeSchedulerCreateScheduleTask(
      this,
      `${projectPrefix}-resubscribe-eventbridge-task`,
      {
        scheduleName: `${projectPrefix}-resubscribe-eventbridge-task`,
        schedule: Schedule.rate(cdk.Duration.minutes(3)),
        startDate: new Date(),
        description:
          "This rule runs every week to resubscribe all users whose subscribtions have expired to their plan",
        flexibleTimeWindow: cdk.Duration.minutes(5),
        target: new EventBridgeSchedulerTarget({
          arn: resubscribeLambda.functionArn,
          role: eventBridgeRole,
          retryPolicy: {
            maximumRetryAttempts: 3,
            maximumEventAge: cdk.Duration.days(1),
          },
        }),
      }
    );

    s3Bucket.grantReadWrite(splittingLambda);

    s3Bucket.grantPut(generatePresignedUrlLambda);

    //trigger the splitting lambda when there is a new object added to the s3 bucket
    s3Bucket.addEventNotification(
      EventType.OBJECT_CREATED_PUT,
      new LambdaDestination(splittingLambda)
    );

    usersTable.grantReadWriteData(webHookLambda);
    usersTable.grantReadWriteData(resubscribeLambda);

    usersTable.grantWriteData(splittingLambda);

    usersTable.grantReadData(getUsersApiKeysLambda);
  }
}
