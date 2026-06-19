# Watcher on AWS — Design Spec

**Date:** 2026-06-19
**Status:** Approved (design); pending implementation plan
**Author:** Dave + Claude (brainstorming session)

## 1. Purpose

Run the wakeboarding **release watcher** on AWS so it operates 24/7, independent of
Dave's Mac (currently it runs locally via launchd, only when the machine is awake).
The watcher reads the **public** Lagoon API on a schedule, detects when a place is
**released** (free count rises) on a monitored weekend session within a short-notice
window, and emits an event. It is the "live data via Lambda" piece.

The PWA is unaffected and independent — it reads the Lagoon API directly from the
browser and needs no backend. This spec is only the watcher.

## 2. Scope decisions (agreed)

- **Serverless, AWS CDK (TypeScript), in the lagoon repo** as its own self-contained
  CDK app — decoupled from the in-progress (paused) site→AWS migration so it ships
  independently.
- **Region eu-west-1** (matches existing setup).
- **State in S3** — a single JSON object (the free-count map), the 1:1 cloud
  equivalent of the local `state/free.json`. (DynamoDB considered and rejected: it
  buys nothing at this single-blob, single-writer access pattern.)
- **All alerting is PARKED — including any event publishing.** v1 detects releases and
  **logs them to CloudWatch only**: no SNS, no event bus, no delivery. With multiple
  users likely, the entire alerting path (event mechanism, channels, per-user
  preferences) is a larger future design (§13); committing to an event shape now would
  risk baking in single-tenant assumptions.
- The watcher only ever reads **public availability** (identical for everyone), so
  release-detection is inherently shared / multi-user-ready; only *delivery* is
  per-user. The watcher design does not change for multi-user.
- **Reuse the existing watcher logic unchanged** — `lagoon_client.py` and
  `released_within_window()` are carried over verbatim; only the CLI `main()` is
  replaced by a Lambda handler.

## 3. Architecture

```
EventBridge Scheduler  (one schedule, cron in UTC)
   └── every 10 min, 06:00–00:00 UTC, daily
            │ invokes
            ▼
      Lambda (Python)
        1. resolve monitored courses by name (renumber-safe)
        2. fetch public courseRuns (Lagoon API), weekend scope, 14-day horizon
        3. GET previous free-counts from S3   (NoSuchKey → first run → baseline)
        4. released_within_window(slots, prev, now, 48h)   [reused unchanged]
        5. PUT current free-counts to S3
        6. log each detected release + a run summary  (CloudWatch)
            │
            ├──▶ S3 object  state/free.json     (the free-count map)
            └──▶ CloudWatch Logs                (every run + each release)
```

### Components (each one job)
- **Scheduler** — one EventBridge Scheduler schedule (every 10 min, 06:00–00:00 UTC,
  daily). The Lambda needs **no `schedule_policy` gate**; alert scope stays
  weekend-only inside the handler, so midweek runs are harmless no-ops.
- **Lambda** — the existing release-detection logic; thin handler over the shared
  client. Python runtime; 256 MB; ~30 s timeout.
- **State store (S3)** — one private bucket, key `state/free.json`. GET at start, PUT
  at end. Single scheduled writer → no concurrency concerns.
- **CloudWatch Logs** — every run + each detected release (structured). This is the
  **only** output of a release in v1, plus a hook for a future metric/alarm.

## 4. Repo layout & packaging

```
lagoon/
  lagoon_client.py            # shared, UNCHANGED (repo root = single source)
  watch.py, check.py, ...     # local watcher stays (manual/local use)
  aws/
    lambda/
      handler.py              # Lambda entry — replaces watch.py main()
      requirements.txt        # tzdata  (the only third-party dep)
    cdk/
      bin/watcher.ts          # CDK app entry
      lib/watcher-stack.ts    # the stack
      cdk.json, package.json, tsconfig.json
  docs/superpowers/specs/2026-06-19-watcher-aws-design.md
```

- The Lambda asset bundles `handler.py`, the **root** `lagoon_client.py`,
  `courses.json`, and `tzdata` (via `requirements.txt`). `tzdata` is required because
  the Lambda Python runtime lacks the IANA tz database that `zoneinfo` needs for
  `Europe/London`.
- `lagoon_client.py` is **not duplicated** — the CDK bundling step copies the root
  file into the asset, so local and Lambda share one source.

## 5. Handler logic (`aws/lambda/handler.py`)

Per invocation:
1. `resolve_courses(load_monitor(courses.json))` — by name, renumber-safe (one cheap
   API call).
2. `find_openings(courses, days_ahead=HORIZON_DAYS, weekend_only=True)`.
3. Load previous free-counts: `s3.get_object(STATE_BUCKET, STATE_KEY)`; on `NoSuchKey`
   treat as `None` (first run → baseline, no alerts).
4. `released = released_within_window(slots, prev_free, now_utc, URGENT_HOURS)` —
   reused unchanged.
5. `s3.put_object` current `{slot.key: free}` map.
6. Log each release as a structured record (§8) to CloudWatch, plus a one-line run
   summary (`released=<n>, open=<m>`). **No publishing/notification in v1.**

