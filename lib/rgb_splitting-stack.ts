import { Construct } from "constructs";

import * as cdk from "aws-cdk-lib";
import { LayerVersion, Runtime } from "aws-cdk-lib/aws-lambda";
import { BlockPublicAccess, Bucket, EventType } from "aws-cdk-lib/aws-s3";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import {
  AuthorizationType,
  Cors,
  Deployment,
  LambdaIntegration,
  Period,
  RestApi,
  Stage,
  TokenAuthorizer,
  UsagePlan,
} from "aws-cdk-lib/aws-apigateway";
import { HttpMethod, Schedule } from "aws-cdk-lib/aws-events";
import { PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { S3Bucket } from "aws-cdk-lib/aws-kinesisfirehose";
import { AttributeType, Table } from "aws-cdk-lib/aws-dynamodb";
import { LambdaDestination } from "aws-cdk-lib/aws-s3-notifications";

import * as dotenv from "dotenv";
import {
  EventBridgeSchedulerCreateScheduleTask,
  EventBridgeSchedulerTarget,
} from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";

dotenv.config();

const projectPrefix = "rgb-splitting";
const region = process.env.REGION!;
const paymentSecretName = process.env.PAYMENT_SECRET_NAME!;
const webhookSecretName = process.env.WEBHOOK_SECRET_NAME!;
const clerkJwtSecretName = process.env.CLERK_JWT_SECRET_NAME!;
const paymentGatewayUrl = process.env.PAYMENT_GATEWAY_URL!;
const alarmSubscriptionEmail = process.env.SUBSCRIPTION_EMAIL!;

///did this to prevent a circular dependency issue betweent the lmbdas that neeed the secret name and the usage plans
const availablePlansSecretName = `${projectPrefix}-all-usage-plans-secret`;

export class RgbSplittingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, {
      ...props,
      env: {
        region,
      },
    });

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

    const deadLetterQueue = new Queue(
      this,
      `${projectPrefix}-cancel-subscription-dlq`,
      {
        queueName: `${projectPrefix}-cancel-subscription-dlq`,
        retentionPeriod: cdk.Duration.days(14),
      }
    );

    //resubscriptions that failed are sent to this queue so they can be downgraded to the free plan
    const cancelSubscriptionQueue = new Queue(
      this,
      `${projectPrefix}-cancel-subscription-queue`,
      {
        queueName: `${projectPrefix}-cancel-subscription-queue`,
        retentionPeriod: cdk.Duration.days(4),
        visibilityTimeout: cdk.Duration.minutes(1),
        deadLetterQueue: {
          queue: deadLetterQueue,
          maxReceiveCount: 2,
        },
        deliveryDelay: cdk.Duration.seconds(20),
        receiveMessageWaitTime: cdk.Duration.seconds(20),
      }
    );

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
          WEBHOOK_SECRET_NAME: webhookSecretName,
          PAYMENT_GATEWAY_URL: paymentGatewayUrl,
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
        timeout: cdk.Duration.seconds(10),
      }
    );

    const triggerChargeLambda = new NodejsFunction(
      this,
      `${projectPrefix}-Payments-Lambda`,
      {
        functionName: `${projectPrefix}-payments-lambda`,
        description: "This lambda is used to handle subcription payments.",
        runtime: Runtime.NODEJS_22_X,
        entry: "./resources/payments-handler.ts",
        handler: "handler",
        environment: {
          REGION: this.region,
          PAYMENT_SECRET_NAME: paymentSecretName,
          AVAILABLE_PLANS_SECRET_NAME: availablePlansSecretName,
          PAYMENT_GATEWAY_URL: paymentGatewayUrl,
        },
        timeout: cdk.Duration.seconds(15),
      }
    );

    const userAuthorizerLambda = new NodejsFunction(
      this,
      `${projectPrefix}-user-authorizer-lambda`,
      {
        functionName: `${projectPrefix}-user-authorizer-lambda`,
        description: "This lambda validates the user",
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
          PAYMENT_GATEWAY_URL: paymentGatewayUrl,
          PAYMENT_SECRET_NAME: paymentSecretName,
          QUEUE_URL: cancelSubscriptionQueue.queueUrl,
          AVAILABLE_PLANS_SECRET_NAME: availablePlansSecretName,
        },
        timeout: cdk.Duration.minutes(2), //TODO: CHANGE TO 7 DAYS
      }
    );

    const cancelSubscriptionLambda = new NodejsFunction(
      this,
      "${projectPrefix}-cancel-subscription-queue-lambda",
      {
        functionName: `${projectPrefix}-cancel-subscription-queue-lambda`,
        description:
          "This lambda is used to cancel subscriptions that have failed to resubscribe. It receives messages from the sqs queue",
        runtime: Runtime.NODEJS_22_X,
        entry: "./resources/cancel-subscription-queue-handler.ts",
        handler: "handler",
        environment: {
          REGION: this.region,
          TABLE_NAME: usersTable.tableName,
          AVAILABLE_PLANS_SECRET_NAME: availablePlansSecretName,
        },
        timeout: cdk.Duration.seconds(30),
      }
    );

    cancelSubscriptionLambda.addEventSource(
      new SqsEventSource(cancelSubscriptionQueue, { batchSize: 10 })
    );

    const snsTopic = new cdk.aws_sns.Topic(this, `${projectPrefix}-sns-topic`, {
      topicName: `${projectPrefix}-sns-topic`,
      displayName: `${projectPrefix}-ERROR`,
    });

    snsTopic.addSubscription(
      new cdk.aws_sns_subscriptions.EmailSubscription(alarmSubscriptionEmail)
    );

    const resubscribeErrorAlarm = new cdk.aws_cloudwatch.Alarm(
      this,
      `${projectPrefix}-resubscribe-errors-alarm`,
      {
        metric: resubscribeLambda.metricErrors({
          period: cdk.Duration.minutes(10),
          statistic: "SUM",
        }),
        evaluationPeriods: 1,
        threshold: 2,
        comparisonOperator:
          cdk.aws_cloudwatch.ComparisonOperator
            .GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        actionsEnabled: true,
        alarmName: `${projectPrefix}-resubscribe-alarm`.toUpperCase(),
        alarmDescription:
          "The lambda for resubscribing users does not function as expected",
      }
    );

    const deadLetterQueueAlarm = new cdk.aws_cloudwatch.Alarm(
      this,
      `${projectPrefix}-dead-letter-queue-alarm`,
      {
        metric: deadLetterQueue.metricApproximateNumberOfMessagesVisible({
          statistic: "MAX",
        }),
        evaluationPeriods: 1,
        threshold: 1,
        comparisonOperator:
          cdk.aws_cloudwatch.ComparisonOperator
            .GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        actionsEnabled: true,
        alarmName: `${projectPrefix}-dead-letter-queue-alarm`.toUpperCase(),
        alarmDescription: "There are messages in the dead letter queue",
      }
    );

    resubscribeErrorAlarm.addAlarmAction(
      new cdk.aws_cloudwatch_actions.SnsAction(snsTopic)
    );

    deadLetterQueueAlarm.addAlarmAction(
      new cdk.aws_cloudwatch_actions.SnsAction(snsTopic)
    );

    const userAuthorizer = new TokenAuthorizer(
      this,
      `${projectPrefix}-user-Authorizer`,
      {
        handler: userAuthorizerLambda,
        authorizerName: `${projectPrefix}-rest-api-token-authorizer`,
        identitySource: "method.request.header.Authorization",
      }
    );

    //create the rest api
    const rgbRestApi = new RestApi(this, `${projectPrefix}-rest-api-sh`, {
      restApiName: `${projectPrefix}-rest-api-sh`,
      description: "the base rest api for the rgb splitting",
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
        allowMethods: Cors.ALL_METHODS,
        allowHeaders: [
          "Content-Type",
          "Authorization",
          "X-Api-Key",
          "x-api-key",
        ],
        allowCredentials: false,
      },
      deploy: true,
      deployOptions: {
        stageName: "dev",
        description: "The dev api stage deployment for the rgb splitting",
      },
    });

    const prodStage = new Stage(this, `${projectPrefix}-prod-stage`, {
      stageName: "prod",
      deployment: new Deployment(this, `${projectPrefix}-api-prod-deployment`, {
        api: rgbRestApi,
        description: "The prod api stage deployment for the rgb splitting",
      }),
      description: "The prod api stage for the rgb splitting",
    });

    //create the usage plans
    const freeTierUsagePlan = new UsagePlan(
      this,
      `${projectPrefix}-free-plan`,
      {
        name: `${projectPrefix}-free-plan`,
        description: "Free tier usage plan, 200 Requests per month",
        apiStages: [
          { stage: rgbRestApi.deploymentStage },
          { stage: prodStage },
        ],
        quota: {
          limit: 200,
          period: Period.MONTH,
        },
        throttle: {
          rateLimit: 1,
          burstLimit: 5,
        },
      }
    );

    const proTierUsagePlan = new UsagePlan(this, `${projectPrefix}-pro-plan`, {
      name: `${projectPrefix}-pro-plan`,
      description: "Pro tier usage plan, 1000 Requests per month",
      apiStages: [{ stage: rgbRestApi.deploymentStage }, { stage: prodStage }],
      quota: {
        limit: 1000,
        period: Period.MONTH,
      },
      throttle: {
        rateLimit: 5,
        burstLimit: 50,
      },
    });

    const executiveTierUsagePlan = new UsagePlan(
      this,
      `${projectPrefix}-executive-plan`,
      {
        name: `${projectPrefix}-executive-plan`,
        description: "Executive tier usage plan, 2500 Requests per month",
        apiStages: [
          { stage: rgbRestApi.deploymentStage },
          { stage: prodStage },
        ],
        quota: {
          limit: 2500,
          period: Period.MONTH,
        },
        throttle: {
          rateLimit: 5,
          burstLimit: 50,
        },
      }
    );

    const usagePlansSecret = new Secret(this, `${availablePlansSecretName}`, {
      secretName: `${availablePlansSecretName}`,
      secretObjectValue: {
        free: cdk.SecretValue.unsafePlainText(freeTierUsagePlan.usagePlanId),
        pro: cdk.SecretValue.unsafePlainText(proTierUsagePlan.usagePlanId),
        executive: cdk.SecretValue.unsafePlainText(
          executiveTierUsagePlan.usagePlanId
        ),
      },
      description:
        "this is used to store all the usage planIds so we dont have to keep passing them around",
    });

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
        authorizer: userAuthorizer,
        authorizationType: AuthorizationType.CUSTOM,
      }
    );

    triggerChargeRoute.addMethod(
      HttpMethod.POST,
      new LambdaIntegration(triggerChargeLambda)
    );

    //construct the prod stage ARN
    const prodStageArn = `arn:aws:execute-api:${cdk.Stack.of(this).region}:${
      cdk.Stack.of(this).account
    }:${rgbRestApi.restApiId}/prod/*/*`;

    //alow the prod stage invoke our lambdas
    splittingLambda.addPermission(
      `${projectPrefix}-allow-prod-stage-permission`,
      {
        principal: new ServicePrincipal("apigateway.amazonaws.com"),
        sourceArn: prodStageArn,
      }
    );

    generatePresignedUrlLambda.addPermission(
      `${projectPrefix}-allow-prod-stage-permission`,
      {
        principal: new ServicePrincipal("apigateway.amazonaws.com"),
        sourceArn: prodStageArn,
      }
    );

    webHookLambda.addPermission(
      `${projectPrefix}-allow-prod-stage-permission`,
      {
        principal: new ServicePrincipal("apigateway.amazonaws.com"),
        sourceArn: prodStageArn,
      }
    );

    getUsersApiKeysLambda.addPermission(
      `${projectPrefix}-allow-prod-stage-permission`,
      {
        principal: new ServicePrincipal("apigateway.amazonaws.com"),
        sourceArn: prodStageArn,
      }
    );

    triggerChargeLambda.addPermission(
      `${projectPrefix}-allow-prod-stage-permission`,
      {
        principal: new ServicePrincipal("apigateway.amazonaws.com"),
        sourceArn: prodStageArn,
      }
    );

    resubscribeLambda.addPermission(
      `${projectPrefix}-allow-prod-stage-permission`,
      {
        principal: new ServicePrincipal("apigateway.amazonaws.com"),
        sourceArn: prodStageArn,
      }
    );

    //grant the webhook Lambda permission to create new ApiKeys & fetch all our available keys
    //grant it permission to modify our usage plans
    webHookLambda.addToRolePolicy(
      new PolicyStatement({
        actions: [
          "apigateway:POST",
          "apigateway:PATCH",
          "apigateway:DELETE",
          "secretsmanager:GetSecretValue",
        ],
        resources: [
          `arn:aws:apigateway:${this.region}::/apikeys`,
          `arn:aws:apigateway:${this.region}::/apikeys/*`,
          `arn:aws:apigateway:${this.region}::/usageplans`,
          `arn:aws:apigateway:${this.region}::/usageplans/*/keys`,
          `arn:aws:apigateway:${this.region}::/usageplans/*/keys/*`,
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${webhookSecretName}*`,
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${paymentSecretName}*`,
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${availablePlansSecretName}*`,
        ],
      })
    );

    triggerChargeLambda.addToRolePolicy(
      new PolicyStatement({
        actions: ["secretsmanager:GetSecretValue"],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${paymentSecretName}*`,
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${availablePlansSecretName}*`,
        ],
      })
    );

    userAuthorizerLambda.addToRolePolicy(
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
          `arn:aws:apigateway:${this.region}::/usageplans`, //i did this to prevent circular dependency issues between lambda, the rest api & the usage plans
          `arn:aws:apigateway:${this.region}::/usageplans/*/keys`,
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${paymentSecretName}*`,
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${availablePlansSecretName}*`, // i did this to prevent circular dependency issue
        ],
      })
    );

    cancelSubscriptionLambda.addToRolePolicy(
      new PolicyStatement({
        actions: [
          "apigateway:POST",
          "apigateway:PATCH",
          "apigateway:DELETE",
          "apigateway:GET",
          "secretsmanager:GetSecretValue",
        ],
        resources: [
          `arn:aws:apigateway:${this.region}::/apikeys`,
          `arn:aws:apigateway:${this.region}::/apikeys/*`,
          `arn:aws:apigateway:${this.region}::/usageplans`, //i did this to prevent circular dependency issues between lambda, the rest api & the usage plans
          `arn:aws:apigateway:${this.region}::/usageplans/*/keys`,
          `arn:aws:apigateway:${this.region}::/usageplans/*/keys/*`,
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${availablePlansSecretName}*`, // i did this to prevent circular dependency issue
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
            maximumRetryAttempts: 2,
            maximumEventAge: cdk.Duration.days(1),
          },
        }),
      }
    );

    cancelSubscriptionQueue.grantSendMessages(resubscribeLambda);
    cancelSubscriptionQueue.grantConsumeMessages(cancelSubscriptionLambda);

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

    usersTable.grantReadWriteData(cancelSubscriptionLambda);
  }
}
