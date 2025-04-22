import { Construct } from "constructs";

import * as cdk from "aws-cdk-lib";
import { LayerVersion, RecursiveLoop, Runtime } from "aws-cdk-lib/aws-lambda";
import {
  Bucket,
  EventType,
  HttpMethods,
  BlockPublicAccess,
} from "aws-cdk-lib/aws-s3";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import {
  AuthorizationType,
  Cors,
  LambdaIntegration,
  Period,
  RestApi,
  TokenAuthorizer,
  UsagePlan,
} from "aws-cdk-lib/aws-apigateway";
import { HttpMethod } from "aws-cdk-lib/aws-events";
import { AttributeType, Table } from "aws-cdk-lib/aws-dynamodb";
import { LambdaDestination } from "aws-cdk-lib/aws-s3-notifications";
import { PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";

import { Queue } from "aws-cdk-lib/aws-sqs";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";

import { PlanType, processedImagesRouteVar } from "../helpers/constants";

///did this to prevent a circular dependency issue betweent the lmbdas that neeed the secret name and the usage plans

interface RgbStackProps extends cdk.StackProps {
  variables: {
    stage: "dev" | "prod";

    projectPrefix: string;
    paymentSecretName: string;
    paymentGatewayUrl: string;
    webhookSecretName: string;
    clerkJwtSecretName: string;
    alarmSubscriptionEmail: string;
  };
}

export class RgbSplittingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: RgbStackProps) {
    super(scope, id, {
      ...props,
    });

    const availablePlansSecretName = `${props.variables.projectPrefix}-all-usage-plans-secret`;

    const s3Bucket = new Bucket(
      this,
      `${props.variables.projectPrefix}-bucket-sh`,
      {
        versioned: false,
        publicReadAccess: true,
        bucketName: `${props.variables.projectPrefix}-bucket-sh`.toLowerCase(),
        removalPolicy:
          props.variables.stage === "dev"
            ? cdk.RemovalPolicy.DESTROY
            : cdk.RemovalPolicy.RETAIN,
        blockPublicAccess: BlockPublicAccess.BLOCK_ACLS,
        cors: [
          {
            allowedHeaders: ["*"],
            allowedMethods: [
              HttpMethods.POST,
              HttpMethods.GET,
              HttpMethods.PUT,
            ],
            allowedOrigins: Cors.ALL_ORIGINS,
            exposedHeaders: ["ETAG"],
          },
        ],
      }
    );

    const projectsTable = new Table(
      this,
      `${props.variables.projectPrefix}-table-sh`,
      {
        tableName: `${props.variables.projectPrefix}-table-sh`,
        partitionKey: {
          name: "projectId",
          type: AttributeType.STRING,
        },
        sortKey: {
          name: "userId",
          type: AttributeType.STRING,
        },
        pointInTimeRecoverySpecification: {
          pointInTimeRecoveryEnabled: true,
        },
        removalPolicy:
          props.variables.stage === "dev"
            ? cdk.RemovalPolicy.DESTROY
            : cdk.RemovalPolicy.RETAIN,
      }
    );