Config via env vars: `STATE_BUCKET`, `STATE_KEY=state/free.json`, `URGENT_HOURS=48`,
`HORIZON_DAYS=14`. Monitored courses from the bundled `courses.json` (only `enabled`
entries).

## 6. Scheduling (EventBridge Scheduler, UTC)

Single schedule, every 10 minutes, 06:00–00:00 UTC, daily:

- `cron(0/10 6-23 ? * * *)` — 06:00–23:50 every 10 min (UTC; EventBridge default
  timezone, so no DST handling). This UTC window = 07:00–01:00 BST in summer /
  06:00–00:00 GMT in winter, comfortably covering session hours (~08:00–20:00 London)
  year-round.

Rationale: at this cadence the cost is still ≈ $0 (see §10), so a single uniform
schedule is simpler than a weekday/weekend split. The handler keeps the **alert scope
weekend-only** (§5), so midweek runs — when no weekend session is within the 48 h
window — simply find nothing and are no-ops. **Only the trigger window is UTC**; the
release logic and the logged record still interpret session times in Europe/London
(§5, §8).

## 7. State (S3)

- One private, encrypted bucket; object key `state/free.json`; content = JSON map of
  `slot.key → free count` for the monitored **weekend** slots currently open. (v1
  doesn't replicate the local history sink, so weekday slots aren't tracked — release
  detection only needs the prior weekend free-counts.)
- `GetObject` at start; `NoSuchKey` → first run → record baseline, emit no alerts.
- `PutObject` at end (overwrite). Bucket versioning **on** (cheap safety net).
- Lifecycle rule: expire non-current versions after 30 days.

## 8. Release record (CloudWatch log)

Each detected release is logged as a structured JSON line (not published anywhere in
v1):

```json
{ "label": "Air 30", "courseId": 51, "runId": 98652,
  "startLondon": "2026-06-21T16:30", "free": 1, "capacity": 2, "leadHours": 40,
  "book": "https://booking.lagoon.co.uk/book?courseRunId=98652" }
```

It deliberately carries everything a future notification subscriber would need
(per-user filter, channel formatting, the booking deep-link), so when the alerting
sub-system is designed (§13) it can attach an event sink/publish step here without
changing the watcher's detection or state.

## 9. Error handling

- **Lagoon fetch fails** → log and exit **without writing state** (no data loss, no
  false releases; the next scheduled run retries). Key safety rule.
- **S3 read error other than `NoSuchKey`** → abort the run (never baseline-wipe on a
  transient error).
- EventBridge Scheduler retry policy: small (a failed run just waits for the next
  tick). No DLQ in v1.

## 10. Cost

Lambda, EventBridge Scheduler, and S3 all sit within AWS's perpetual free tiers at
this cadence (~3,300 runs/month for every-10-min 06:00–00:00 UTC) → **≈ $0/month**
(S3 PUTs are pennies; everything else free). See the cost breakdown discussed in
design.

## 11. Testing

- **Unit:** carry the existing `released_within_window` tests. Add a handler test with
  an injected/mocked S3 client (or `moto`): first run baselines silently; a free-count
  increase logs exactly one release record; no change logs none; a fetch error writes
  no state.
- **Infra:** `cdk synth` snapshot + `cdk diff`.
- **Acceptance:** deploy to eu-west-1, invoke the Lambda manually, confirm the S3
  `free.json` object appears and the run is logged; simulate a release (edit the S3
  object's counts down) and confirm the structured release record appears in
  CloudWatch logs.

## 12. Deploy & decommission

- **Deploy v1:** manual `cdk deploy` from Dave's laptop (has account creds). GitHub
  Actions OIDC for the lagoon repo is a later nicety, not required now.
- **Decommission local watcher:** once the AWS watcher is verified, run
  `launchd/uninstall.sh` to stop the Mac launchd agent (AWS becomes the live watcher).
  Keep the local code (`watch.py` etc.) for manual/local use.

## 13. Deferred — notifications (future sub-system)

Parked **entirely** by decision — channels *and* the event mechanism. The whole
alerting path is a future design, made larger by likely multi-user. Recorded:
- **Event mechanism** — how releases fan out (SNS topic, EventBridge bus, a queue, or
  per-user routing). Deliberately **not** pre-committed in v1 (v1 only logs).
- **Channels** — phone push (ntfy / Pushover / Telegram), email (SES from
  dave-smith.co.uk), SMS (SNS; ~£0.04/msg, UK sender reg), web push to the PWA
  (VAPID + subscription store).
- **Multi-user concerns** — per-user channel + preferences (which cables/sessions,
  quiet hours), opt-in/unsubscribe, subscription storage. A design in its own right.

When built, it reads the watcher's release output (the logged record §8, or an event
sink added then) — the watcher's detection and state don't change.

## 14. Out of scope (v1)

- **All alerting** — event publishing (SNS/EventBridge/queue), notification delivery,
  user preferences (§13). v1 logs releases to CloudWatch only.
- Multi-user accounts / per-user filtering.
- Replicating the full `history.jsonl` analytics in the cloud (CloudWatch logs suffice;
  the cadence is already data-validated). Can add an S3 history sink later if wanted.
- CI/CD for the watcher (manual `cdk deploy` for v1).
- Changes to the PWA or the site hosting.
