import datetime as dt
import notify_filter as nf

UTC = dt.timezone.utc


def rec(key, label="Tech 30", start="2026-07-13T17:00:00+00:00", free=1):
    return {"key": key, "label": label, "start": start,
            "startLondon": start[:16], "free": free,
            "book": "https://booking.lagoon.co.uk/book?courseRunId=1"}


def sub(**kw):
    base = {"days": ["Mon"], "types": ["Tech 30"], "travelMins": 30,
            "notifyLog": {}, "pending": []}
    base.update(kw)
    return base


# 2026-07-13 is a Monday. now = Mon 12:00 UTC (13:00 London).
NOW = dt.datetime(2026, 7, 13, 12, 0, tzinfo=UTC)


def test_candidate_passes_all_gates():
    r = rec("1@a", start="2026-07-13T17:00:00+00:00")  # Mon 18:00 London, 5h ahead
    out, state = nf.filter_for_sub(sub(), [r], {}, NOW)
    assert out and out[0]["key"] == "1@a"
    assert state["notifyLog"]["1@a"] == int(NOW.timestamp())


def test_wrong_day_filtered():
    r = rec("1@a", start="2026-07-14T17:00:00+00:00")  # Tuesday
    out, _ = nf.filter_for_sub(sub(days=["Mon"]), [r], {}, NOW)
    assert out is None


def test_wrong_type_filtered():
    out, _ = nf.filter_for_sub(sub(types=["Air 30"]), [rec("1@a")], {}, NOW)
    assert out is None


def test_unreachable_same_day_filtered():
    # slot 20 min away, travel 30 + 15 buffer = 45 needed
    soon = (NOW + dt.timedelta(minutes=20)).isoformat()
    out, _ = nf.filter_for_sub(sub(), [rec("1@a", start=soon)], {}, NOW)
    assert out is None


def test_beyond_horizon_filtered():
    far = "2026-07-25T17:00:00+00:00"  # >7 days
    out, _ = nf.filter_for_sub(sub(days=nf.WEEKDAYS), [rec("1@a", start=far)], {}, NOW)
    assert out is None


def test_dedupe_same_slot_same_day():
    log = {"1@a": int(NOW.timestamp()) - 3600}   # already notified today
    out, _ = nf.filter_for_sub(sub(notifyLog=log), [rec("1@a")], {}, NOW)
    assert out is None


def test_cap_blocks_after_five_pushes_today():
    base = int(NOW.timestamp())
    log = {f"k{i}": base - i * 60 for i in range(5)}   # 5 distinct pushes today
    out, _ = nf.filter_for_sub(sub(notifyLog=log), [rec("1@z")], {}, NOW)
    assert out is None


def test_cooldown_blocks_within_30_min():
    log = {"old": int(NOW.timestamp()) - 600}   # last push 10 min ago
    out, _ = nf.filter_for_sub(sub(notifyLog=log), [rec("1@z")], {}, NOW)
    assert out is None


def test_quiet_hours_holds_then_returns_pending():
    quiet = dt.datetime(2026, 7, 13, 22, 0, tzinfo=UTC)   # 23:00 London — quiet
    r = rec("1@a", start="2026-07-14T18:00:00+00:00")
    out, state = nf.filter_for_sub(sub(days=nf.WEEKDAYS), [r], {}, quiet)
    assert out is None
    assert state["pending"] == ["1@a"]


def test_quiet_delivery_after_0800_if_still_open():
    morning = dt.datetime(2026, 7, 13, 7, 30, tzinfo=UTC)  # 08:30 London — past quiet
    held = rec("1@a", start="2026-07-13T18:00:00+00:00")   # Mon 19:00, still today
    out, state = nf.filter_for_sub(sub(days=nf.WEEKDAYS, pending=["1@a"]),
                                   [], {"1@a": held}, morning)
    assert out and out[0]["key"] == "1@a"
    assert state["pending"] == []


def test_quiet_pending_dropped_if_no_longer_open():
    morning = dt.datetime(2026, 7, 13, 7, 30, tzinfo=UTC)
    out, state = nf.filter_for_sub(sub(days=nf.WEEKDAYS, pending=["1@a"]),
                                   [], {}, morning)  # not in current open set
    assert out is None
    assert state["pending"] == []
