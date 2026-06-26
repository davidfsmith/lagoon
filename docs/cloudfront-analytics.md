# /lagoon usage — Athena queries over the CloudFront logs

The dave-smith.co.uk CloudFront distribution writes **standard access logs** to S3
(enabled in the `daves-adventures` infra). These queries read those logs in **Athena**
and filter to the **`/lagoon`** app. They're server-side, aggregate, read-only —
no cookies, no consent banner.

## Setup (once)

1. **Find the log bucket** — it's the CloudFront log bucket created by the
   daves-adventures site stack (prefix `cloudfront/`). e.g. `aws s3 ls | grep -i log`,
   or check the site stack's resources. Put its name in the `LOCATION` below.
2. In Athena, pick (or set) a **query-result location** and run in the **same region**
   you query from (Athena is regional; the S3 bucket can be anywhere).
3. Run the `CREATE EXTERNAL TABLE` below once, then the queries.

> ⚠️ **Privacy:** `c_ip` (client IP) is personal data. Use it only for aggregate
> operational stats, keep the log bucket's retention short (the stack sets a lifecycle
> expiry), and don't export raw IPs. These are server logs under legitimate interest —
> separate from the RUM/consent question.

## Create the table

CloudFront standard log schema (33 tab-separated fields; 2 header lines skipped).
Replace `<LOG_BUCKET>` (and the prefix if different):

```sql
CREATE EXTERNAL TABLE IF NOT EXISTS cloudfront_logs (
  `date` DATE,
  time STRING,
  x_edge_location STRING,
  sc_bytes BIGINT,
  c_ip STRING,
  cs_method STRING,
  cs_host STRING,
  cs_uri_stem STRING,
  sc_status INT,
  cs_referrer STRING,
  cs_user_agent STRING,
  cs_uri_query STRING,
  cs_cookie STRING,
  x_edge_result_type STRING,
  x_edge_request_id STRING,
  x_host_header STRING,
  cs_protocol STRING,
  cs_bytes BIGINT,
  time_taken FLOAT,
  x_forwarded_for STRING,
  ssl_protocol STRING,
  ssl_cipher STRING,
  x_edge_response_result_type STRING,
  cs_protocol_version STRING,
  fle_status STRING,
  fle_encrypted_fields INT,
  c_port INT,
  time_to_first_byte FLOAT,
  x_edge_detailed_result_type STRING,
  sc_content_type STRING,
  sc_content_len BIGINT,
  sc_range_start BIGINT,
  sc_range_end BIGINT
)
ROW FORMAT DELIMITED
FIELDS TERMINATED BY '\t'
LOCATION 's3://<LOG_BUCKET>/cloudfront/'
TBLPROPERTIES ('skip.header.line.count'='2');
```

Times are **UTC**. `.gz` files are read automatically.

## How to read these (important)

The app is a **single-page app**: it loads the shell (`/lagoon/` → `index.html`)
once, then routes client-side. Its data calls go to `api.lagoon.co.uk` — a
**different host**, so they are **not** in these logs. So the logs show shell loads,
JS/CSS/icon fetches, `sw.js`, `manifest.json`. The best proxy for **"someone opened
the app"** is a request for the shell. In-app navigation (Availability ↔ Bookings)
is *not* separate server requests.

A handy filter to reuse: `cs_uri_stem LIKE '/lagoon%'` (all app traffic), and for
"opens" the shell-only set below.

---

## Queries

### App opens per day (best "visits" proxy)

```sql
SELECT date AS day,
       COUNT(*)            AS app_opens,
       COUNT(DISTINCT c_ip) AS distinct_ips
FROM cloudfront_logs
WHERE cs_uri_stem IN ('/lagoon/', '/lagoon', '/lagoon/index.html')
  AND cs_method = 'GET'
  AND sc_status = 200
GROUP BY date
ORDER BY day DESC;
```

### All /lagoon traffic per day (request volume)

```sql
SELECT date AS day,
       COUNT(*)            AS requests,
       COUNT(DISTINCT c_ip) AS distinct_ips
FROM cloudfront_logs
WHERE cs_uri_stem LIKE '/lagoon%'
GROUP BY date
ORDER BY day DESC;
```

### Distinct visitors in the last 7 days (rough)

