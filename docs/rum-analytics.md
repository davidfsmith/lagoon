# RUM analytics (first-party) — Athena

Raw events: `s3://<RumBucket>/rum/dt=YYYY-MM-DD/*.ndjson` (one JSON object per line).
Query in Athena (eu-west-1, database `default`; results → the existing
`s3://dave-smith-co-uk-cf-logs/athena-results/`). See [[lagoon-cloudfront-analytics]].

## One-time: create the table (partition projection — no MSCK needed)

```sql
CREATE EXTERNAL TABLE rum_events (
  ts string, visitorId string, sid string, type string,
  route string, name string, `to` string,
  ver string, theme string, disc string, standalone boolean, ref string,
  country string, device string, os string
)
PARTITIONED BY (dt string)
ROW FORMAT SERDE 'org.openx.data.jsonserde.JsonSerDe'
LOCATION 's3://<RumBucket>/rum/'
TBLPROPERTIES (
  'projection.enabled'='true',
  'projection.dt.type'='date',
  'projection.dt.format'='yyyy-MM-dd',
  'projection.dt.range'='2026-08-01,NOW',
  'projection.dt.interval'='1',
  'projection.dt.interval.unit'='DAYS',
  'storage.location.template'='s3://<RumBucket>/rum/dt=${dt}/'
);
```

## Queries

```sql
-- Unique visitors + sessions per day (deduped, not fuzzy IPs)
SELECT dt, count(DISTINCT visitorId) AS visitors, count(DISTINCT sid) AS sessions
FROM rum_events WHERE dt >= date_format(current_date - interval '30' day, '%Y-%m-%d')
GROUP BY dt ORDER BY dt;

-- Route popularity (the in-app navigation CloudFront can't see)
SELECT route, count(*) AS views FROM rum_events
WHERE type='route' AND dt >= date_format(current_date - interval '7' day, '%Y-%m-%d')
GROUP BY route ORDER BY views DESC;

-- Notification funnel: reached Settings -> enabled, vs sessions
SELECT
  count(DISTINCT sid) FILTER (WHERE type='route' AND route='settings') AS reached_settings,
  count(DISTINCT sid) FILTER (WHERE name='notify_enable') AS enabled,
  count(DISTINCT sid) AS sessions
FROM rum_events WHERE dt >= date_format(current_date - interval '30' day, '%Y-%m-%d');

-- Installed-PWA vs browser, device/OS, country
SELECT standalone, device, os, count(DISTINCT sid) AS sessions
FROM rum_events GROUP BY standalone, device, os ORDER BY sessions DESC;
```

(Replace `<RumBucket>` with the deployed bucket name from the `LagoonWatcher` stack outputs.)
