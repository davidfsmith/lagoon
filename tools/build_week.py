#!/usr/bin/env python3
"""Build a static week-availability page from the app's saved cache.

When the Lagoon site/API is down, the PWA's localStorage cache (key `lagoon.cache`)
still holds the last successful full agenda — every day, every session type, with
free counts. This bakes the AVAILABILITY ONLY into a self-contained static page
(no JS, no API) for the Lagoon staff. Personal data in the cache (names, bookings,
membership) is ignored — only `data.agenda[].slots` (course/time/free) is read.

    pbpaste > /tmp/lagoon_cache.json     # the pasted cache JSON
    python3 tools/build_week.py /tmp/lagoon_cache.json --from 2026-06-21 > app/week.html

Args: <cache-json>  [--from YYYY-MM-DD]  [--days N]
"""
from __future__ import annotations

import argparse
import datetime as _dt
import html
import json
import sys
from zoneinfo import ZoneInfo

LONDON = ZoneInfo("Europe/London")

# Display order + capacity for the labels the watcher/app use.
ORDER = ["Air 30", "Tech 30", "Air 15", "Tech 15", "Taster", "Jam", "Drop-in"]
RANK = {label: i for i, label in enumerate(ORDER)}


def london(iso: str) -> _dt.datetime:
    return _dt.datetime.fromisoformat(iso).astimezone(LONDON)


def day_rows(day: dict):
    """Slots for one agenda day -> list of {time,label,free,cap}, sorted."""
    out = []
    for s in day.get("slots", []):
        free = int(s.get("free", 0))
        if free <= 0:
            continue
        out.append({
            "time": london(s["start"]).strftime("%H:%M"),
            "label": s.get("label", "?"),
            "free": free,
            "cap": int(s.get("capacity", 0)),
        })
    out.sort(key=lambda r: (r["time"], RANK.get(r["label"], 99)))
    return out


def render(days, snapshot_local):
    blocks = []
    grand = 0
    for day in days:
        d = _dt.date.fromisoformat(day["date"])
        rows = day_rows(day)
        if not rows:
            continue
        grand += sum(r["free"] for r in rows)
        wknd = ' <span class="wk">WEEKEND</span>' if day.get("weekend") else ""
        w = day.get("summary") or {}
        wx = ""
        if w and w.get("tMax") is not None:
            wx = (f'{round(w["tMin"])}–{round(w["tMax"])}° · '
                  f'rain {w.get("precipProb", 0)}% · wind {round(w.get("windMax", 0))} '
                  f'(gust {round(w.get("gustMax", 0))})')
        cells = "\n".join(
            f'        <div class="row"><div class="t">{r["time"]}</div>'
            f'<div class="l">{html.escape(r["label"])}</div>'
            f'<div class="f"><b>{r["free"]}</b>/{r["cap"]}</div></div>'
            for r in rows)
        blocks.append(
            f'''    <section class="day">
      <h2>{d.strftime("%A %-d %B")}{wknd}<span class="n">{len(rows)} w/ space</span></h2>
      {f'<p class="wx">{wx}</p>' if wx else ''}
{cells}
    </section>''')

    body = "\n".join(blocks) or '<p class="muted">No availability in the snapshot.</p>'
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hove Lagoon — week availability</title>
<style>
  :root{{color-scheme:dark}}
  *{{box-sizing:border-box}}
  body{{margin:0;background:#0d0d0d;color:#e8eaed;
    font-family:-apple-system,Roboto,system-ui,sans-serif;line-height:1.5}}
  .wrap{{max-width:620px;margin:0 auto;padding:20px 16px 60px}}
  h1{{font-size:22px;margin:0 0 2px}} h1 .a{{color:#2dd4bf}}
  .sub{{color:#9aa0a6;font-size:14px;margin:0 0 16px}}
  .banner{{background:#3a2a12;color:#fbbf24;font-size:13px;border-radius:10px;
    padding:10px 12px;margin-bottom:20px}}
  .day{{margin:0 0 22px}}
  .day h2{{font-size:16px;margin:0 0 4px;display:flex;align-items:center;gap:10px}}
  .day h2 .n{{margin-left:auto;font-weight:400;font-size:12px;color:#9aa0a6}}
  .wk{{background:#2dd4bf;color:#06251f;font-size:10px;font-weight:700;
    letter-spacing:.04em;padding:1px 7px;border-radius:5px}}
  .wx{{color:#9aa0a6;font-size:12px;margin:0 0 8px}}
  .row{{display:flex;align-items:center;gap:12px;background:#16181c;border-radius:10px;
    padding:8px 12px;margin-bottom:6px}}
  .row .t{{font-weight:700;min-width:48px}}
  .row .l{{flex:1;color:#cfeee7}}
  .row .f{{color:#34d399;font-size:13px;white-space:nowrap}} .row .f b{{font-size:15px}}
  .note{{color:#9aa0a6;font-size:12px;margin-top:8px}}
  .note ul{{padding-left:18px;margin:6px 0}}
</style>
</head>
<body>
  <div class="wrap">
    <h1>🏄 <span class="a">Hove Lagoon</span> — availability</h1>
    <p class="sub">Ride the Cables &amp; sessions · {grand} place(s) free across the week</p>

    <div class="banner">⚠ <b>Snapshot</b>, not live. Captured <b>{html.escape(snapshot_local)}</b>,
      just before the booking system went offline. Newer bookings won’t show.</div>

{body}

    <div class="note">
      Source: the Hove Lagoon app’s last saved data before the outage.
      <ul>
        <li>Every listed session had at least one space at snapshot time.</li>
        <li>Sessions already full are not listed. Times are UK local.</li>
        <li>Free shown as <b>free/capacity</b> (e.g. 2/2 = empty, 1/2 = one space taken).</li>
      </ul>
    </div>
  </div>
</body>
</html>
'''


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("cache")
    ap.add_argument("--from", dest="frm", default=None, help="first date YYYY-MM-DD")
    ap.add_argument("--days", type=int, default=None, help="number of days to include")
    args = ap.parse_args(argv[1:])

    cache = json.load(open(args.cache))
    agenda = (cache.get("data") or {}).get("agenda") or cache.get("agenda") or []

    frm = args.frm or min((d["date"] for d in agenda), default="0000-00-00")
    days = [d for d in agenda if d["date"] >= frm]
    if args.days is not None:
        end = (_dt.date.fromisoformat(frm) + _dt.timedelta(days=args.days)).isoformat()
        days = [d for d in days if d["date"] < end]
    days.sort(key=lambda d: d["date"])

    at_ms = cache.get("at")
    if at_ms:
        snap = _dt.datetime.fromtimestamp(at_ms / 1000, LONDON)
        tz = "BST" if snap.dst() else "GMT"
        snapshot = snap.strftime(f"%-d %b %Y, %H:%M {tz}")
    else:
        snapshot = "unknown time"

    sys.stdout.write(render(days, snapshot))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