```sql
SELECT COUNT(DISTINCT c_ip) AS distinct_ips_7d
FROM cloudfront_logs
WHERE cs_uri_stem LIKE '/lagoon%'
  AND date >= current_date - interval '7' day;
```

### Busiest hours (UTC)

```sql
SELECT substr(time, 1, 2) AS hour_utc,
       COUNT(*)            AS requests
FROM cloudfront_logs
WHERE cs_uri_stem LIKE '/lagoon%'
GROUP BY substr(time, 1, 2)
ORDER BY hour_utc;
```

### Top paths under /lagoon

```sql
SELECT cs_uri_stem, COUNT(*) AS hits
FROM cloudfront_logs
WHERE cs_uri_stem LIKE '/lagoon%'
GROUP BY cs_uri_stem
ORDER BY hits DESC
LIMIT 50;
```

### Errors (4xx / 5xx) — catch breakage

```sql
SELECT sc_status, cs_uri_stem, COUNT(*) AS n
FROM cloudfront_logs
WHERE cs_uri_stem LIKE '/lagoon%'
  AND sc_status >= 400
GROUP BY sc_status, cs_uri_stem
ORDER BY n DESC;
```

### Device / OS split (from the User-Agent on shell loads)

```sql
SELECT CASE
         WHEN cs_user_agent LIKE '%iPhone%'    THEN 'iPhone'
         WHEN cs_user_agent LIKE '%iPad%'      THEN 'iPad'
         WHEN cs_user_agent LIKE '%Android%'   THEN 'Android'
         WHEN cs_user_agent LIKE '%Macintosh%' THEN 'Mac'
         WHEN cs_user_agent LIKE '%Windows%'   THEN 'Windows'
         ELSE 'Other'
       END                  AS device,
       COUNT(*)             AS requests,
       COUNT(DISTINCT c_ip) AS distinct_ips
FROM cloudfront_logs
WHERE cs_uri_stem IN ('/lagoon/', '/lagoon', '/lagoon/index.html')
GROUP BY 1
ORDER BY requests DESC;
```

### Cache hit ratio (performance sanity)

```sql
SELECT x_edge_result_type, COUNT(*) AS n
FROM cloudfront_logs
WHERE cs_uri_stem LIKE '/lagoon%'
GROUP BY x_edge_result_type
ORDER BY n DESC;
```

### Rough geography (nearest edge POP — approximate!)

```sql
SELECT substr(x_edge_location, 1, 3) AS edge_pop, COUNT(*) AS requests
FROM cloudfront_logs
WHERE cs_uri_stem LIKE '/lagoon%'
GROUP BY substr(x_edge_location, 1, 3)
ORDER BY requests DESC;
```

> `x_edge_location` is the **CloudFront edge** that served the request (e.g. `LHR`≈London,
> `MAN`≈Manchester, `DUB`≈Dublin) — a *hint* at where users are, not their actual country.
> CloudFront standard logs don't include a country field; for real geo you'd add a
> GeoIP lookup on `c_ip` or enable RUM.

### Top referrers (how people arrive)

```sql
SELECT cs_referrer, COUNT(*) AS n
FROM cloudfront_logs
WHERE cs_uri_stem LIKE '/lagoon%'
  AND cs_referrer <> '-'
GROUP BY cs_referrer
ORDER BY n DESC
LIMIT 25;
```

### Which app version is being served (cache-busting sanity)

```sql
SELECT cs_uri_stem, COUNT(*) AS hits
FROM cloudfront_logs
WHERE cs_uri_stem = '/lagoon/sw.js'
GROUP BY cs_uri_stem;
```

---

## Notes & limits

- **Volume is tiny**, so a non-partitioned table is fine. If traffic grows a lot,
  move to partitioned logs / CloudFront standard logging v2 to keep scans cheap
  (Athena bills per data scanned).
- **No in-app page views**: client-side route changes aren't server requests; only
  the initial shell load is. For per-screen analytics you'd need RUM (deferred).
- **No API calls here**: availability/booking calls go to `api.lagoon.co.uk`, off this
  distribution.
- For client-side **JS errors / web vitals**, that's the parked **CloudWatch RUM +
  opt-in consent banner** step.
