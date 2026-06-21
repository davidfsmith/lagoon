#!/usr/bin/env python3
"""Build a static availability snapshot page from the watcher's S3 state.

When the Lagoon site/API is down, the watcher's last successful S3 write still
holds the free-count for each upcoming weekend session. This bakes that into a
self-contained HTML page (no JS, no API) the Lagoon staff can view to see what
availability existed just before the outage.

    aws s3 cp s3://<StateBucket>/state/free.json /tmp/free.json
    python3 tools/build_snapshot.py /tmp/free.json 2026-06-21 "20 Jun 2026, 18:10 BST" > app/sunday.html

Args: <state-json> <YYYY-MM-DD date to show> <human snapshot time>
The state maps "<courseId>@<startISO-UTC>" -> free count (weekend sessions with
free>0, written by the watcher). Times are converted to Europe/London.
"""
import datetime
import html
import json
import sys
from zoneinfo import ZoneInfo

LONDON = ZoneInfo("Europe/London")
LABEL = {"50": "Tech 30", "51": "Air 30"}  # the watcher's monitored ride sessions
CAP = 2  # Ride Session 30 capacity


def rows_for(state, date):
    out = []
    for key, free in state.items():
        cid, start = key.split("@")
        if start[:10] != date or cid not in LABEL:
            continue
        local = datetime.datetime.fromisoformat(start).astimezone(LONDON)
        out.append({"time": local.strftime("%H:%M"), "label": LABEL[cid],
                    "free": int(free), "cap": CAP})
    out.sort(key=lambda r: (r["time"], r["label"]))
    return out


def render(rows, date, snapshot):
    d = datetime.date.fromisoformat(date)
    pretty = d.strftime("%A %-d %B %Y")
    total_free = sum(r["free"] for r in rows)
    cards = "\n".join(
        f'''      <div class="row">
        <div class="t">{r["time"]}</div>
        <div class="l">{html.escape(r["label"])}</div>
        <div class="f"><b>{r["free"]}</b> of {r["cap"]} free</div>
      </div>''' for r in rows) or '      <p class="muted">No sessions with availability in the snapshot.</p>'

    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hove Lagoon — availability snapshot ({html.escape(pretty)})</title>
<style>
  :root{{color-scheme:dark}}
  *{{box-sizing:border-box}}
  body{{margin:0;background:#0d0d0d;color:#e8eaed;
    font-family:-apple-system,Roboto,system-ui,sans-serif;line-height:1.5}}
  .wrap{{max-width:560px;margin:0 auto;padding:20px 16px 60px}}
  h1{{font-size:22px;margin:0 0 2px}} h1 .a{{color:#2dd4bf}}
  .sub{{color:#9aa0a6;font-size:14px;margin:0 0 16px}}
  .banner{{background:#3a2a12;color:#fbbf24;font-size:13px;border-radius:10px;
    padding:10px 12px;margin-bottom:16px}}
  .lbl{{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#9aa0a6;margin:0 0 8px}}
  .row{{display:flex;align-items:center;gap:12px;background:#16181c;border-radius:12px;
    padding:12px;margin-bottom:8px}}
  .row .t{{font-weight:700;font-size:16px;min-width:52px}}
  .row .l{{flex:1;color:#cfeee7}}
  .row .f{{color:#34d399;font-size:13px;white-space:nowrap}} .row .f b{{font-size:15px}}
  .note{{color:#9aa0a6;font-size:12px;margin-top:18px}}
  .note ul{{padding-left:18px;margin:6px 0}}
</style>
</head>
<body>
  <div class="wrap">
    <h1>🏄 <span class="a">Hove Lagoon</span> — availability</h1>
    <p class="sub">Ride the Cables · {html.escape(pretty)}</p>

    <div class="banner">⚠ <b>Snapshot</b>, not live. Captured <b>{html.escape(snapshot)}</b>,
      just before the booking system went offline. Newer bookings won’t show.</div>

    <div class="lbl">{len(rows)} session(s) with space · {total_free} place(s) free</div>
{cards}

    <div class="note">
      Source: an automated availability watcher that reads the public booking API
      every 10 minutes; this is its last good read before the outage.
      <ul>
        <li>Only <b>Tech 30</b> and <b>Air 30</b> ride sessions are shown.</li>
        <li>Sessions that were already full at snapshot time are not listed.</li>
        <li>Times are UK local. Capacity is 2 riders per 30-min session.</li>
      </ul>
    </div>
  </div>
</body>
</html>
'''


def main(argv):
    state = json.load(open(argv[1]))
    date = argv[2]
    snapshot = argv[3]
    sys.stdout.write(render(rows_for(state, date), date, snapshot))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
