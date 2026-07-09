import { Stack, StackProps, Duration, RemovalPolicy, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as logs from "aws-cdk-lib/aws-logs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as path from "path";

export class WatcherStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Free-count state — a single JSON object, versioned with a 30-day prune.
    const stateBucket = new s3.Bucket(this, "StateBucket", {
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY, // state is recreatable (baseline on next run)
      autoDeleteObjects: true,
      lifecycleRules: [{ noncurrentVersionExpiration: Duration.days(30) }],
    });

    // Push subscriptions. PK = subId (a sha256 of the push endpoint — deterministic,
    // bounded length). Pay-per-request: traffic is tiny and spiky. Stage 1 stores the
    // subscription only; Stage 2 adds prefs columns to the same item.
    const subsTable = new dynamodb.Table(this, "PushSubs", {
      partitionKey: { name: "subId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY, // subscriptions are re-createable from the client
    });

    // Registration endpoint the client POSTs subscriptions to. Its own tiny asset dir
    // (no tzdata/webpush). Function URL = a plain HTTPS endpoint, no API Gateway.
    const registerFn = new lambda.Function(this, "RegisterFn", {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "handler.lambda_handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "..", "..", "lambda-register")),
      timeout: Duration.seconds(10),
      memorySize: 128,
      logRetention: logs.RetentionDays.ONE_MONTH,
      environment: { SUBS_TABLE: subsTable.tableName },
    });
    subsTable.grantWriteData(registerFn); // put_item + delete_item

    const registerUrl = registerFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE, // opaque endpoint; subscription itself is the capability
    });
    new CfnOutput(this, "RegisterUrl", { value: registerUrl.url });

    // The watcher. Asset is prebuilt by ../lambda/build-lambda.sh (run via npm scripts).
    const fn = new lambda.Function(this, "WatcherFn", {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "handler.lambda_handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "..", "..", "lambda", "build")),
      timeout: Duration.seconds(30),
      memorySize: 256,
      logRetention: logs.RetentionDays.ONE_MONTH,
      environment: {
        STATE_BUCKET: stateBucket.bucketName,
        STATE_KEY: "state/free.json",
        URGENT_HOURS: "48",
        HORIZON_DAYS: "14",
      },
    });
    // Least-privilege: the handler only GETs and PUTs the one object (no delete).
    stateBucket.grantRead(fn);
    stateBucket.grantPut(fn);

    // Every 10 min, 06:00–23:50 UTC, daily. EventBridge cron is UTC (no DST).
    new events.Rule(this, "Schedule", {
      description: "Lagoon watcher — every 10 min, 06:00–00:00 UTC",
      schedule: events.Schedule.cron({ minute: "0/10", hour: "6-23" }),
      targets: [new targets.LambdaFunction(fn)],
    });
  }
}
