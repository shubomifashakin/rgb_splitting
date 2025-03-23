#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";

import * as dotenv from "dotenv";

import { RgbSplittingStack } from "../lib/rgb_splitting-stack";

dotenv.config();

const app = new cdk.App();

const projectPrefix = "rgb-splitting";

const rgbDevStack = new RgbSplittingStack(app, "RgbSplitting-DEV-Stack", {
  variables: {
    projectPrefix: `${projectPrefix}-DEV`,
    paymentGatewayUrl: process.env.DEV_PAYMENT_GATEWAY_URL!,
    paymentSecretName: process.env.DEV_PAYMENT_SECRET_NAME!,
    webhookSecretName: process.env.DEV_WEBHOOK_SECRET_NAME!,
    clerkJwtSecretName: process.env.DEV_CLERK_JWT_SECRET_NAME!,
    alarmSubscriptionEmail: process.env.DEV_SUBSCRIPTION_EMAIL!,
    stage: "dev",
  },
  stackName: "RgbSplitting-DEV-Stack",
  env: {
    region: process.env.REGION!,
  },
});
