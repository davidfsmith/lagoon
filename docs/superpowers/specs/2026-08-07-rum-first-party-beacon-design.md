# First-party cookieless RUM (usage analytics) — design

**Date:** 2026-08-07
**Status:** Design approved; pending spec review → implementation plan.
**Tech stack:** Vanilla ES modules, no build, no deps (client). Python stdlib-only Lambda
(like `lambda-register`), CDK infra in the existing `LagoonWatcher` stack. Athena for queries.

## Problem

CloudFront access logs are the only analytics today. They see **shell loads only** — not
in-app navigation (the SPA routes), can't dedupe real users (IP is a fuzzy proxy on mobile
NAT), and can't answer product questions like "how many visitors reach the notification
toggle and turn it on" (the low-subscriber question). We want richer, first-party,
privacy-preserving Real User Monitoring without a third-party script or the no-deps/no-build
house rules being broken.

## Goal

A **first-party, cookieless** RUM pipeline: a tiny in-app beacon posts anonymous events to
our own AWS, queried with Athena — mirroring the existing push-notification infra pattern.
No data leaves the account; no client-side identifier is stored.

Ship **dev-gated (`internal`)** first to validate the pipe, then promote the flag to roll out
with a later update.

### Non-goals (YAGNI)
- **Web Vitals** (LCP/CLS/INP) — deferred to a later phase.
- Per-IP rate-limiting on the ingest endpoint — noted as a future add; validation + the cost
  profile make it unnecessary for v1.
- Long-term raw-event retention — raw events expire at 90 days (pre-aggregate later if needed).
- Any third-party analytics provider.

## Architecture & data flow

```
app (rum.js, gated by isOn("rum") AND not opted-out)
   │  batches events in memory
   │  navigator.sendBeacon(JSON)  on visibilitychange→hidden / pagehide / size cap
   ▼
CloudFront  /lagoon/rum*   (same-origin behaviour, like /lagoon/push)
   ▼
Ingest Lambda (aws/lambda-rum, stdlib only — no Docker)
   │  • reads viewer IP + UA + country from CloudFront headers
   │  • visitorId = sha256(secret + UTC-date + ip + ua)[:16]   ← raw IP/UA never stored
   │  • validates (size/count/allowlist) + enriches (device/OS/country)
   │  • writes one NDJSON object per beacon
   ▼
S3  RumBucket/rum/dt=YYYY-MM-DD/<uuid>.ndjson   (lifecycle: expire raw after 90d)
   ▼
Athena  external table (partition projection on dt)  →  queries
```

### Cookieless unique-visitor mechanism (Plausible-style)
The client stores **nothing** — no cookie, no localStorage identifier. The Lambda derives a
daily anonymous visitor id: `sha256(secret + today-UTC-date + client_ip + user_agent)[:16]`.
Because the date is in the hash it **rotates at UTC midnight**, so it counts "unique visitors
per day" without being a durable cross-day tracker. Raw IP and UA are hashed on arrival and
never written. The `secret` (SSM SecureString) prevents reversing the hash. UTC (not London)
is used for rotation so the Lambda needs no `tzdata` dependency; event timestamps are stored
and can be bucketed to London at query time.

## Component 1 — Client collector (`app/js/rum.js`)

No-deps module. **Every public function self-checks `isOn("rum")` and the opt-out, and
no-ops otherwise** — so integration hooks are unconditional one-liners and, with the flag
off, the app behaves exactly as today (additive gating; house rule preserved).

- **Session id:** `crypto.randomUUID()` in memory per page load (groups events within a
  session, lets the server dedupe). Never persisted.
- **Route views:** hook the router `go(route)` in `app.js` → `rum.route(route)` for
  `agenda | account | day | lastminute | settings | login`. The day view sends only `"day"`
  (not the date arg).
- **Session meta (once/session):** `APP_RELEASE`, theme, active discipline, `display-mode:
  standalone` (installed-PWA vs browser), and `document.referrer` on first load. Device/OS
  and country are derived server-side, not sent by the client.
- **Key events:** `notify_enable` / `notify_disable` (subscriber funnel), `login_success`,
  `book_click` (hook the existing `a.bk` handler), `discipline_switch {to}`.
- **Never captured:** no Lagoon user id, names, booking specifics, exact dates, or free text.
- **Batching/transport:** in-memory queue; flush via `navigator.sendBeacon("/lagoon/rum",
  json)` on `visibilitychange→hidden`, `pagehide`, and a ~20-event size cap. One POST per
  flush. Fire-and-forget — no retries, no persisted queue (keeps it storage-free).
