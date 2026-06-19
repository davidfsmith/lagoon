# Watcher on AWS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the release watcher on AWS 24/7 — an EventBridge-scheduled Python Lambda that reuses the existing watcher logic, detects weekend releases, logs them to CloudWatch, and keeps free-count state in S3. No alerting (parked).

**Architecture:** A self-contained AWS CDK (TypeScript) app in the lagoon repo provisions an S3 state bucket, a Python Lambda (bundling `handler.py` + the shared `lagoon_client.py` + `courses.json` + `tzdata`), and an EventBridge scheduled rule (every 10 min, 06:00–00:00 UTC). The Lambda's testable logic is decoupled from AWS via injected state-IO callables.

**Tech Stack:** Python 3.12 (Lambda; stdlib + boto3 from the runtime + bundled `tzdata`), AWS CDK v2 (TypeScript), the existing `lagoon_client.py`.

**Spec:** `docs/superpowers/specs/2026-06-19-watcher-aws-design.md`

**Prerequisites (engineer's machine):** Node 18+ & npm, Python 3.11+, AWS credentials for the target account (eu-west-1), and the repo's `python3` (`/opt/homebrew/bin/python3`). No Docker needed — the Lambda asset is built locally (`tzdata` is pure-Python, portable to Lambda).

## File Structure

```
lagoon/
  lagoon_client.py            # MODIFY: add run_id to Slot; move released_within_window here
  watch.py                    # MODIFY: import released_within_window from lagoon_client
  tests/
    test_watch.py             # MODIFY: import released_within_window from lagoon_client
    test_handler.py           # CREATE: unit tests for the Lambda handler logic
  aws/
    lambda/
      handler.py              # CREATE: Lambda entry + release_record + run()
      requirements.txt        # CREATE: tzdata
      build-lambda.sh         # CREATE: assembles the deployable asset dir
      build/                  # generated (gitignored)
    cdk/
      bin/watcher.ts          # CREATE: CDK app entry
      lib/watcher-stack.ts    # CREATE: the stack
      package.json, cdk.json, tsconfig.json   # CREATE
  .gitignore                  # MODIFY: ignore aws/lambda/build/ and CDK artifacts
  aws/README.md               # CREATE: how to build/deploy
```

---

## Task 1: Move `released_within_window` into the shared client

**Files:**
- Modify: `lagoon_client.py` (append the function)
- Modify: `watch.py` (remove local def; call `lc.released_within_window`)
- Modify: `tests/test_watch.py` (import from `lagoon_client`)

- [ ] **Step 1: Add the function to `lagoon_client.py`** — append after `find_openings` (end of file):

```python


def released_within_window(slots, prev_free, now, urgent_hours):
    """Slots whose free count increased since prev_free, within the lead window.

    prev_free is the previous {key: free} map, or None on the very first run
    (in which case nothing is a release yet — we only record a baseline). A slot
    with no prior entry is treated as having had 0 free, so a full→free flip
    counts as a release.
    """
    if prev_free is None:
        return []
    out = []
    for s in slots:
        lead = (s.start - now).total_seconds() / 3600
        if 0 <= lead <= urgent_hours and s.free > prev_free.get(s.key, 0):
            out.append(s)
    return out
```

- [ ] **Step 2: Remove the duplicate from `watch.py`** — delete the `def released_within_window(...)` block (the function defined there, lines beginning `def released_within_window(slots, prev_free, now, urgent_hours):` through its `return out`). Leave `fmt_lead` in place.

- [ ] **Step 3: Update the call site in `watch.py`** — in `main()`, change:

```python
    released = released_within_window(scoped, prev_free, now, args.urgent_hours)
```
to:
```python
    released = lc.released_within_window(scoped, prev_free, now, args.urgent_hours)
```

- [ ] **Step 4: Update the test import in `tests/test_watch.py`** — change:

```python
from watch import released_within_window  # noqa: E402
```
to:
```python
from lagoon_client import released_within_window  # noqa: E402
```

- [ ] **Step 5: Run tests to verify nothing broke**

Run: `cd /Users/davidsmith/Development/lagoon && /opt/homebrew/bin/python3 tests/test_watch.py`
Expected: `OK` (7 tests). Then `cd app && node --test` → 21 pass (unaffected).

- [ ] **Step 6: Commit**

```bash
git add lagoon_client.py watch.py tests/test_watch.py
git commit -m "refactor: move released_within_window into lagoon_client (shared by Lambda)"
```

---

## Task 2: Add `run_id` to `Slot` (for the booking deep-link)

**Files:**
- Modify: `lagoon_client.py` (`Slot` dataclass, `fetch_openings`, `as_dict`)
- Modify: `tests/test_watch.py` (add an assertion)

- [ ] **Step 1: Write the failing test** — append to `tests/test_watch.py`:

```python
def _slot(**kw):
    import datetime as _d
    from lagoon_client import Slot
    base = dict(course_id=50, label="Tech 30", run_id=98610,
                start=_d.datetime(2026, 6, 20, 13, 0, tzinfo=_d.timezone.utc),
                end=_d.datetime(2026, 6, 20, 13, 30, tzinfo=_d.timezone.utc),
                free=1, capacity=2)
    base.update(kw)
    return Slot(**base)


class SlotRunId(unittest.TestCase):
    def test_slot_carries_run_id(self):
        s = _slot(run_id=12345)
        self.assertEqual(s.run_id, 12345)
        self.assertEqual(s.as_dict()["run_id"], 12345)
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/davidsmith/Development/lagoon && /opt/homebrew/bin/python3 tests/test_watch.py`
Expected: FAIL — `Slot.__init__() got an unexpected keyword argument 'run_id'`.

- [ ] **Step 3: Add the field to `Slot`** — in `lagoon_client.py`, change the dataclass fields from:

```python
@dataclass(frozen=True)
class Slot:
    course_id: int
    label: str
    start: _dt.datetime
    end: _dt.datetime
    free: int
    capacity: int
```
to:
```python
@dataclass(frozen=True)
class Slot:
    course_id: int
    label: str
    start: _dt.datetime
    end: _dt.datetime
    free: int
    capacity: int
    run_id: int = 0  # courseRun id (for the booking deep-link)
```

- [ ] **Step 4: Include it in `as_dict`** — in `Slot.as_dict`, add `"run_id": self.run_id,` after the `"capacity"` line:

```python
            "free": self.free,
            "capacity": self.capacity,
            "run_id": self.run_id,
            "weekend": self.is_weekend,
```

- [ ] **Step 5: Capture it in `fetch_openings`** — in the `out.append(Slot(...))` call, add `run_id`:

```python
                out.append(Slot(
                    course_id=course_id,
                    label=label,
                    start=start,
                    end=_dt.datetime.fromisoformat(run["endDate"]),
                    free=free,
                    capacity=run["maxNumbers"],
                    run_id=run["id"],
                ))
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd /Users/davidsmith/Development/lagoon && /opt/homebrew/bin/python3 tests/test_watch.py`
Expected: `OK` (8 tests).

- [ ] **Step 7: Commit**

```bash
git add lagoon_client.py tests/test_watch.py
git commit -m "feat: Slot.run_id (courseRun id) for the booking deep-link"
```

---

## Task 3: Lambda — `release_record()` + requirements

**Files:**
- Create: `aws/lambda/handler.py`
- Create: `aws/lambda/requirements.txt`
- Create: `tests/test_handler.py`

- [ ] **Step 1: Create `aws/lambda/requirements.txt`**

```
tzdata
```

- [ ] **Step 2: Write the failing test** — `tests/test_handler.py`:

```python
"""Tests for the AWS Lambda handler logic (no AWS / boto3 needed).

Run: python3 tests/test_handler.py
"""
import datetime as dt
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))                 # lagoon_client
sys.path.insert(0, str(ROOT / "aws" / "lambda"))  # handler
from lagoon_client import Slot  # noqa: E402
import handler  # noqa: E402

UTC = dt.timezone.utc


def slot(course_id, label, run_id, start, free, capacity=2):
    return Slot(course_id=course_id, label=label, run_id=run_id, start=start,
                end=start + dt.timedelta(minutes=30), free=free, capacity=capacity)


class ReleaseRecord(unittest.TestCase):
    def test_record_shape_and_london_time(self):
        s = slot(51, "Air 30", 98652, dt.datetime(2026, 6, 21, 15, 30, tzinfo=UTC), 1)
        now = dt.datetime(2026, 6, 19, 23, 30, tzinfo=UTC)
        rec = handler.release_record(s, now)
        self.assertEqual(rec["label"], "Air 30")
        self.assertEqual(rec["runId"], 98652)
        self.assertEqual(rec["startLondon"], "2026-06-21T16:30")  # 15:30 UTC = 16:30 BST
        self.assertEqual(rec["free"], 1)
        self.assertEqual(rec["capacity"], 2)
        self.assertEqual(rec["book"], "https://booking.lagoon.co.uk/book?courseRunId=98652")
        self.assertAlmostEqual(rec["leadHours"], (s.start - now).total_seconds() / 3600, places=1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd /Users/davidsmith/Development/lagoon && /opt/homebrew/bin/python3 tests/test_handler.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'handler'`.

- [ ] **Step 4: Create `aws/lambda/handler.py`** (release_record only for now):

```python
"""AWS Lambda watcher: detect weekend releases, log them, keep S3 state.

Reuses lagoon_client (bundled alongside this file). No alerting in v1 — releases
are logged as structured JSON; the run summary is logged too. boto3 is imported
inside lambda_handler so this module imports cleanly without AWS deps (for tests).
"""
from __future__ import annotations

import datetime as dt
import json
import pathlib

import lagoon_client as lc

BOOKING_SITE = "https://booking.lagoon.co.uk"
CONFIG_PATH = pathlib.Path(__file__).with_name("courses.json")


def release_record(slot, now: dt.datetime) -> dict:
    """Structured record for a detected release (logged; not published in v1)."""
    lead = (slot.start - now).total_seconds() / 3600
    return {
        "label": slot.label,
        "courseId": slot.course_id,
        "runId": slot.run_id,
        "startLondon": slot.local.strftime("%Y-%m-%dT%H:%M"),
        "free": slot.free,
        "capacity": slot.capacity,
        "leadHours": round(lead, 1),
        "book": f"{BOOKING_SITE}/book?courseRunId={slot.run_id}",
    }
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd /Users/davidsmith/Development/lagoon && /opt/homebrew/bin/python3 tests/test_handler.py`
Expected: `OK` (1 test).

- [ ] **Step 6: Commit**

```bash
git add aws/lambda/handler.py aws/lambda/requirements.txt tests/test_handler.py
git commit -m "feat(aws): Lambda release_record() + requirements (tzdata)"
```

---

## Task 4: Lambda — `run()` orchestration + `lambda_handler`

**Files:**
- Modify: `aws/lambda/handler.py` (add `run` + `lambda_handler`)
- Modify: `tests/test_handler.py` (add `run` tests)

- [ ] **Step 1: Add failing tests** — append to `tests/test_handler.py` (before the `if __name__` line):

```python
class Run(unittest.TestCase):
    def setUp(self):
        self.now = dt.datetime(2026, 6, 19, 23, 30, tzinfo=UTC)
        # a weekend slot ~41h out (within the 48h window)
        self.s = slot(51, "Air 30", 98652, dt.datetime(2026, 6, 21, 15, 30, tzinfo=UTC), 1)
        self.written = {}

    def _run(self, prev):
        return handler.run(
            read_state=lambda: prev,
            write_state=lambda free: self.written.update(free),
            courses=[{"id": 51, "label": "Air 30"}],
            now=self.now, urgent_hours=48, horizon_days=14,
            find_openings=lambda courses, days_ahead, weekend_only, now: [self.s],
        )

    def test_first_run_baselines_silently(self):
        records = self._run(prev=None)        # no prior state
        self.assertEqual(records, [])
        self.assertEqual(self.written, {self.s.key: 1})  # state recorded

    def test_no_change_no_release(self):
        records = self._run(prev={self.s.key: 1})
        self.assertEqual(records, [])

    def test_free_increase_is_a_release(self):
        records = self._run(prev={self.s.key: 0})  # was full, now free
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["runId"], 98652)

    def test_fetch_error_writes_no_state(self):
        def boom(**kw):
            raise RuntimeError("Lagoon down")
        with self.assertRaises(RuntimeError):
            handler.run(read_state=lambda: {}, write_state=lambda f: self.written.update(f),
                        courses=[{"id": 51, "label": "Air 30"}], now=self.now,
                        urgent_hours=48, horizon_days=14, find_openings=boom)
        self.assertEqual(self.written, {})  # nothing written on fetch failure
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/davidsmith/Development/lagoon && /opt/homebrew/bin/python3 tests/test_handler.py`
Expected: FAIL — `AttributeError: module 'handler' has no attribute 'run'`.

- [ ] **Step 3: Add `run` + `lambda_handler`** — append to `aws/lambda/handler.py`:

```python
def run(read_state, write_state, courses, now, urgent_hours, horizon_days,
        find_openings=lc.find_openings):
    """Detect weekend releases and record state. Pure of AWS — state IO and the
    fetch are injected so this is unit-testable. Fetches first, so any fetch/read
    error aborts BEFORE state is written (never baseline-wipe on a transient error).
    """
    slots = find_openings(courses, days_ahead=horizon_days, weekend_only=True, now=now)
    prev = read_state()
    releases = lc.released_within_window(slots, prev, now, urgent_hours)
    write_state({s.key: s.free for s in slots})
    records = [release_record(s, now) for s in releases]
    for r in records:
        print(json.dumps({"release": r}))
    print(json.dumps({"summary": {"released": len(records), "open": len(slots)}}))
    return records


def lambda_handler(event, context):
    import os
    import boto3
    from botocore.exceptions import ClientError

    s3 = boto3.client("s3")
    bucket = os.environ["STATE_BUCKET"]
    key = os.environ.get("STATE_KEY", "state/free.json")

    def read_state():
        try:
            body = s3.get_object(Bucket=bucket, Key=key)["Body"].read()
            return json.loads(body)
        except ClientError as e:
            if e.response["Error"]["Code"] in ("NoSuchKey", "404"):
                return None
            raise

    def write_state(free):
        s3.put_object(Bucket=bucket, Key=key,
                      Body=json.dumps(free, sort_keys=True).encode(),
                      ContentType="application/json")

    courses = lc.resolve_courses(lc.load_monitor(CONFIG_PATH))
    records = run(
        read_state, write_state, courses,
        now=dt.datetime.now(dt.timezone.utc),
        urgent_hours=float(os.environ.get("URGENT_HOURS", "48")),
        horizon_days=int(os.environ.get("HORIZON_DAYS", "14")),
    )
    return {"released": len(records)}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd /Users/davidsmith/Development/lagoon && /opt/homebrew/bin/python3 tests/test_handler.py`
Expected: `OK` (5 tests).

- [ ] **Step 5: Commit**

```bash
git add aws/lambda/handler.py tests/test_handler.py
git commit -m "feat(aws): Lambda run() orchestration + lambda_handler (S3 state, logged releases)"
```

---

## Task 5: Lambda build script

**Files:**
- Create: `aws/lambda/build-lambda.sh`
- Modify: `.gitignore`

- [ ] **Step 1: Create `aws/lambda/build-lambda.sh`**

```bash
#!/bin/bash
# Assemble the deployable Lambda asset: handler + shared client + config + tzdata.
# tzdata is pure-Python, so a local pip install is portable to the Lambda runtime
# (no Docker needed). Run before `cdk deploy`.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
BUILD="$HERE/build"
PYTHON="${LAGOON_PYTHON:-/opt/homebrew/bin/python3}"

rm -rf "$BUILD"; mkdir -p "$BUILD"
"$PYTHON" -m pip install -r "$HERE/requirements.txt" -t "$BUILD" --quiet
cp "$HERE/handler.py" "$ROOT/lagoon_client.py" "$ROOT/courses.json" "$BUILD/"
echo "Built Lambda asset at $BUILD:"; ls "$BUILD"
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x /Users/davidsmith/Development/lagoon/aws/lambda/build-lambda.sh`

- [ ] **Step 3: Add ignores** — append to `.gitignore`:

```
# AWS watcher build/CDK artifacts
aws/lambda/build/
aws/cdk/node_modules/
aws/cdk/cdk.out/
```

- [ ] **Step 4: Build and verify the asset**

Run: `/Users/davidsmith/Development/lagoon/aws/lambda/build-lambda.sh`
Expected: prints "Built Lambda asset at …/build:" and a listing including `handler.py`, `lagoon_client.py`, `courses.json`, and a `tzdata/` directory.

- [ ] **Step 5: Commit**

```bash
git add aws/lambda/build-lambda.sh .gitignore
git commit -m "build(aws): Lambda asset build script (handler + client + tzdata)"
```

---

## Task 6: CDK app scaffold (empty stack synthesises)

**Files:**
- Create: `aws/cdk/package.json`, `aws/cdk/cdk.json`, `aws/cdk/tsconfig.json`
- Create: `aws/cdk/bin/watcher.ts`, `aws/cdk/lib/watcher-stack.ts`

- [ ] **Step 1: Create `aws/cdk/package.json`**

```json
{
  "name": "lagoon-watcher-cdk",
  "version": "0.1.0",
  "private": true,
  "bin": { "watcher": "bin/watcher.ts" },
  "scripts": {
    "build": "../lambda/build-lambda.sh && tsc -p tsconfig.json --noEmit",
    "synth": "../lambda/build-lambda.sh && cdk synth",
    "deploy": "../lambda/build-lambda.sh && cdk deploy"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "aws-cdk": "^2.150.0",
    "ts-node": "^10.9.2",
    "typescript": "~5.5.4"
  },
  "dependencies": {
    "aws-cdk-lib": "^2.150.0",
    "constructs": "^10.3.0"
  }
}
```

- [ ] **Step 2: Create `aws/cdk/cdk.json`**

```json
{
  "app": "npx ts-node --prefer-ts-exts bin/watcher.ts"
}
```

- [ ] **Step 3: Create `aws/cdk/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "exclude": ["node_modules", "cdk.out"]
}
```

- [ ] **Step 4: Create `aws/cdk/lib/watcher-stack.ts`** (empty stack for now)

```typescript
import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";

export class WatcherStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
  }
}
```

- [ ] **Step 5: Create `aws/cdk/bin/watcher.ts`**

```typescript
#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { WatcherStack } from "../lib/watcher-stack";

const app = new cdk.App();
new WatcherStack(app, "LagoonWatcher", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: "eu-west-1" },
});
```

- [ ] **Step 6: Install deps and synth the empty stack**

Run: `cd /Users/davidsmith/Development/lagoon/aws/cdk && npm install && npx cdk synth`
Expected: prints CloudFormation YAML for an (almost empty) `LagoonWatcher` stack, no errors.

- [ ] **Step 7: Commit**

```bash
git add aws/cdk/package.json aws/cdk/cdk.json aws/cdk/tsconfig.json aws/cdk/bin/watcher.ts aws/cdk/lib/watcher-stack.ts
git commit -m "feat(aws): CDK app scaffold (empty WatcherStack synthesises)"
```

---

## Task 7: CDK resources — bucket, Lambda, schedule, IAM

**Files:**
- Modify: `aws/cdk/lib/watcher-stack.ts`

- [ ] **Step 1: Replace `aws/cdk/lib/watcher-stack.ts` with the full stack**

```typescript
import { Stack, StackProps, Duration, RemovalPolicy } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as logs from "aws-cdk-lib/aws-logs";
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
    stateBucket.grantReadWrite(fn);

    // Every 10 min, 06:00–23:50 UTC, daily. EventBridge cron is UTC (no DST).
    new events.Rule(this, "Schedule", {
      description: "Lagoon watcher — every 10 min, 06:00–00:00 UTC",
      schedule: events.Schedule.cron({ minute: "0/10", hour: "6-23" }),
      targets: [new targets.LambdaFunction(fn)],
    });
  }
}
```

Note: this uses the GA `aws-events` scheduled **Rule** (simpler than the alpha EventBridge Scheduler module); same UTC cron, same Lambda target, same cost (free).

- [ ] **Step 2: Build the asset and synth**

Run: `cd /Users/davidsmith/Development/lagoon/aws/cdk && ../lambda/build-lambda.sh && npx cdk synth`
Expected: CloudFormation including `AWS::S3::Bucket`, `AWS::Lambda::Function`, `AWS::Events::Rule`, and IAM allowing the function to read/write the bucket. No errors.

- [ ] **Step 3: Assert key resources are present** (lightweight infra check)

```bash
cd /Users/davidsmith/Development/lagoon/aws/cdk
npx cdk synth > /tmp/watcher.synth.yaml
grep -q "AWS::Lambda::Function" /tmp/watcher.synth.yaml && \
grep -q "AWS::S3::Bucket" /tmp/watcher.synth.yaml && \
grep -q "AWS::Events::Rule" /tmp/watcher.synth.yaml && \
grep -q "cron(0/10 6-23" /tmp/watcher.synth.yaml && \
echo "infra OK" || echo "MISSING RESOURCE"
```
Expected: `infra OK`.

- [ ] **Step 4: Commit**

```bash
git add aws/cdk/lib/watcher-stack.ts
git commit -m "feat(aws): watcher stack — S3 state, Python Lambda, EventBridge schedule, IAM"
```

---

## Task 8: Deploy & manual acceptance (ops — no automated test)

**Files:** none (deploy + verify against AWS)

- [ ] **Step 1: Bootstrap CDK (first time only, per account/region)**

Run: `cd /Users/davidsmith/Development/lagoon/aws/cdk && npx cdk bootstrap aws://$(aws sts get-caller-identity --query Account --output text)/eu-west-1`
Expected: bootstrap stack created/he confirmed.

- [ ] **Step 2: Deploy**

Run: `cd /Users/davidsmith/Development/lagoon/aws/cdk && ../lambda/build-lambda.sh && npx cdk deploy`
Expected: `LagoonWatcher` deploys; outputs the function name. Approve the IAM change prompt.

- [ ] **Step 3: Invoke once and check the run**

```bash
FN=$(aws lambda list-functions --region eu-west-1 \
  --query "Functions[?starts_with(FunctionName,'LagoonWatcher')].FunctionName | [0]" --output text)
aws lambda invoke --region eu-west-1 --function-name "$FN" /tmp/out.json && cat /tmp/out.json
```
Expected: `{"released": 0}` (first run baselines). Then check the state object exists:
```bash
BUCKET=$(aws s3 ls | grep -i lagoonwatcher | awk '{print $3}')
aws s3 ls "s3://$BUCKET/state/free.json"
```
Expected: the object is listed.

- [ ] **Step 4: Confirm logs**

Run: `aws logs tail "/aws/lambda/$FN" --region eu-west-1 --since 5m`
Expected: a `{"summary": {"released": 0, "open": N}}` line.

- [ ] **Step 5: Simulate a release and confirm it's logged**

```bash
# lower a weekend slot's recorded free count, then invoke again
aws s3 cp "s3://$BUCKET/state/free.json" /tmp/free.json
/opt/homebrew/bin/python3 - <<'PY'
import json; f=json.load(open("/tmp/free.json"))
k=next(iter(f)); f[k]=0; json.dump(f,open("/tmp/free.json","w"))
print("tampered", k)
PY
aws s3 cp /tmp/free.json "s3://$BUCKET/state/free.json"
aws lambda invoke --region eu-west-1 --function-name "$FN" /tmp/out.json && cat /tmp/out.json
aws logs tail "/aws/lambda/$FN" --region eu-west-1 --since 2m | grep '"release"'
```
Expected: `{"released": 1}` and a `{"release": {...runId...book...}}` log line. (The next scheduled run re-baselines.)

- [ ] **Step 6: Commit** (nothing to commit — note completion in the task tracker.)

---

## Task 9: Docs + decommission the local watcher

**Files:**
- Create: `aws/README.md`
- (Action) stop the local launchd agent

- [ ] **Step 1: Create `aws/README.md`**

```markdown
# Lagoon watcher — AWS

Runs the release watcher 24/7 on AWS: an EventBridge-scheduled Python Lambda that
reuses `lagoon_client.py`, detects weekend releases (free count rising within 48h),
logs them to CloudWatch, and keeps free-count state in S3. **No alerting yet** —
releases are logged only (see the spec's deferred §13).

## Layout
- `lambda/handler.py` — Lambda entry (`release_record`, `run`, `lambda_handler`)
- `lambda/requirements.txt` — `tzdata` (only dep; boto3 is in the runtime)
- `lambda/build-lambda.sh` — assembles the deployable asset (handler + client + config + tzdata)
- `cdk/` — CDK app (S3 bucket, Lambda, EventBridge rule)

## Build / deploy (eu-west-1)
    cd aws/cdk
    npm install
    npm run synth      # build asset + cdk synth
    npm run deploy     # build asset + cdk deploy

## Test (logic, no AWS)
    python3 tests/test_handler.py
    python3 tests/test_watch.py

Schedule: every 10 min, 06:00–00:00 UTC (`cron(0/10 6-23 ? * * *)`). Alert scope is
weekend-only inside the handler. Spec: `docs/superpowers/specs/2026-06-19-watcher-aws-design.md`.
```

- [ ] **Step 2: Stop the local launchd watcher** (after the AWS watcher is verified)

Run: `/Users/davidsmith/Development/lagoon/launchd/uninstall.sh`
Expected: "Removed uk.co.lagoon.wakewatch …". The AWS watcher is now the live one; local code stays for manual use.

- [ ] **Step 3: Commit**

```bash
git add aws/README.md
git commit -m "docs(aws): watcher README; local launchd watcher decommissioned"
```

---

## Self-review notes (addressed)

- **Spec coverage:** schedule §6 (Task 7 Rule, UTC cron), Lambda reuse §4–5 (Tasks 1–5), S3 state §7 (Task 4 run + Task 7 bucket), release record §8 (Task 3), error/no-write-on-failure §9 (Task 4 `test_fetch_error_writes_no_state`), cost §10 (free; no extra resources), testing §11 (Tasks 3/4 unit + Task 7 synth assert + Task 8 acceptance), deploy/decommission §12 (Tasks 8–9), alerting parked §2/§13 (logs only — no SNS anywhere). All covered.
- **Deviation noted:** GA `aws-events` Rule instead of the alpha EventBridge Scheduler — same UTC cron/target/cost, fewer moving parts. Recorded in Task 7.
- **Type/name consistency:** `run_id` (Slot), `release_record`/`run`/`lambda_handler`, `read_state`/`write_state`, env `STATE_BUCKET`/`STATE_KEY`/`URGENT_HOURS`/`HORIZON_DAYS` used identically across tasks and tests.
- **No placeholders:** every code/command step is complete and runnable.
```
