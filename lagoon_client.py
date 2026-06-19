"""Reusable client for the (undocumented, public) Lagoon Watersports booking API.

The booking site at https://booking.lagoon.co.uk is an Angular SPA that talks to a
public REST API at https://api.lagoon.co.uk. The endpoints used here need no auth –
they are the same ones the public booking calendar consumes.

Endpoints of interest
---------------------
GET /public/courses?name=<text>          search the course catalogue
    also: ?id=<id>  ?salesCategory=<id>  ?itemsPerPage=<n>  ?page=<n>
GET /public/courseRuns?course=<id>       every dated session for a course,
                                         sorted ascending from *today*.
    Each run: { startDate, endDate, maxNumbers, participantsCount, ... }
    free spaces = maxNumbers - participantsCount

Notes / gotchas
---------------
* Date-range query params (from/to/dateFrom/...) are IGNORED by the server – it
  always returns sessions from today forward, so date filtering is done here.
* Results are date-sorted ascending, so pagination can stop early once we pass
  the horizon we care about.
* This is an internal API and may change without notice. Resolve course IDs by
  name at runtime (see resolve_courses) rather than hard-coding them, so a
  re-numbering on their side fails loudly instead of silently.
"""

from __future__ import annotations

import datetime as _dt
import json as _json
import pathlib as _pl
import urllib.parse as _url
import urllib.request as _req
from dataclasses import dataclass
from zoneinfo import ZoneInfo

# The API serialises session times as UTC (+00:00 even in summer). Sessions are
# displayed/grouped in UK local time (what the booking site shows), so convert.
LONDON = ZoneInfo("Europe/London")

API_BASE = "https://api.lagoon.co.uk"
USER_AGENT = "lagoon-availability/0.1 (personal availability checker)"
TIMEOUT = 30


def _get(path: str, **params) -> dict:
    """GET <API_BASE>/<path>?<params> and return parsed JSON."""
    qs = _url.urlencode({k: v for k, v in params.items() if v is not None})
    url = f"{API_BASE}/{path}" + (f"?{qs}" if qs else "")
    request = _req.Request(url, headers={"User-Agent": USER_AGENT})
    with _req.urlopen(request, timeout=TIMEOUT) as resp:
        return _json.load(resp)


# --------------------------------------------------------------------------- #
# Course catalogue
# --------------------------------------------------------------------------- #

def _norm(s: str) -> str:
    """Collapse internal whitespace and lower-case, for tolerant name matching.

    Catalogue names have inconsistent spacing ('2026  Wakeboard', leading spaces),
    so we never compare raw strings.
    """
    return " ".join(s.split()).lower()


def load_monitor(config_path) -> list[dict]:
    """Read courses.json and return only the *enabled* monitor specs.

    A spec with "enabled": false is kept in the file but skipped here, so
    collecting/alerting on a session type is an opt-in toggle (defaults to true
    when the key is absent).
    """
    data = _json.loads(_pl.Path(config_path).read_text())
    return [c for c in data.get("monitor", []) if c.get("enabled", True)]


def search_courses(name: str) -> list[dict]:
    """Return catalogue entries whose name matches `name` (substring, server-side)."""
    return _get("public/courses", name=name, itemsPerPage=100).get("data", [])


# Catalogue is littered with disabled decoys we must never resolve to.
_EXCLUDE_MARKERS = ("do not use", "di not use", "test", "closed", "no bookings")


def resolve_courses(specs: list[dict]) -> list[dict]:
    """Resolve a list of monitor specs to live course IDs by tolerant name match.

    Each spec is {"search": "<distinctive substring>", "label": "<short label>"}.
    Matching is whitespace-insensitive and skips disabled decoys ("DO NOT USE",
    "test", "closed", ...). Raises if a search resolves to zero or >1 live course
    – a loud failure beats silently watching the wrong (or no) sessions.
    """
    resolved = []
    for spec in specs:
        term = _norm(spec["search"])
        matches = [
            c for c in search_courses(spec["search"])
            if term in _norm(c["name"])
            and not any(m in _norm(c["name"]) for m in _EXCLUDE_MARKERS)
        ]
        if not matches:
            raise LookupError(f"No live course matches search {spec['search']!r}")
        if len(matches) > 1:
            names = [f"{c['id']}:{c['name']!r}" for c in matches]
            raise LookupError(
                f"Search {spec['search']!r} is ambiguous, matched {len(matches)}: {names}"
            )
        course = matches[0]
        resolved.append({
            "id": course["id"],
            "label": spec.get("label", course["name"]),
            "name": course["name"],
            "price": course.get("price"),
            "maxNumbers": course.get("maxNumbers"),
        })
    return resolved


# --------------------------------------------------------------------------- #
# Availability
# --------------------------------------------------------------------------- #

@dataclass(frozen=True)
class Slot:
    course_id: int
    label: str
    start: _dt.datetime
    end: _dt.datetime
    free: int
    capacity: int
    run_id: int = 0  # courseRun id (for the booking deep-link)

    @property
    def local(self) -> _dt.datetime:
        """Session start in Europe/London (for display and weekday checks)."""
        return self.start.astimezone(LONDON)

    @property
    def is_weekend(self) -> bool:
        return self.local.weekday() >= 5  # Sat=5, Sun=6 (London)

    @property
    def key(self) -> str:
        """Stable identity for diffing across runs (kept in the API's UTC form)."""
        return f"{self.course_id}@{self.start.isoformat()}"

    def as_dict(self) -> dict:
        return {
            "course_id": self.course_id,
            "label": self.label,
            "start": self.start.isoformat(),
            "end": self.end.isoformat(),
            "free": self.free,
            "capacity": self.capacity,
            "run_id": self.run_id,
            "weekend": self.is_weekend,
            "key": self.key,
        }


def fetch_openings(
    course_id: int,
    label: str,
    days_ahead: int = 21,
    now: _dt.datetime | None = None,
) -> list[Slot]:
    """Return upcoming Slots for one course that have at least one free space."""
    now = now or _dt.datetime.now(_dt.timezone.utc)
    horizon = now + _dt.timedelta(days=days_ahead)
    out: list[Slot] = []
    page = 1
    while True:
        data = _get("public/courseRuns", course=course_id, itemsPerPage=100, page=page)
        meta = data.get("meta", {})
        runs = data.get("data", [])
        for run in runs:
            start = _dt.datetime.fromisoformat(run["startDate"])
            if start < now:
                continue
            if start > horizon:
                return out  # ascending order → nothing later matters
            free = run["maxNumbers"] - run["participantsCount"]
            if free > 0:
                out.append(Slot(
                    course_id=course_id,
                    label=label,
                    start=start,
                    end=_dt.datetime.fromisoformat(run["endDate"]),
                    free=free,
                    capacity=run["maxNumbers"],
                    run_id=run["id"],
                ))
        if not runs or page * meta.get("itemsPerPage", 10) >= meta.get("filteredCount", 0):
            break
        page += 1
    return out


def find_openings(
    courses: list[dict],
    days_ahead: int = 21,
    weekend_only: bool = False,
    now: _dt.datetime | None = None,
) -> list[Slot]:
    """Aggregate openings across several resolved courses, sorted by start time."""
    slots: list[Slot] = []
    for course in courses:
        slots.extend(fetch_openings(course["id"], course["label"], days_ahead, now))
    if weekend_only:
        slots = [s for s in slots if s.is_weekend]
    slots.sort(key=lambda s: (s.start, s.label))
    return slots


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
