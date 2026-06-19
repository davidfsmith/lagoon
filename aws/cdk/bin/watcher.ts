#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { WatcherStack } from "../lib/watcher-stack";

const app = new cdk.App();
new WatcherStack(app, "LagoonWatcher", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: "eu-west-1" },
});