- **Payload:** `{v:1, sid, sent:ISO, events:[{t,...}], meta:{...}}`.
- **Integration points (one-liners):** `rum.init()` at boot; `rum.route()` in `go()`;
  `rum.event()` in the notify toggle (`settings.js`), login success (`onLoggedIn`), the
  `a.bk` click handler, and `switchDiscipline`. Add `js/rum.js` to `sw.js` ASSETS + version bump.

## Component 2 — Ingest Lambda (`aws/lambda-rum/handler.py`)

Modelled on `lambda-register` (stdlib only → no Docker build; `Code.fromAsset` directly).
Pure testable core + thin AWS handler.

1. **Dispatch:** POST only (else 405); minimal CORS (same-origin, like register).
2. **Headers:** viewer IP (`cloudfront-viewer-address` / `x-forwarded-for`), `user-agent`,
   `cloudfront-viewer-country`.
3. **Visitor hash:** as above; raw IP/UA discarded immediately; secret from SSM.
4. **Validate** (unauthenticated endpoint): reject payloads > 16 KB; cap ~50 events/request;
   **allowlist** route + event names; coerce props to a known shape; clamp field lengths.
   Off-list input is dropped so junk can't pollute the dataset.
5. **Enrich:** coarse device/OS via UA substring checks (no parser dep); country from header.
6. **Write S3:** one NDJSON object per beacon at `rum/dt=YYYY-MM-DD/<uuid>.ndjson`, one line
   per event: `{ts, dt, visitorId, sid, type, route|name, props, appVersion, theme,
   discipline, standalone, device, os, country}`. `dt` from receive time.

## Component 3 — Storage & queries

- **New S3 bucket** (`RumBucket`) in the `LagoonWatcher` CDK stack, partitioned `dt=YYYY-MM-DD`.
- **Lifecycle:** expire `rum/` objects after 90 days (bounded storage).
- **Athena external table** with **partition projection** on `dt` (date range) — no
  `MSCK`/partition maintenance; results to the existing `athena-results/` location.
- **Queries unlocked:** deduped daily/weekly unique visitors; route popularity; the
  notification funnel (reached Settings → `notify_enable` vs total sessions); installed-PWA vs
  browser split; login conversion; booking-intent clicks; device/OS/country breakdowns.

## Component 4 — Feature flag, rollout & opt-out

- `FEATURES.rum = "internal"` in `config.js`; `isOn("rum")` gates the collector.
- **Lifecycle:** internal → (optional beta) → on, promoted with a later patch (tier value +
  version bump only).
- **Settings opt-out:** an "Anonymous usage analytics" toggle with a reassurance caption —
  e.g. "🍪 No cookies — anonymous, and nothing leaves Hove Lagoon." `rum.js` sends only when
  `isOn("rum")` AND not opted-out; also honour `navigator.doNotTrack === "1"` as auto-opt-out.
  The opt-out is a normal user preference in localStorage (not a tracking identifier).
- **Consent default (survey-fed):** whether the toggle defaults **on (opt-out)** or **off
  (opt-in)** is decided at GA once the WhatsApp survey is in — a one-line default. The build is
  decoupled from this decision.

## Cost (at current volume)

~24k app opens/mo → ~150–250k events/mo. Lambda + CloudFront requests within free tier
(~$0.10 / ~$0.30 without); S3 storage/writes ~$0.35–$1.25/mo; Athena fractions of a cent.
**≈ $0/mo on free tier; ~$1–2/mo worst case.** ~$4–5/mo even at 10× the users. Batching keeps
request counts low; the dev-gated trial generates ~zero volume.

## Testing

- **Lambda pure core** (pytest, no AWS, like `lambda-register`): `visitor_hash` (rotation +
  no raw IP/UA in output), `clean_events` (size/count/allowlist/clamp), `enrich` (device/OS/
  country).
- **Client:** factor the pure queue/payload-build logic so it's node-testable (`node --test`);
  DOM/beacon wiring verified manually.

## Success criteria

- Dev-opted-in: events land in S3; Athena returns route views + a test `notify_enable`;
  `visitorId` dedups within a UTC day and rotates the next; **raw IP/UA never present** in
  stored data.
- Flag off OR opted-out OR DNT: **zero** `/lagoon/rum` beacons sent.

## Deploy touchpoints (coordination, as with push)

1. `cd aws/cdk && npm run deploy` — RumFn + RumBucket + salt SSM (user runs; `cdk deploy` is
   classifier-blocked for the assistant). No Docker (stdlib Lambda).
2. daves-adventures `cdk deploy HugoSiteStack` — adds the `/lagoon/rum*` CloudFront behaviour
   (→ Function URL, caching disabled, viewer-country header enabled). User runs it.
3. App site deploy — ships `rum.js` + the `rum` flag (safe anytime; data flows only once infra
   exists and a user is opted in via the `internal` tier).
