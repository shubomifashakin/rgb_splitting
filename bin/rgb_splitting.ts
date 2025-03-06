#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { RgbSplittingStack } from "../lib/rgb_splitting-stack";

const app = new cdk.App();

new RgbSplittingStack(app, "RgbSplittingStack", {});