    projectsTable.addGlobalSecondaryIndex({
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

    projectsTable.addGlobalSecondaryIndex({
      indexName: "userIdIndex",
      partitionKey: {
        name: "userId",
        type: AttributeType.STRING,
      },
      sortKey: {
        name: "createdAt",
        type: AttributeType.NUMBER,
      },
    });

    projectsTable.addGlobalSecondaryIndex({
      indexName: "apiKeyIndex",
      partitionKey: {
        name: "apiKey",
        type: AttributeType.STRING,
      },
    });

    const processedImagesTable = new Table(
      this,
      `${props.variables.projectPrefix}-processed-images-table-sh`,
      {
        tableName: `${props.variables.projectPrefix}-processed-images-table-sh`,
        partitionKey: {
          name: "imageId",
          type: AttributeType.STRING,
        },
        sortKey: {
          name: "projectId",
          type: AttributeType.STRING,
        },
        pointInTimeRecoverySpecification: {
          pointInTimeRecoveryEnabled: true,
        },
        removalPolicy:
          props.variables.stage === "dev"
            ? cdk.RemovalPolicy.DESTROY
            : cdk.RemovalPolicy.RETAIN,
      }
    );

    processedImagesTable.addGlobalSecondaryIndex({
      indexName: "projectIdIndex",
      partitionKey: {
        name: "projectId",
        type: AttributeType.STRING,
      },
    });

    //this queue is used to store messages that failed to be downgraded
    const downgradeSubscriptionDLQ = new Queue(
      this,
      `${props.variables.projectPrefix}-downgrade-subscription-dlq`,
      {
        queueName: `${props.variables.projectPrefix}-downgrade-subscription-dlq`,
        retentionPeriod: cdk.Duration.days(14),
      }
    );

    //resubscriptions that failed are sent to this queue so they can be downgraded to the free plan
    const downgradeSubscriptionQueue = new Queue(
      this,
      `${props.variables.projectPrefix}-downgrade-subscription-queue`,
      {
        queueName: `${props.variables.projectPrefix}-downgrade-subscription-queue`,
        retentionPeriod: cdk.Duration.days(4),
        visibilityTimeout: cdk.Duration.minutes(1.2), //once the message is sent out, if the message is not processed before this timer ends, it would reappppear
        deadLetterQueue: {
          maxReceiveCount: 2,
          queue: downgradeSubscriptionDLQ,
        },
        deliveryDelay: cdk.Duration.seconds(20),
        receiveMessageWaitTime: cdk.Duration.seconds(20),
      }
    );

    const resubscriptionDeadLetterQueue = new Queue(
      this,
      `${props.variables.projectPrefix}-resubscription-dlq`,
      {
        queueName: `${props.variables.projectPrefix}-resubscription-dlq`,
        retentionPeriod: cdk.Duration.days(14),
      }
    );

    const resubscribeSubscriptionQueue = new Queue(
      this,
      `${props.variables.projectPrefix}-resubscribe-subscription-queue`,
      {
        queueName: `${props.variables.projectPrefix}-resubscribe-subscription-queue`,
        retentionPeriod: cdk.Duration.days(4),
        visibilityTimeout: cdk.Duration.minutes(3),
        deadLetterQueue: {
          maxReceiveCount: 2,
          queue: resubscriptionDeadLetterQueue,
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
      `${props.variables.projectPrefix}-lambda-sh`,
      {
        functionName: `${props.variables.projectPrefix}-lambda-sh`,
        description:
          "this lambda is used for processing the image that was uploaded to s3",
        timeout: cdk.Duration.minutes(1.5),
        runtime: Runtime.NODEJS_20_X,
        environment: {
          REGION: this.region,
          BUCKET_NAME: s3Bucket.bucketName,
          RESULTS_TABLE_NAME: processedImagesTable.tableName,
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
      `${props.variables.projectPrefix}-generate-presigned-url-lambda`,
      {
        functionName: `${props.variables.projectPrefix}-generate-presigned-url-lambda`,
        description:
          "This lambda generates presigned urls to users with valid apikeys",
        timeout: cdk.Duration.seconds(10),
        runtime: Runtime.NODEJS_20_X,
        environment: {
          REGION: this.region,
          BUCKET_NAME: s3Bucket.bucketName,
          TABLE_NAME: projectsTable.tableName,
        },
        entry: "./resources/generate-presigned-url.ts",
        handler: "handler",
      }
    );

    //used to verify webhooks,
    const webHookLambda = new NodejsFunction(
      this,
      `${props.variables.projectPrefix}-webHook-Lambda`,
      {
        functionName: `${props.variables.projectPrefix}-webhook-lambda`,
        description:
          "This lambda receives webhook events from our payment gateway",
        runtime: Runtime.NODEJS_22_X,
        entry: "./resources/webhook-handler.ts",
        handler: "handler",
        environment: {
          REGION: this.region,
          TABLE_NAME: projectsTable.tableName,
          PAYMENT_SECRET_NAME: props.variables.paymentSecretName,
          WEBHOOK_SECRET_NAME: props.variables.webhookSecretName,
          PAYMENT_GATEWAY_URL: props.variables.paymentGatewayUrl,
        },
        timeout: cdk.Duration.seconds(20),
      }
    );

    //used to get all the projects the user has created
    const getUsersProjectsLambda = new NodejsFunction(
      this,
      `${props.variables.projectPrefix}-get-users-projects-lambda`,
      {
        functionName: `${props.variables.projectPrefix}-get-users-projects-lambda`,
        description:
          "This lambda is used for getting all the projects for a user",
        runtime: Runtime.NODEJS_22_X,
        entry: "./resources/get-users-projects-handler.ts",
        handler: "handler",
        environment: {
          REGION: this.region,
          TABLE_NAME: projectsTable.tableName,
        },
        timeout: cdk.Duration.seconds(10),
      }
    );

    const triggerChargeLambda = new NodejsFunction(
      this,
      `${props.variables.projectPrefix}-Payments-Lambda`,
      {
        functionName: `${props.variables.projectPrefix}-payments-lambda`,
        description: "This lambda is used to handle subcription payments.",
        runtime: Runtime.NODEJS_22_X,
        entry: "./resources/payments-handler.ts",
        handler: "handler",
        environment: {
          REGION: this.region,
          PAYMENT_SECRET_NAME: props.variables.paymentSecretName,
          AVAILABLE_PLANS_SECRET_NAME: availablePlansSecretName,
          PAYMENT_GATEWAY_URL: props.variables.paymentGatewayUrl,
          TABLE_NAME: projectsTable.tableName,
        },
        timeout: cdk.Duration.seconds(15),
      }
    );

    const userAuthorizerLambda = new NodejsFunction(
      this,
      `${props.variables.projectPrefix}-user-authorizer-lambda`,
      {
        functionName: `${props.variables.projectPrefix}-user-authorizer-lambda`,
        description: "This lambda validates the user",
        runtime: Runtime.NODEJS_22_X,
        entry: "./resources/authorizer-lambda-handler.ts",
        handler: "handler",
        timeout: cdk.Duration.seconds(10),
        environment: {
          CLERK_JWT_SECRET_NAME: props.variables.clerkJwtSecretName,
        },
      }
    );

    const resubscribeLambda = new NodejsFunction(
      this,
      `${props.variables.projectPrefix}-resubscribe-lambda`,
      {
        functionName: `${props.variables.projectPrefix}-resubscribe-lambda`,
        description:
          "This lambda is used for resubscribing all users with expired subscriptions to their plan. It runs every week, triggered by the event bridge rule",
        runtime: Runtime.NODEJS_22_X,
        entry: "./resources/resubscribe.ts",
        handler: "handler",
        environment: {
          REGION: this.region,
          TABLE_NAME: projectsTable.tableName,
          PAYMENT_GATEWAY_URL: props.variables.paymentGatewayUrl,
          PAYMENT_SECRET_NAME: props.variables.paymentSecretName,
          AVAILABLE_PLANS_SECRET_NAME: availablePlansSecretName,
          RESUBSCRIBE_QUEUE_URL: resubscribeSubscriptionQueue.queueUrl,
          DOWNGRADE_SUBSCRIPTION_QUEUE_URL: downgradeSubscriptionQueue.queueUrl,
        },
        timeout: cdk.Duration.minutes(2),
        recursiveLoop: RecursiveLoop.ALLOW, // got an email from aws thar my function was terminated, so i added this, the resubscribe lambda uses a recursive design
        memorySize: 1536,
      }
    );

    const downgradeSubscriptionLambda = new NodejsFunction(
      this,
      `${props.variables.projectPrefix}-downgrade-subscription-queue-lambda`,
      {
        functionName: `${props.variables.projectPrefix}-downgrade-subscription-queue-lambda`,
        description:
          "This lambda is used to downgrade subscriptions that have failed to resubscribe. It receives messages from the sqs queue",
        runtime: Runtime.NODEJS_22_X,
        entry: "./resources/downgrade-subscription-handler.ts",
        handler: "handler",
        environment: {
          REGION: this.region,
          TABLE_NAME: projectsTable.tableName,
          AVAILABLE_PLANS_SECRET_NAME: availablePlansSecretName,
        },
        timeout: cdk.Duration.seconds(45),
      }
    );

    const getProcessedImagesLambda = new NodejsFunction(
      this,
      `${props.variables.projectPrefix}-get-processed-images-lambda`,
      {
        functionName: `${props.variables.projectPrefix}-get-processed-images-lambda`,
        description:
          "This lambda is used to get the processed images for an image",
        runtime: Runtime.NODEJS_22_X,
        entry: "./resources/get-processed-images-handler.ts",
        handler: "handler",
        environment: {
          REGION: this.region,
          PROCESSED_IMAGES_TABLE_NAME: processedImagesTable.tableName,
        },
        timeout: cdk.Duration.seconds(10),
      }
    );

    const cancelSubscriptionLambda = new NodejsFunction(
      this,
      `${props.variables.projectPrefix}-cancel-subscription-lambda`,
      {
        functionName: `${props.variables.projectPrefix}-cancel-subscription-lambda`,
        description:
          "This lambda is used to enable users cancel their subscription for a particular project",
        runtime: Runtime.NODEJS_22_X,
        entry: "./resources/cancel-subscription-handler.ts",
        handler: "handler",
        environment: {
          REGION: this.region,
          TABLE_NAME: projectsTable.tableName,
          AVAILABLE_PLANS_SECRET_NAME: availablePlansSecretName,
        },
        timeout: cdk.Duration.seconds(10),
      }
    );

    const getProjectInfoLambda = new NodejsFunction(
      this,
      `${props.variables.projectPrefix}-get-project-info-lambda`,
      {
        functionName: `${props.variables.projectPrefix}-get-project-info-lambda`,
        description:
          "This lambda is used to get the info for a particular project",
        runtime: Runtime.NODEJS_22_X,
        entry: "./resources/get-project-info-handler.ts",
        handler: "handler",
        environment: {
          REGION: this.region,
          TABLE_NAME: projectsTable.tableName,
          PROCESSED_IMAGES_TABLE_NAME: processedImagesTable.tableName,
        },
        timeout: cdk.Duration.seconds(10),
      }
    );

    const updateProjectNameLambda = new NodejsFunction(
      this,
      `${props.variables.projectPrefix}-update-project-name-lambda`,
      {
        functionName: `${props.variables.projectPrefix}-update-project-name-lambda`,
        description:
          "This lambda is used to update the name of a particular project",
        runtime: Runtime.NODEJS_22_X,
        entry: "./resources/update_project_name_handler.ts",
        handler: "handler",
        environment: {
          REGION: this.region,
          TABLE_NAME: projectsTable.tableName,
        },
        timeout: cdk.Duration.seconds(5),
      }
    );

    const deleteProjectLambda = new NodejsFunction(
      this,
      `${props.variables.projectPrefix}-delete-project-lambda`,
      {
        functionName: `${props.variables.projectPrefix}-delete-project-lambda`,
        description: "This lambda is used to delete a particular project",
        runtime: Runtime.NODEJS_22_X,
        entry: "./resources/delete_project_handler.ts",
        handler: "handler",
        environment: {
          REGION: this.region,
          TABLE_NAME: projectsTable.tableName,
        },
        timeout: cdk.Duration.seconds(5),
      }
    );

    //let the resubscribe lambda also receive events from the queue
    resubscribeLambda.addEventSource(
      new SqsEventSource(resubscribeSubscriptionQueue, { batchSize: 10 })
    );

    downgradeSubscriptionLambda.addEventSource(
      new SqsEventSource(downgradeSubscriptionQueue, {
        batchSize: 10,
        reportBatchItemFailures: true,
      })
    );

    const snsTopic = new cdk.aws_sns.Topic(
      this,
      `${props.variables.projectPrefix}-sns-topic`,
      {
        topicName: `${props.variables.projectPrefix}-sns-topic`,
        displayName: `${props.variables.projectPrefix}-ERROR`,
      }
    );

    snsTopic.addSubscription(
      new cdk.aws_sns_subscriptions.EmailSubscription(
        props.variables.alarmSubscriptionEmail
      )
    );

    //this alarm is triggered if there have been 3 errors or more in the splitting lambda in the last 10 minutes
    const splittingErrorAlarm = new cdk.aws_cloudwatch.Alarm(
      this,
      `${props.variables.projectPrefix}-splitting-errors-alarm`,
      {
        metric: splittingLambda.metricErrors({
          period: cdk.Duration.minutes(10),
          statistic: "sum",
        }),
        evaluationPeriods: 1,
        threshold: 3,
        comparisonOperator:
          cdk.aws_cloudwatch.ComparisonOperator
            .GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        actionsEnabled: true,
        alarmName:
          `${props.variables.projectPrefix}-splitting-alarm`.toUpperCase(),
        alarmDescription:
          "There have been 3 or more errors in the lambda for splitting images in the last 10 minutes",
      }
    );

    splittingErrorAlarm.addAlarmAction(
      new cdk.aws_cloudwatch_actions.SnsAction(snsTopic)
    );

    //this alarm is triggered if the resubscribe lambda fails 2 times in 10 minutes
    const resubscribeErrorAlarm = new cdk.aws_cloudwatch.Alarm(
      this,
      `${props.variables.projectPrefix}-resubscribe-errors-alarm`,
      {
        metric: resubscribeLambda.metricErrors({
          period: cdk.Duration.minutes(10),
          statistic: "sum",
        }),
        evaluationPeriods: 1,
        threshold: 2,
        comparisonOperator:
          cdk.aws_cloudwatch.ComparisonOperator
            .GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        actionsEnabled: true,
        alarmName:
          `${props.variables.projectPrefix}-resubscribe-alarm`.toUpperCase(),
        alarmDescription:
          "There have been 2 or more errors in the lambda for resubscribing users in the last 10 minutes",
      }
    );

    //this alarm is triggered if there has been more than 6 invocations in the last 10 minutes
    //just incase the lambda is recursively invoked too many times
    const resubscribeInfoAlarm = new cdk.aws_cloudwatch.Alarm(
      this,
      `${props.variables.projectPrefix}-resubscribe-info-alaram`,
      {
        metric: resubscribeLambda.metricInvocations({
          period: cdk.Duration.minutes(10),
          statistic: "sum",
        }),
        evaluationPeriods: 1,
        threshold: 6,
        comparisonOperator:
          cdk.aws_cloudwatch.ComparisonOperator
            .GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        actionsEnabled: true,
        alarmName:
          `${props.variables.projectPrefix}-resubscribe-info-alarm`.toUpperCase(),
        alarmDescription:
          "There have been 6 or more invocations in the lambda for resubscribing users in the last 10 minutes",
      }
    );

    resubscribeErrorAlarm.addAlarmAction(
      new cdk.aws_cloudwatch_actions.SnsAction(snsTopic)
    );

    resubscribeInfoAlarm.addAlarmAction(
      new cdk.aws_cloudwatch_actions.SnsAction(snsTopic)
    );

    //this alarm is triggered if the webhook lambda fails 1 time in 10 minutes
    const webHookErrorAlarm = new cdk.aws_cloudwatch.Alarm(
      this,
      `${props.variables.projectPrefix}-webhook-errors-alarm`,
      {
        metric: webHookLambda.metricErrors({
          period: cdk.Duration.minutes(10),
          statistic: "sum",
        }),
        threshold: 4,
        evaluationPeriods: 1,
        comparisonOperator:
          cdk.aws_cloudwatch.ComparisonOperator
            .GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        actionsEnabled: true,
        alarmName:
          `${props.variables.projectPrefix}-webhook-alarm`.toUpperCase(),
        alarmDescription:
          "There have been 4 or more errors in the lambda for handling webhooks in the last 10 minutes",
      }
    );

    webHookErrorAlarm.addAlarmAction(
      new cdk.aws_cloudwatch_actions.SnsAction(snsTopic)
    );

    const generatePresignedUrlAlarm = new cdk.aws_cloudwatch.Alarm(
      this,
      `${props.variables.projectPrefix}-generate-presigned-url-alarm`,
      {
        metric: generatePresignedUrlLambda.metricErrors({
          period: cdk.Duration.minutes(10),
          statistic: "sum",
        }),
        threshold: 4,
        evaluationPeriods: 1,
        comparisonOperator:
          cdk.aws_cloudwatch.ComparisonOperator
            .GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        actionsEnabled: true,
        alarmName:
          `${props.variables.projectPrefix}-generate-presigned-url-alarm`.toUpperCase(),
        alarmDescription:
          "There have been 4 or more errors in the lambda for generating presigned URLs in the last 10 minutes",
      }
    );

    generatePresignedUrlAlarm.addAlarmAction(
      new cdk.aws_cloudwatch_actions.SnsAction(snsTopic)
    );

    //this alarm is triggered if the trigger charge lambda fails 4 times in 10 minutes
    const triggerChargeErrorAlarm = new cdk.aws_cloudwatch.Alarm(
      this,
      `${props.variables.projectPrefix}-trigger-charge-errors-alarm`,
      {
        metric: triggerChargeLambda.metricErrors({
          period: cdk.Duration.minutes(10),
          statistic: "sum",
        }),
        threshold: 4,
        evaluationPeriods: 1,
        comparisonOperator:
          cdk.aws_cloudwatch.ComparisonOperator
            .GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        actionsEnabled: true,
        alarmName:
          `${props.variables.projectPrefix}-payments-alarm`.toUpperCase(),
        alarmDescription:
          "There have been 4 or more errors in the lambda for payments in the last 10 minutes",
      }
    );

    triggerChargeErrorAlarm.addAlarmAction(
      new cdk.aws_cloudwatch_actions.SnsAction(snsTopic)
    );

    //this alarm is triggered if there have been 5 failures in the lambda for getting processed results in the last 10 minutes
    const getProcessedResultsAlaram = new cdk.aws_cloudwatch.Alarm(
      this,
      `${props.variables.projectPrefix}-get-processed-results-alarm`,
      {
        metric: getProcessedImagesLambda.metricErrors({
          period: cdk.Duration.minutes(10),
          statistic: "sum",
        }),
        threshold: 5,
        evaluationPeriods: 1,
        comparisonOperator:
          cdk.aws_cloudwatch.ComparisonOperator
            .GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        actionsEnabled: true,
        alarmName:
          `${props.variables.projectPrefix}-get-processed-results-alarm`.toUpperCase(),
        alarmDescription:
          "There have been 5 or more errors in the lambda for getting processed results in the last 10 minutes",
      }
    );

    getProcessedResultsAlaram.addAlarmAction(
      new cdk.aws_cloudwatch_actions.SnsAction(snsTopic)
    );

    //this alarm is triggered if there have been 5 failures in the lambda for getting users projects in the last 10 minutes
    const getUsersApiKeysAlarm = new cdk.aws_cloudwatch.Alarm(
      this,
      `${props.variables.projectPrefix}-get-users-apikeys-alarm`,
      {
        metric: getUsersProjectsLambda.metricErrors({
          period: cdk.Duration.minutes(10),
          statistic: "sum",
        }),
        threshold: 5,
        evaluationPeriods: 1,
        comparisonOperator:
          cdk.aws_cloudwatch.ComparisonOperator
            .GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        actionsEnabled: true,
        alarmName:
          `${props.variables.projectPrefix}-get-users-apikeys-alarm`.toUpperCase(),
        alarmDescription:
          "There have been 5 or more errors in the lambda for getting users apikeys in the last 10 minutes",
      }
    );

    getUsersApiKeysAlarm.addAlarmAction(
      new cdk.aws_cloudwatch_actions.SnsAction(snsTopic)
    );

    //this alarm is triggered if there are messages in the downgrade subscription dead letter queue
    const downgradeSubscriptionDLQAlarm = new cdk.aws_cloudwatch.Alarm(
      this,
      `${props.variables.projectPrefix}-downgrade-subscription-dlq-alarm`,
      {
        metric:
          downgradeSubscriptionDLQ.metricApproximateNumberOfMessagesVisible({
            statistic: "sum",
          }),
        evaluationPeriods: 1,
        threshold: 2,
        comparisonOperator:
          cdk.aws_cloudwatch.ComparisonOperator
            .GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        actionsEnabled: true,
        alarmName:
          `${props.variables.projectPrefix}-downgrade-subscription-dlq-alarm`.toUpperCase(),
        alarmDescription: "There are messages in the dead letter queue",
      }
    );

    downgradeSubscriptionDLQAlarm.addAlarmAction(
      new cdk.aws_cloudwatch_actions.SnsAction(snsTopic)
    );

    //this alarm is triggered if there are messages in the resubscription dead letter queue
    const resubscriptionDLQAlarm = new cdk.aws_cloudwatch.Alarm(
      this,
      `${props.variables.projectPrefix}-resubscription-dlq-alarm`,
      {
        metric:
          resubscriptionDeadLetterQueue.metricApproximateNumberOfMessagesVisible(
            {
              statistic: "sum",
            }
          ),
        evaluationPeriods: 1,
        threshold: 2,
        comparisonOperator:
          cdk.aws_cloudwatch.ComparisonOperator
            .GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        actionsEnabled: true,
        alarmName:
          `${props.variables.projectPrefix}-resubscription-dlq-alarm`.toUpperCase(),
        alarmDescription:
          "There are messages in the resubscription dead letter queue",
      }
    );

    resubscriptionDLQAlarm.addAlarmAction(
      new cdk.aws_cloudwatch_actions.SnsAction(snsTopic)
    );

    const userAuthorizer = new TokenAuthorizer(
      this,
      `${props.variables.projectPrefix}-user-Authorizer`,
      {
        handler: userAuthorizerLambda,
        authorizerName: `${props.variables.projectPrefix}-rest-api-token-authorizer`,
        identitySource: "method.request.header.Authorization",
        resultsCacheTtl: cdk.Duration.minutes(0), ///clerk uses short lived tokens, so caching was affecting auth
      }
    );

    //create the rest api
    const rgbRestApi = new RestApi(
      this,
      `${props.variables.projectPrefix}-rest-api-sh`,
      {
        restApiName: `${props.variables.projectPrefix}-rest-api-sh`,
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
          stageName: props.variables.stage,
          description: `The ${props.variables.stage} api stage deployment for the rgb splitting`,
        },
      }
    );

    //create the usage plans
    const freeTierUsagePlan = new UsagePlan(
      this,
      `${props.variables.projectPrefix}-free-plan`,
      {
        name: `${props.variables.projectPrefix}-free-plan`,
        description: "Free tier usage plan, 200 Requests per month",
        apiStages: [{ stage: rgbRestApi.deploymentStage }],
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

    const proTierUsagePlan = new UsagePlan(
      this,
      `${props.variables.projectPrefix}-pro-plan`,
      {
        name: `${props.variables.projectPrefix}-pro-plan`,
        description: "Pro tier usage plan, 1000 Requests per month",
        apiStages: [{ stage: rgbRestApi.deploymentStage }],
        quota: {
          limit: 1000,
          period: Period.MONTH,
        },
        throttle: {
          rateLimit: 5,
          burstLimit: 50,
        },
      }
    );

    const executiveTierUsagePlan = new UsagePlan(
      this,
      `${props.variables.projectPrefix}-executive-plan`,
      {
        name: `${props.variables.projectPrefix}-executive-plan`,
        description: "Executive tier usage plan, 2500 Requests per month",
        apiStages: [{ stage: rgbRestApi.deploymentStage }],
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

    /**
     Usage plans are stored in AWS Secrets Manager to resolve circular dependency issues between the
     1. Usage plans
       2. Lambda functions
      3. REST API integration
     
    Instead of using the standard `grantRead` method, which would  also create a dependency cycle, i:
     1. created th usage plans & stored them in Secrets Manager
      2. Integrate APIs with Lambda functions
      3. Directly attach IAM policies to Lambda functions using the secret's name we passed into the usagePlanSecret construct, this way
      the lambda has access to fetch the usage plans from the secret manager
     
      This approach breaks the dependency cycle while maintaining proper access control.
     */
    const usagePlansSecret = new Secret(this, `${availablePlansSecretName}`, {
      secretName: `${availablePlansSecretName}`,
      secretObjectValue: {
        [PlanType.Free]: cdk.SecretValue.unsafePlainText(
          freeTierUsagePlan.usagePlanId
        ),
        [PlanType.Pro]: cdk.SecretValue.unsafePlainText(
          proTierUsagePlan.usagePlanId
        ),
        [PlanType.Executive]: cdk.SecretValue.unsafePlainText(
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

    //route to fetch  the projects a user has created
    const getUsersProjectsRoute = v1Root.addResource("projects");

    //route to request payments
    const triggerChargeRoute = v1Root.addResource("trigger-payment");

    //route for getting project info
    const projectInfoRoute = v1Root.addResource("{projectId}");

    //route to update project name
    const updateProjectNameRoute = projectInfoRoute.addResource("update");

    //route to delete a project
    const deleteProjectRoute = projectInfoRoute.addResource("delete");

    //route to cancel a projects subscription
    const cancelSubscriptionRoute = projectInfoRoute.addResource("cancel");

    //route to get processed results -- USERS APPLICATION
    const getProcessedImagesRoute = projectInfoRoute
      .addResource(processedImagesRouteVar)
      .addResource("{imageId}");

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

    getUsersProjectsRoute.addMethod(
      HttpMethod.GET,
      new LambdaIntegration(getUsersProjectsLambda),
      {
        authorizer: userAuthorizer,
        authorizationType: AuthorizationType.CUSTOM,
      }
    );

    triggerChargeRoute.addMethod(
      HttpMethod.POST,
      new LambdaIntegration(triggerChargeLambda)
    );

    projectInfoRoute.addMethod(
      HttpMethod.GET,
      new LambdaIntegration(getProjectInfoLambda),
      {
        authorizer: userAuthorizer,
        authorizationType: AuthorizationType.CUSTOM,
      }
    );

    updateProjectNameRoute.addMethod(
      HttpMethod.PATCH,
      new LambdaIntegration(updateProjectNameLambda),
      {
        authorizer: userAuthorizer,
        authorizationType: AuthorizationType.CUSTOM,
      }
    );

    deleteProjectRoute.addMethod(
      HttpMethod.DELETE,
      new LambdaIntegration(deleteProjectLambda),
      {
        authorizer: userAuthorizer,
        authorizationType: AuthorizationType.CUSTOM,
      }
    );

    getProcessedImagesRoute.addMethod(
      HttpMethod.GET,
      new LambdaIntegration(getProcessedImagesLambda),
      { apiKeyRequired: true }
    );

    cancelSubscriptionRoute.addMethod(
      HttpMethod.PATCH,
      new LambdaIntegration(cancelSubscriptionLambda),
      {
        authorizer: userAuthorizer,
        authorizationType: AuthorizationType.CUSTOM,
      }
    );

    //grant the webhook Lambda permission to create new ApiKeys & fetch all our available keys
    //grant it permission to modify our usage plans
    webHookLambda.addToRolePolicy(
      new PolicyStatement({
        actions: [
          "apigateway:GET",
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
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${availablePlansSecretName}*`,
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${props.variables.webhookSecretName}*`,
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${props.variables.paymentSecretName}*`,
        ],
      })
    );

    triggerChargeLambda.addToRolePolicy(
      new PolicyStatement({
        actions: [
          "apigateway:GET",
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
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${availablePlansSecretName}*`,
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${props.variables.paymentSecretName}*`,
        ],
      })
    );

    userAuthorizerLambda.addToRolePolicy(
      new PolicyStatement({
        actions: ["secretsmanager:GetSecretValue"],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${props.variables.clerkJwtSecretName}*`,
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
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${availablePlansSecretName}*`, // i did this to prevent circular dependency issue
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${props.variables.paymentSecretName}*`,
        ],
      })
    );

    downgradeSubscriptionLambda.addToRolePolicy(
      new PolicyStatement({
        actions: [
          "apigateway:GET",
          "apigateway:POST",
          "apigateway:PATCH",
          "apigateway:DELETE",
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

    cancelSubscriptionLambda.addToRolePolicy(
      new PolicyStatement({
        actions: [
          "apigateway:POST",
          "apigateway:PATCH",
          "apigateway:DELETE",
          "apigateway:GET",
        ],
        resources: [
          `arn:aws:apigateway:${this.region}::/apikeys`,
          `arn:aws:apigateway:${this.region}::/apikeys/*`,
          `arn:aws:apigateway:${this.region}::/usageplans`, //i did this to prevent circular dependency issues between lambda, the rest api & the usage plans
          `arn:aws:apigateway:${this.region}::/usageplans/*/keys`,
          `arn:aws:apigateway:${this.region}::/usageplans/*/keys/*`,
        ],
      })
    );

    deleteProjectLambda.addToRolePolicy(
      new PolicyStatement({
        actions: ["apigateway:DELETE"],
        resources: [
          `arn:aws:apigateway:${this.region}::/apikeys`,
          `arn:aws:apigateway:${this.region}::/apikeys/*`,
          `arn:aws:apigateway:${this.region}::/usageplans`, //i did this to prevent circular dependency issues between lambda, the rest api & the usage plans
          `arn:aws:apigateway:${this.region}::/usageplans/*/keys`,
          `arn:aws:apigateway:${this.region}::/usageplans/*/keys/*`,
        ],
      })
    );

    const eventBridgeRole = new Role(
      this,
      `${props.variables.projectPrefix}-resubscribe-event-role`,
      {
        roleName: `${props.variables.projectPrefix}-resubscribe-event-role`,
        description:
          "This role allows eventbridge to trigger our resubscription lambda",
        assumedBy: new ServicePrincipal("scheduler.amazonaws.com"),
      }
    );

    //allow eventbridge to trigger lambda function
    eventBridgeRole.addToPolicy(
      new PolicyStatement({
        actions: ["lambda:InvokeFunction"],
        resources: [resubscribeLambda.functionArn],
      })
    );

    // //this event bridge rule is used to cancel all expired subscriptions
    // //calls the cancel lambda every week
    // const eventBridgeTask = new EventBridgeSchedulerCreateScheduleTask(
    //   this,
    //   `${props.variables.projectPrefix}-resubscribe-eventbridge-task`,
    //   {
    //     scheduleName: `${props.variables.projectPrefix}-resubscribe-eventbridge-task`,
    //     schedule: Schedule.rate(cdk.Duration.minutes(3)),
    //     startDate: new Date(),
    //     description:
    //       "This rule runs every week to resubscribe all users whose subscribtions have expired to their plan",
    //     flexibleTimeWindow: cdk.Duration.minutes(7),
    //     target: new EventBridgeSchedulerTarget({
    //       arn: resubscribeLambda.functionArn,
    //       role: eventBridgeRole,
    //       retryPolicy: {
    //         maximumRetryAttempts: 4,
    //         maximumEventAge: cdk.Duration.days(1),
    //       },
    //     }),
    //   }
    // );

    //for some reason, the eventbridge construct never created my scheduke but this works tho
    new cdk.CfnResource(
      this,
      `${props.variables.projectPrefix}-resubscribe-eventbridge-task`,
      {
        type: "AWS::Scheduler::Schedule",
        properties: {
          Name: `${props.variables.projectPrefix}-resubscribe-eventbridge-task`,
          Description:
            "This rule runs every week to resubscribe all users whose subscriptions have expired to their plan",
          ScheduleExpression: "rate(7 days)",
          State: "ENABLED",
          FlexibleTimeWindow: {
            Mode: "FLEXIBLE",
            MaximumWindowInMinutes: 7,
          },
          Target: {
            Arn: resubscribeLambda.functionArn,
            RoleArn: eventBridgeRole.roleArn,
            RetryPolicy: {
              MaximumEventAgeInSeconds: 86400,
              MaximumRetryAttempts: 4,
            },
          },
        },
      }
    );

    downgradeSubscriptionQueue.grantSendMessages(resubscribeLambda);
    downgradeSubscriptionQueue.grantConsumeMessages(
      downgradeSubscriptionLambda
    );

    resubscribeSubscriptionQueue.grantSendMessages(resubscribeLambda);
    resubscribeSubscriptionQueue.grantConsumeMessages(resubscribeLambda);

    s3Bucket.grantPut(splittingLambda);
    s3Bucket.grantRead(splittingLambda);

    s3Bucket.grantPut(generatePresignedUrlLambda);

    //trigger the splitting lambda when there is a new object added to the s3 bucket
    s3Bucket.addEventNotification(
      EventType.OBJECT_CREATED_POST,
      new LambdaDestination(splittingLambda)
    );

    projectsTable.grantReadWriteData(webHookLambda);
    projectsTable.grantReadWriteData(resubscribeLambda);
    projectsTable.grantReadWriteData(triggerChargeLambda);
    projectsTable.grantReadData(generatePresignedUrlLambda);
    projectsTable.grantReadWriteData(cancelSubscriptionLambda);

    projectsTable.grantWriteData(splittingLambda);
    projectsTable.grantWriteData(updateProjectNameLambda);

    projectsTable.grantReadData(getProjectInfoLambda);
    projectsTable.grantReadData(getUsersProjectsLambda);
    projectsTable.grantReadWriteData(deleteProjectLambda);

    projectsTable.grantReadWriteData(downgradeSubscriptionLambda);

    processedImagesTable.grantWriteData(splittingLambda);
    processedImagesTable.grantReadData(getProjectInfoLambda);
    processedImagesTable.grantReadData(getProcessedImagesLambda);
  }
}
