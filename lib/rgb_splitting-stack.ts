import { Construct } from "constructs";

import * as cdk from "aws-cdk-lib";
import { LayerVersion, RecursiveLoop, Runtime } from "aws-cdk-lib/aws-lambda";
import {
  BlockPublicAccess,
  Bucket,
  EventType,
  HttpMethods,
} from "aws-cdk-lib/aws-s3";
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
import { HttpMethod } from "aws-cdk-lib/aws-events";
import { LambdaDestination } from "aws-cdk-lib/aws-s3-notifications";
import { PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";

import * as dotenv from "dotenv";
import * as rds from "aws-cdk-lib/aws-rds";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";

import { imageRouteVar, PlanType } from "../helpers/constants";
import {
  InstanceClass,
  InstanceSize,
  InstanceType,
  Port,
  SecurityGroup,
  SubnetType,
  Vpc,
} from "aws-cdk-lib/aws-ec2";
import {
  BuildSpec,
  ComputeType,
  FilterGroup,
  LinuxLambdaBuildImage,
  Project,
  Source,
} from "aws-cdk-lib/aws-codebuild";

dotenv.config();

const projectPrefix = "rgb-splitting";

const region = process.env.REGION!;
const paymentGatewayUrl = process.env.PAYMENT_GATEWAY_URL!;
const alarmSubscriptionEmail = process.env.SUBSCRIPTION_EMAIL!;

const paymentSecretName = process.env.PAYMENT_SECRET_NAME!;
const webhookSecretName = process.env.WEBHOOK_SECRET_NAME!;
const clerkJwtSecretName = process.env.CLERK_JWT_SECRET_NAME!;
const maxPlanSizesSecretName = process.env.MAX_PLAN_SIZES_SECRET_NAME!;

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
      cors: [
        {
          allowedHeaders: ["*"],
          allowedMethods: [HttpMethods.POST, HttpMethods.GET, HttpMethods.PUT],
          allowedOrigins: Cors.ALL_ORIGINS,
          exposedHeaders: ["ETAG"],
        },
      ],
    });

    const dbName = `rgbSplitttingDb`;
    //this generates the secret for the database
    const newRdsDbSecret = new rds.DatabaseSecret(
      this,
      `${projectPrefix}-rds-secret`,
      {
        username: "postgres",
        dbname: dbName, //db name can only be alphanumeric
        secretName: `${projectPrefix}-rds-db-secret`,
      }
    );

    //the vpc the database belongs to
    const rdsVpc = new Vpc(this, `${projectPrefix}-rds-vpc`, {
      maxAzs: 2,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "public-subnet",
          subnetType: SubnetType.PUBLIC,
        },

        {
          cidrMask: 24,
          name: "database-subnet",
          subnetType: SubnetType.PRIVATE_ISOLATED,
        },
        {
          cidrMask: 24,
          name: "lambda-subnet",
          //allow resources in this subnet to access the internet
          subnetType: SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
      vpcName: `${projectPrefix}-rds-vpc`,
    });

    //define the firewall of the db
    const dbSecurityGroup = new SecurityGroup(this, "RdsSecurityGroup", {
      vpc: rdsVpc,
      allowAllOutbound: true,
      description: "Allow only Lambda to access RDS",
    });

    const lambdaSecurityGroup = new SecurityGroup(this, "LambdaSecurityGroup", {
      vpc: rdsVpc,
      allowAllOutbound: true,
      description: "Allow Lambda to access RDS",
    });

    const codeBuildSecurityGroup = new SecurityGroup(
      this,
      "CodeBuildSecurityGroup",
      {
        vpc: rdsVpc,
        allowAllOutbound: true,
        description: "Allow CodeBuild to access RDS",
      }
    );

    //allow lambda to access rds
    dbSecurityGroup.addIngressRule(
      lambdaSecurityGroup,
      Port.tcp(5432),
      "Allow RDS access"
    );

    //allow codebuild to access rds
    dbSecurityGroup.addIngressRule(
      codeBuildSecurityGroup,
      Port.tcp(5432),
      "Allow CodeBuild to access RDS"
    );

    const dbInstance = new rds.DatabaseInstance(
      this,
      `${projectPrefix}-rds-db`,
      {
        allocatedStorage: 20,
        maxAllocatedStorage: 25,
        enablePerformanceInsights: false,
        storageType: rds.StorageType.GP2,
        databaseName: dbName,
        vpc: rdsVpc,
        vpcSubnets: {
          subnetType: SubnetType.PRIVATE_ISOLATED,
        },
        securityGroups: [dbSecurityGroup],
        removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
        engine: rds.DatabaseInstanceEngine.POSTGRES,
        credentials: rds.Credentials.fromSecret(newRdsDbSecret),
        // performanceInsightRetention: rds.PerformanceInsightRetention.DEFAULT,
        instanceType: InstanceType.of(
          InstanceClass.T4G, //was using production instance b4, changed to free tier cus i got billed😭
          InstanceSize.MICRO
        ),
      }
    );

    //i only use this to handle my prisma migrations
    const codeBuildProject = new Project(
      this,
      `${projectPrefix}-rds-code-build`,
      {
        vpc: rdsVpc,
        subnetSelection: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
        securityGroups: [codeBuildSecurityGroup],
        source: Source.gitHub({
          owner: "shubomifashakin", //me
          repo: "rgb_splitting", //the repository
          branchOrRef: "rds_migration", //the branch this runs for
          webhook: true,
          webhookFilters: [
            //trigger the build whenever the branch is updated
            FilterGroup.inEventOf(
              cdk.aws_codebuild.EventAction.PUSH
            ).andBranchIs("rds_migration"),
          ],
        }),
        environment: {
          computeType: ComputeType.SMALL,
        },

        buildSpec: BuildSpec.fromAsset("./buildspec.yml"),
        projectName: `${projectPrefix}-rds-code-build`,
        description:
          "The essence of this code build is just to run our prisma migrations",
        timeout: cdk.Duration.minutes(6),
        queuedTimeout: cdk.Duration.minutes(6),
      }
    );

    // const projectsTable = new Table(this, `${projectPrefix}-table-sh`, {
    //   tableName: `${projectPrefix}-table-sh`,
    //   partitionKey: {
    //     name: "id",
    //     type: AttributeType.STRING,
    //   },
    //   sortKey: {
    //     name: "userId",
    //     type: AttributeType.STRING,
    //   },
    //   pointInTimeRecoverySpecification: {
    //     pointInTimeRecoveryEnabled: true,
    //   },
    //   removalPolicy: cdk.RemovalPolicy.DESTROY,
    // });

    // projectsTable.addGlobalSecondaryIndex({
    //   indexName: "expiredSubscriptionIndex",
    //   partitionKey: {
    //     name: "sub_status",
    //     type: AttributeType.STRING,
    //   },

    //   sortKey: {
    //     name: "nextPaymentDate",
    //     type: AttributeType.NUMBER,
    //   },
    // });

    // projectsTable.addGlobalSecondaryIndex({
    //   indexName: "userIdIndex",
    //   partitionKey: {
    //     name: "userId",
    //     type: AttributeType.STRING,
    //   },
    // });

    // projectsTable.addGlobalSecondaryIndex({
    //   indexName: "apiKeyIndex",
    //   partitionKey: {
    //     name: "apiKey",
    //     type: AttributeType.STRING,
    //   },
    // });

    //this queue is used to store messages that failed to be downgraded
    const cancelSubscriptionDeadLetterQueue = new Queue(
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
        visibilityTimeout: cdk.Duration.minutes(1.2),
        deadLetterQueue: {
          maxReceiveCount: 2,
          queue: cancelSubscriptionDeadLetterQueue,
        },
        deliveryDelay: cdk.Duration.seconds(20),
        receiveMessageWaitTime: cdk.Duration.seconds(20),
      }
    );

    const resubscriptionDeadLetterQueue = new Queue(
      this,
      `${projectPrefix}-resubscription-dlq`,
      {
        queueName: `${projectPrefix}-resubscription-dlq`,
        retentionPeriod: cdk.Duration.days(14),
      }
    );

    const resubscribeSubscriptionQueue = new Queue(
      this,
      `${projectPrefix}-resubscribe-subscription-queue`,
      {
        queueName: `${projectPrefix}-resubscribe-subscription-queue`,
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
          DB_SECRET_ARN: newRdsDbSecret.secretArn,
          DB_PORT: dbInstance.dbInstanceEndpointPort,
          DB_HOST: dbInstance.dbInstanceEndpointAddress,
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
        vpc: rdsVpc,
        securityGroups: [lambdaSecurityGroup],
        vpcSubnets: {
          subnetType: SubnetType.PRIVATE_WITH_EGRESS,
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
          REGION: this.region,
          BUCKET_NAME: s3Bucket.bucketName,
          MAX_PLAN_SIZES_SECRET_NAME: maxPlanSizesSecretName,
          DB_SECRET_ARN: newRdsDbSecret.secretArn,
          DB_PORT: dbInstance.dbInstanceEndpointPort,
          DB_HOST: dbInstance.dbInstanceEndpointAddress,
        },
        entry: "./resources/generate-presigned-url.ts",
        handler: "handler",
        vpc: rdsVpc,
        securityGroups: [lambdaSecurityGroup],
        vpcSubnets: {
          subnetType: SubnetType.PRIVATE_WITH_EGRESS,
        },
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
          PAYMENT_SECRET_NAME: paymentSecretName,
          WEBHOOK_SECRET_NAME: webhookSecretName,
          PAYMENT_GATEWAY_URL: paymentGatewayUrl,
          DB_SECRET_ARN: newRdsDbSecret.secretArn,
          DB_PORT: dbInstance.dbInstanceEndpointPort,
          DB_HOST: dbInstance.dbInstanceEndpointAddress,
        },
        timeout: cdk.Duration.seconds(20),
        vpc: rdsVpc,
        securityGroups: [lambdaSecurityGroup],
        vpcSubnets: {
          subnetType: SubnetType.PRIVATE_WITH_EGRESS,
        },
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
          DB_SECRET_ARN: newRdsDbSecret.secretArn,
          DB_PORT: dbInstance.dbInstanceEndpointPort,
          DB_HOST: dbInstance.dbInstanceEndpointAddress,
        },
        timeout: cdk.Duration.seconds(10),
        vpc: rdsVpc,
        securityGroups: [lambdaSecurityGroup],
        vpcSubnets: {
          subnetType: SubnetType.PRIVATE_WITH_EGRESS,
        },
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
        timeout: cdk.Duration.seconds(10),
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
          PAYMENT_GATEWAY_URL: paymentGatewayUrl,
          PAYMENT_SECRET_NAME: paymentSecretName,
          AVAILABLE_PLANS_SECRET_NAME: availablePlansSecretName,
          RESUBSCRIBE_QUEUE_URL: resubscribeSubscriptionQueue.queueUrl,
          CANCEL_SUBSCRIPTION_QUEUE_URL: cancelSubscriptionQueue.queueUrl,
          DB_SECRET_ARN: newRdsDbSecret.secretArn,
          DB_PORT: dbInstance.dbInstanceEndpointPort,
          DB_HOST: dbInstance.dbInstanceEndpointAddress,
        },
        timeout: cdk.Duration.minutes(2),
        recursiveLoop: RecursiveLoop.ALLOW, // got an email from aws thar my function was terminated, so i added this, the resubscribe lambda uses a recursive design
        vpc: rdsVpc,
        securityGroups: [lambdaSecurityGroup],
        vpcSubnets: {
          subnetType: SubnetType.PRIVATE_WITH_EGRESS,
        },
      }
    );

    const cancelSubscriptionLambda = new NodejsFunction(
      this,
      `${projectPrefix}-cancel-subscription-queue-lambda`,
      {
        functionName: `${projectPrefix}-cancel-subscription-queue-lambda`,
        description:
          "This lambda is used to cancel subscriptions that have failed to resubscribe. It receives messages from the sqs queue",
        runtime: Runtime.NODEJS_22_X,
        entry: "./resources/cancel-subscription-queue-handler.ts",
        handler: "handler",
        environment: {
          REGION: this.region,
          AVAILABLE_PLANS_SECRET_NAME: availablePlansSecretName,
          DB_PORT: dbInstance.dbInstanceEndpointPort,
          DB_HOST: dbInstance.dbInstanceEndpointAddress,
          DB_SECRET_ARN: newRdsDbSecret.secretArn,
        },
        timeout: cdk.Duration.seconds(45),
        vpc: rdsVpc,
        securityGroups: [lambdaSecurityGroup],
        vpcSubnets: {
          subnetType: SubnetType.PRIVATE_WITH_EGRESS,
        },
      }
    );

    const getProcessedImagesLambda = new NodejsFunction(
      this,
      `${projectPrefix}-get-processed-images-lambda`,
      {
        functionName: `${projectPrefix}-get-processed-images-lambda`,
        description:
          "This lambda is used to get processed images for an image that was uploaded.",
        runtime: Runtime.NODEJS_22_X,
        entry: "./resources/get-processed-images.ts",
        handler: "handler",
        environment: {
          REGION: this.region,
          DB_SECRET_ARN: newRdsDbSecret.secretArn,
          DB_PORT: dbInstance.dbInstanceEndpointPort,
          DB_HOST: dbInstance.dbInstanceEndpointAddress,
        },
        timeout: cdk.Duration.seconds(15),
        vpc: rdsVpc,
        securityGroups: [lambdaSecurityGroup],
        vpcSubnets: {
          subnetType: SubnetType.PRIVATE_WITH_EGRESS,
        },
      }
    );

    resubscribeLambda.addEventSource(
      new SqsEventSource(resubscribeSubscriptionQueue, { batchSize: 10 })
    );

    cancelSubscriptionLambda.addEventSource(
      new SqsEventSource(cancelSubscriptionQueue, {
        batchSize: 10,
        reportBatchItemFailures: true,
      })
    );

    const snsTopic = new cdk.aws_sns.Topic(this, `${projectPrefix}-sns-topic`, {
      topicName: `${projectPrefix}-sns-topic`,
      displayName: `${projectPrefix}-ERROR`,
    });

    snsTopic.addSubscription(
      new cdk.aws_sns_subscriptions.EmailSubscription(alarmSubscriptionEmail)
    );

    //this alarm is triggered if the resubscribe lambda fails 2 times in 10 minutes
    const resubscribeErrorAlarm = new cdk.aws_cloudwatch.Alarm(
      this,
      `${projectPrefix}-resubscribe-errors-alarm`,
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
        alarmName: `${projectPrefix}-resubscribe-alarm`.toUpperCase(),
        alarmDescription:
          "There have been 2 or more errors in the lambda for resubscribing users in the last 10 minutes",
      }
    );

    //this alarm is triggered if the webhook lambda fails 1 time in 10 minutes
    const webHookErrorAlarm = new cdk.aws_cloudwatch.Alarm(
      this,
      `${projectPrefix}-webhook-errors-alarm`,
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
        alarmName: `${projectPrefix}-webhook-alarm`.toUpperCase(),
        alarmDescription:
          "There have been 4 or more errors in the lambda for handling webhooks in the last 10 minutes",
      }
    );

    const generatePresignedUrlAlarm = new cdk.aws_cloudwatch.Alarm(
      this,
      `${projectPrefix}-generate-presigned-url-alarm`,
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
          `${projectPrefix}-generate-presigned-url-alarm`.toUpperCase(),
        alarmDescription:
          "There have been 4 or more errors in the lambda for generating presigned URLs in the last 10 minutes",
      }
    );

    //this alarm is triggered if there are messages in the cancel subscription dead letter queue
    const cancelSubscriptionDLQAlarm = new cdk.aws_cloudwatch.Alarm(
      this,
      `${projectPrefix}-cancel-subscription-dlq-alarm`,
      {
        metric:
          cancelSubscriptionDeadLetterQueue.metricApproximateNumberOfMessagesVisible(
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
          `${projectPrefix}-cancel-subscription-dlq-alarm`.toUpperCase(),
        alarmDescription: "There are messages in the dead letter queue",
      }
    );

    //this alarm is triggered if there are messages in the resubscription dead letter queue
    const resubscriptionDLQAlarm = new cdk.aws_cloudwatch.Alarm(
      this,
      `${projectPrefix}-resubscription-dlq-alarm`,
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
        alarmName: `${projectPrefix}-resubscription-dlq-alarm`.toUpperCase(),
        alarmDescription:
          "There are messages in the resubscription dead letter queue",
      }
    );

    resubscribeErrorAlarm.addAlarmAction(
      new cdk.aws_cloudwatch_actions.SnsAction(snsTopic)
    );

    webHookErrorAlarm.addAlarmAction(
      new cdk.aws_cloudwatch_actions.SnsAction(snsTopic)
    );

    generatePresignedUrlAlarm.addAlarmAction(
      new cdk.aws_cloudwatch_actions.SnsAction(snsTopic)
    );

    cancelSubscriptionDLQAlarm.addAlarmAction(
      new cdk.aws_cloudwatch_actions.SnsAction(snsTopic)
    );

    resubscriptionDLQAlarm.addAlarmAction(
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

    // const prodStage = new Stage(this, `${projectPrefix}-prod-stage`, {
    //   stageName: "prod",
    //   deployment: new Deployment(this, `${projectPrefix}-api-prod-deployment`, {
    //     api: rgbRestApi,
    //     description: "The prod api stage deployment for the rgb splitting",
    //   }),
    //   description: "The prod api stage for the rgb splitting",
    // });

    //create the usage plans
    const freeTierUsagePlan = new UsagePlan(
      this,
      `${projectPrefix}-free-plan`,
      {
        name: `${projectPrefix}-free-plan`,
        description: "Free tier usage plan, 200 Requests per month",
        apiStages: [{ stage: rgbRestApi.deploymentStage }],
        quota: {
          limit: 70,
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
      apiStages: [{ stage: rgbRestApi.deploymentStage }],
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

    //this stores the maximum image sizes each plan can upload
    const maxPlanSizesSecret = new Secret(this, `${maxPlanSizesSecretName}`, {
      secretName: `${maxPlanSizesSecretName}`,
      secretObjectValue: {
        [PlanType.Free]: cdk.SecretValue.unsafePlainText(
          String(10 * 1024 * 1024)
        ),
        [PlanType.Pro]: cdk.SecretValue.unsafePlainText(
          String(20 * 1024 * 1024)
        ),
        [PlanType.Executive]: cdk.SecretValue.unsafePlainText(
          String(80 * 1024 * 1024)
        ),
      },
      description: "this is used to store the max plan sizes",
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

    //route to get processed images
    const baseProcessedImagesRoute = v1Root.addResource("results");
    const baseProcessedImagesProjectIdRouter =
      baseProcessedImagesRoute.addResource("{projectId}");

    const imageRoute =
      baseProcessedImagesProjectIdRouter.addResource(imageRouteVar);
    const getProcessedImagesRoute = imageRoute.addResource("{imageId}");

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

    getProcessedImagesRoute.addMethod(
      HttpMethod.GET,
      new LambdaIntegration(getProcessedImagesLambda),
      { apiKeyRequired: true }
    );

    //construct the prod stage ARN
    // const prodStageArn = `arn:aws:execute-api:${cdk.Stack.of(this).region}:${
    //   cdk.Stack.of(this).account
    // }:${rgbRestApi.restApiId}/prod`;

    // //alow the prod stage invoke our lambdas
    // generatePresignedUrlLambda.addPermission(
    //   `${projectPrefix}-allow-prod-stage-permission`,
    //   {
    //     principal: new ServicePrincipal("apigateway.amazonaws.com"),
    //     sourceArn: `${prodStageArn}/POST/v1/process`,
    //   }
    // );

    // webHookLambda.addPermission(
    //   `${projectPrefix}-allow-prod-stage-permission`,
    //   {
    //     principal: new ServicePrincipal("apigateway.amazonaws.com"),
    //     sourceArn: `${prodStageArn}/POST/v1/webhook`,
    //   }
    // );

    // getUsersApiKeysLambda.addPermission(
    //   `${projectPrefix}-allow-prod-stage-permission`,
    //   {
    //     principal: new ServicePrincipal("apigateway.amazonaws.com"),
    //     sourceArn: `${prodStageArn}/GET/v1/keys`,
    //   }
    // );

    // triggerChargeLambda.addPermission(
    //   `${projectPrefix}-allow-prod-stage-permission`,
    //   {
    //     principal: new ServicePrincipal("apigateway.amazonaws.com"),
    //     sourceArn: `${prodStageArn}/POST/v1/trigger-payment`,
    //   }
    // );

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
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${clerkJwtSecretName}*`,
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

    const eventBridgeRole = new Role(
      this,
      `${projectPrefix}-resubscribe-event-role`,
      {
        roleName: `${projectPrefix}-resubscribe-event-role`,
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
    //   `${projectPrefix}-resubscribe-eventbridge-task`,
    //   {
    //     scheduleName: `${projectPrefix}-resubscribe-eventbridge-task`,
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
    new cdk.CfnResource(this, `${projectPrefix}-resubscribe-eventbridge-task`, {
      type: "AWS::Scheduler::Schedule",
      properties: {
        Name: `${projectPrefix}-resubscribe-eventbridge-task`,
        Description:
          "This rule runs every week to resubscribe all users whose subscriptions have expired to their plan",
        ScheduleExpression: "rate(7 days)", //TODO: SHOULD BE 7 DAYS
        State: "ENABLED",
        FlexibleTimeWindow: {
          Mode: "FLEXIBLE",
          MaximumWindowInMinutes: 10,
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
    });

    codeBuildProject.addToRolePolicy(
      new PolicyStatement({
        actions: ["secretsmanager:GetSecretValue"],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${
            this.account
          }:secret:${"RGB_RDS_DATABASE_URL"}*`,
        ],
      })
    );

    //give codebuild permission to use connections
    codeBuildProject.addToRolePolicy(
      new PolicyStatement({
        actions: [
          "codeConnections:UseConnection",
          "codeConnections:GetConnections",
          "codebuild:ImportSourceCredentials",
        ],
        resources: ["*"],
      })
    );

    maxPlanSizesSecret.grantRead(generatePresignedUrlLambda);

    cancelSubscriptionQueue.grantSendMessages(resubscribeLambda);
    cancelSubscriptionQueue.grantConsumeMessages(cancelSubscriptionLambda);

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

    //grant the lambdas permissions to read from the database secrets
    newRdsDbSecret.grantRead(webHookLambda);
    newRdsDbSecret.grantRead(splittingLambda);
    newRdsDbSecret.grantRead(resubscribeLambda);
    newRdsDbSecret.grantRead(getUsersApiKeysLambda);
    newRdsDbSecret.grantRead(cancelSubscriptionLambda);
    newRdsDbSecret.grantRead(getProcessedImagesLambda);
    newRdsDbSecret.grantRead(generatePresignedUrlLambda);

    // projectsTable.grantReadWriteData(webHookLambda);
    // projectsTable.grantReadWriteData(resubscribeLambda);
    // projectsTable.grantReadData(generatePresignedUrlLambda);

    // projectsTable.grantWriteData(splittingLambda);

    // projectsTable.grantReadData(getUsersApiKeysLambda);

    // projectsTable.grantReadWriteData(cancelSubscriptionLambda);
  }
}
