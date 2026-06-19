# Lagoon watcher — AWS

Runs the release watcher 24/7 on AWS: an EventBridge-scheduled Python Lambda that
reuses `lagoon_client.py`, detects weekend **releases** (a slot's free count rising
within a 48h window), logs them to CloudWatch, and keeps free-count state in S3.
**No alerting yet** — releases are logged only (see the deferred §13 in
`../docs/superpowers/specs/2026-06-19-watcher-aws-design.md`).

## Live
- Stack **`LagoonWatcher`** (eu-west-1). Deployed via CDK.
- Schedule: **every 10 min, 06:00–00:00 UTC** (`cron(0/10 6-23 ? * * *)`). Cron is
  UTC; the release logic interprets session times in Europe/London.
- State: `s3://<StateBucket>/state/free.json` (single JSON map; first run baselines
  silently). Alert scope is weekend-only in the handler, so midweek runs are no-ops.

## ⚠️ The local Mac watcher is still running (intentionally)
The launchd watcher on Dave's Mac is **NOT decommissioned**. It's the one that
actually *alerts* (macOS notifications); the AWS watcher only logs (alerting parked).
They run side by side on independent state (local `state/free.json` vs S3) until the
notification sub-system exists. Decommission the local one (`launchd/uninstall.sh`)
only once AWS notifications are built.

## Layout
- `lambda/handler.py` — Lambda entry: `release_record`, `run` (AWS-agnostic, injected
  state IO), `lambda_handler` (boto3 S3).
- `lambda/requirements.txt` — `tzdata` (only dep; boto3 is in the Lambda runtime).
- `lambda/build-lambda.sh` — assembles the deployable asset (handler + the shared
  `lagoon_client.py` + `courses.json` + `tzdata`). No Docker (tzdata is pure-Python).
- `cdk/` — CDK app: S3 state bucket, the Python Lambda, the EventBridge rule, IAM.

## Build / deploy (eu-west-1)
    cd aws/cdk && npm install
    npm run synth      # build asset + cdk synth
    npm run deploy     # build asset + cdk deploy

## Test (logic only, no AWS)
    python3 tests/test_handler.py
    python3 tests/test_watch.py

Spec: `../docs/superpowers/specs/2026-06-19-watcher-aws-design.md` ·
Plan: `../docs/superpowers/plans/2026-06-19-watcher-aws.md`
