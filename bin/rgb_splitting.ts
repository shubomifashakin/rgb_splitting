#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { RgbSplittingStack } from "../lib/rgb_splitting-stack";
import { RgbApiStack } from "../lib/RgbApiStack";

const app = new cdk.App();

const rgbApiStack = new RgbApiStack(app, "RgbApiStack", {});

new RgbSplittingStack(app, "RgbSplittingStack", {
  RGBApiStack: rgbApiStack,
});
