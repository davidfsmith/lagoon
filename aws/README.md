# Lagoon watcher + push notifications — AWS

Runs 24/7 on AWS (stack **`LagoonWatcher`**, eu-west-1, deployed via CDK). Two jobs:

1. **Detect openings** — an EventBridge-scheduled Python Lambda reuses `lagoon_client.py`
   to poll the live Lagoon API, detect a slot's free count **rising** since the last run
   (all days, within a 7-day horizon), and keep free-count state in S3.
2. **Notify riders** — for each detected opening it sends a **per-rider Web Push**,
   filtered by that rider's prefs, and stores subscriptions in DynamoDB.

## Components
- **Watcher Lambda** (`WatcherFn`, 256 MB) — `lambda/handler.py`. Every 10 min it detects
  openings then, for each subscription, runs the pure per-user filter and sends.
- **Registration Lambda** (`RegisterFn`, 128 MB) — `lambda-register/handler.py`, exposed as
  a **function URL** (no auth — the opaque push endpoint is the capability). The client
  POSTs `{subscription, prefs}` to subscribe / update prefs, DELETE `{endpoint}` to
  unsubscribe.
- **DynamoDB** `PushSubs` (PK `subId` = sha256(endpoint), pay-per-request) — one item per
  subscription: endpoint + keys, rider prefs (`days`/`types`/`travelMins`), and
  **server-owned** `notifyLog` (dedupe + daily cap) / `pending` (quiet-hours holds).
- **VAPID keypair** — public key ships in the client (`app/js/config.js`); private key is an
  **SSM SecureString** `/lagoon/push/vapid-private`, read by the watcher at send time.
- **S3 state** — `s3://<StateBucket>/state/free.json` (single JSON map; first run baselines
  silently).

## Notification behaviour (the per-user filter)
`lambda/notify_filter.py` (`filter_for_sub`, pure/unit-tested) decides, per subscription:
- **gates** — opening is within 7 days, on a chosen weekday, of a chosen session type, and
  **reachable** (`start − now ≥ travelMins + 15 min` buffer);
- **anti-spam** — dedupe (once/slot/day), daily **cap** (5/day, ≥30 min apart), **coalesce**
  a run's matches into one push, **quiet hours** 21:00–08:00 (held then delivered at 08:00).

`handler.py` `send()` scans subs, filters each, sends via `pywebpush` (VAPID from SSM), and
persists each sub's `notifyLog`/`pending`. Tapping a notification deep-links to the freed
slot's Day view (client-side; see `app/sw.js` + `app/js/app.js`).

## Live config
- Schedule: **every 10 min, 06:00–00:00 UTC** (`cron(0/10 6-23 ? * * *)`). Cron is UTC; the
  filter interprets session times in Europe/London.
- Env: `HORIZON_DAYS=7`, `URGENT_HOURS=168` (detect across the full notify horizon),
  `SUBS_TABLE`, `VAPID_PRIVATE_PARAM`, `STATE_BUCKET`.
- IAM (least-privilege): watcher gets S3 get/put, DynamoDB **Scan+UpdateItem+DeleteItem**,
  SSM GetParameter on the one VAPID param; registration Lambda gets DynamoDB write.

## Layout
- `lambda/handler.py` — watcher entry: `release_record`, `run` (AWS-agnostic, injected IO),
  `lambda_handler` (S3 + the `send` closure).
- `lambda/notify_filter.py` — the pure per-user filter (`filter_for_sub` + helpers).
- `lambda/push.py` — `build_payload` (+ deep-link target) and `send_all` (injectable poster).
- `lambda/requirements.txt` — `tzdata` + `pywebpush<2` (sync API; drops the aiohttp stack).
- `lambda/build-lambda.sh` — assembles the asset. **Requires Docker**: `pywebpush` pulls in
  native `cryptography`/`cffi`, so deps are installed **inside the AWS SAM `build-python3.12`
  image (linux/amd64)** to match the Lambda runtime (a `--platform` pip from macOS can't
  resolve them). Also bundles `handler.py`, `push.py`, `notify_filter.py`, the shared
  `lagoon_client.py`, and `courses.json`.
- `lambda-register/handler.py` — subscribe/unsubscribe + prefs validation (`clean_prefs`,
  `KNOWN_TYPES`); no external deps.
- `cdk/` — CDK app: state bucket, subs table, both Lambdas + the function URL, EventBridge
  rule, IAM, SSM.

## Build / deploy (eu-west-1, needs Docker)
    cd aws/cdk && npm install
    npm run synth      # build asset (Docker) + cdk synth
    npm run deploy     # build asset (Docker) + cdk deploy
> An IAM-changing deploy prompts for approval; add `--require-approval never` when running
> non-interactively (`npx cdk deploy --require-approval never`).

VAPID keypair (one-time): `vapid --gen` → put the private PEM in SSM
(`aws ssm put-parameter --name /lagoon/push/vapid-private --type SecureString --value "$(cat private_key.pem)"`),
put the printed `applicationServerKey` in `app/js/config.js`.

## Force a test send (no real opening needed)
Reset the state so current free slots read as new, then invoke:

    aws s3 cp <(printf '{}') s3://<StateBucket>/state/free.json
    aws lambda invoke --region eu-west-1 --function-name <WatcherFn> /dev/stdout
    # look for {"pushSummary": {"subs": N, "sent": N}} in the CloudWatch logs

## Test (logic only, no AWS)
    # watcher (needs repo root on the path for lagoon_client)
    PYTHONPATH=.. python3 -m pytest lambda/test_push.py lambda/test_notify_filter.py -q
    python3 -m pytest lambda-register/test_register.py -q
    python3 -m unittest discover -s ../tests   # legacy handler/client tests

## Cost
**Effectively free.** The watcher (~3,400 runs/mo × ~8 s × 256 MB ≈ 6,700 GB-s) sits well
inside the perpetual Lambda free tier; DynamoDB / S3 / CloudWatch / SSM+KMS are ~$0.05/mo
combined; EventBridge, the function URL, and the Web Push sends cost nothing. Total ~$0/mo
(≤ ~$0.20 with no free tier). GA (everyone) stays under ~$1/mo even at ~100 subscribers.

Specs/plans: `../docs/superpowers/specs|plans/2026-06-19-watcher-aws-*` and
`2026-07-*-push-notifications-*`.
