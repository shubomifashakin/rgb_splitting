import { Construct } from "constructs";

import * as cdk from "aws-cdk-lib";
import { CorsHttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { Cors, Period, RestApi, UsagePlan } from "aws-cdk-lib/aws-apigateway";
import * as dotenv from "dotenv";

dotenv.config();

const region = process.env.REGION;

export class RgbApiStack extends cdk.Stack {
  public readonly freeTierUsagePlanId: string;
  public readonly proTierUsagePlanId: string;
  public readonly executiveTierUsagePlanId: string;
  public readonly RgbRestApiId: string;
  public readonly RgbRestApiRootResourceId: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, {
      ...props,
      env: {
        region,
      },
    });

    //create the rest api
    const restApi = new RestApi(this, "rgb-splitting-rest-api-sh", {
      restApiName: "rgb-splitting-rest-api-sh",
      description: "the base rest api for the rgb splitting",
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
        allowMethods: [CorsHttpMethod.ANY],
      },
    });

    //create the usage plans
    const freeTierUsagePlan = new UsagePlan(this, "rgb-splitting-free-plan", {
      name: "rgb-splitting-free-plan",
      description: "Free tier usage plan, 200 Requests per month",
      apiStages: [{ stage: restApi.deploymentStage }],
      quota: {
        limit: 200,
        period: Period.MONTH,
      },
      throttle: {
        rateLimit: 1,
        burstLimit: 5,
      },
    });

    const proTierUsagePlan = new UsagePlan(this, "rgb-splitting-pro-plan", {
      name: "rgb-splitting-pro-plan",
      description: "Pro tier usage plan, 1000 Requests per month",
      apiStages: [{ stage: restApi.deploymentStage }],
      quota: {
        limit: 1000,
        period: Period.MONTH,
      },
      throttle: {
        rateLimit: 5,
        burstLimit: 50,
      },
    });

    const executiveUsagePlan = new UsagePlan(
      this,
      "rgb-splitting-executive-plan",
      {
        name: "rgb-splitting-executive-plan",
        description: "Executive tier usage plan, 2500 Requests per month",
        apiStages: [{ stage: restApi.deploymentStage }],
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

    this.freeTierUsagePlanId = freeTierUsagePlan.usagePlanId;
    this.proTierUsagePlanId = proTierUsagePlan.usagePlanId;
    this.executiveTierUsagePlanId = executiveUsagePlan.usagePlanId;
    this.RgbRestApiId = restApi.restApiId;
    this.RgbRestApiRootResourceId = restApi.restApiRootResourceId;

    new cdk.CfnOutput(this, "FreeTierUsagePlanOutput", {
      value: this.freeTierUsagePlanId,
      exportName: "FreeTierUsagePlanId",
    });

    new cdk.CfnOutput(this, "ProTierUsagePlanOutput", {
      value: this.proTierUsagePlanId,
      exportName: "ProTierUsagePlanId",
    });

    new cdk.CfnOutput(this, "ExecutiveTierUsagePlanOutput", {
      value: this.executiveTierUsagePlanId,
      exportName: "ExecutiveTierUsagePlanId",
    });

    new cdk.CfnOutput(this, "RgbRestApiId", {
      value: restApi.restApiId,
      exportName: "RgbRestApiId",
    });

    new cdk.CfnOutput(this, "RgbRestApiRootResourceId", {
      value: this.RgbRestApiRootResourceId,
      exportName: "RgbRestApiRootResourceId",
    });
  }
}
