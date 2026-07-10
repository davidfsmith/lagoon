import datetime as dt

import push
import handler


def _rec(label="Tech", start="2026-07-12T18:00", free=2, key="k1"):
    return {"key": key, "label": label, "startLondon": start,
            "start": start + ":00+00:00", "free": free,
            "book": "https://booking.lagoon.co.uk/book?courseRunId=1"}


def test_build_payload_single():
    p = push.build_payload([_rec()])
    assert p["title"] == "A spot opened at Hove Lagoon"
    assert "Tech" in p["body"] and "18:00" in p["body"]
    assert p["url"].endswith("/lagoon/")


def test_build_payload_coalesces_count():
    p = push.build_payload([_rec(), _rec(start="2026-07-12T19:00")])
    assert "2 spots" in p["body"]


def test_build_payload_carries_deeplink_target_single():
    p = push.build_payload([_rec(start="2026-07-13T18:00")])
    assert p["date"] == "2026-07-13"
    assert p["key"] == "k1"


def test_build_payload_deeplink_targets_earliest_slot():
    early = _rec(key="kA", start="2026-07-12T17:00")
    late = _rec(key="kB", start="2026-07-14T19:00")
    p = push.build_payload([late, early])   # unordered input
    assert p["date"] == "2026-07-12" and p["key"] == "kA"


def test_send_all_posts_each_and_drops_410():
    subs = [
        {"subId": "a", "endpoint": "e1", "p256dh": "k1", "authKey": "x1"},
        {"subId": "b", "endpoint": "e2", "p256dh": "k2", "authKey": "x2"},
    ]
    sent, gone = [], []

    class Gone(Exception):
        def __init__(self):
            self.response = type("R", (), {"status_code": 410})()

    def poster(sub_info, data, vapid_private_key, vapid_claims):
        sent.append(sub_info["endpoint"])
        if sub_info["endpoint"] == "e2":
            raise Gone()

    dead = push.send_all(subs, {"title": "t"}, "PEM", "mailto:x@y.z",
                         poster=poster, on_gone=lambda s: gone.append(s["subId"]))
    assert sent == ["e1", "e2"]
    assert dead == ["b"] and gone == ["b"]


def test_send_all_logs_other_errors_without_marking_dead():
    subs = [{"subId": "a", "endpoint": "e1", "p256dh": "k", "authKey": "x"},
            {"subId": "b", "endpoint": "e2", "p256dh": "k", "authKey": "x"}]
    sent = []

    class Boom(Exception):  # non-HTTP error, no .response
        pass

    def poster(sub_info, data, vapid_private_key, vapid_claims):
        sent.append(sub_info["endpoint"])
        if sub_info["endpoint"] == "e1":
            raise Boom()

    dead = push.send_all(subs, {"title": "t"}, "PEM", "mailto:x@y.z", poster=poster)
    assert sent == ["e1", "e2"]  # loop continued past the transient error
    assert dead == []            # a non-410 error is NOT "gone"


def test_run_calls_send_when_releases_found():
    now = dt.datetime(2026, 7, 10, 12, 0, tzinfo=dt.timezone.utc)

    class Slot:
        key = "1@x"; label = "Tech"; course_id = 1; run_id = 9
        free = 2; capacity = 6
        start = dt.datetime(2026, 7, 11, 17, 0, tzinfo=dt.timezone.utc)
        local = dt.datetime(2026, 7, 11, 18, 0)

    calls = []
    handler.run(
        read_state=lambda: {},                       # prev free = 0 for our key
        write_state=lambda free: None,
        courses=[], now=now, urgent_hours=48, horizon_days=14,
        find_openings=lambda *a, **k: [Slot()],
        send=lambda records, slots, when: calls.append(records),
    )
    assert len(calls) == 1 and calls[0][0]["label"] == "Tech"


def test_release_record_includes_utc_start():
    import datetime as dt
    import handler

    class Slot:
        key = "50@2026-07-12T17:00:00+00:00"; label = "Tech 30"; course_id = 50; run_id = 9
        free = 1; capacity = 2
        start = dt.datetime(2026, 7, 12, 17, 0, tzinfo=dt.timezone.utc)
        local = dt.datetime(2026, 7, 12, 18, 0)

    r = handler.release_record(Slot(), dt.datetime(2026, 7, 10, 12, 0, tzinfo=dt.timezone.utc))
    assert r["start"] == "2026-07-12T17:00:00+00:00"   # absolute UTC, for later reachability
    assert r["startLondon"] == "2026-07-12T18:00"       # unchanged display field


def test_run_detects_all_days_within_horizon():
    import datetime as dt
    import handler
    captured = {}

    def fake_find(courses, days_ahead, weekend_only, now):
        captured["days_ahead"] = days_ahead
        captured["weekend_only"] = weekend_only
        return []

    handler.run(read_state=lambda: {}, write_state=lambda f: None, courses=[],
                now=dt.datetime(2026, 7, 10, 12, 0, tzinfo=dt.timezone.utc),
                urgent_hours=168, horizon_days=7, find_openings=fake_find)
    assert captured["days_ahead"] == 7
    assert captured["weekend_only"] is False


def test_run_passes_slots_and_now_to_send():
    import datetime as dt
    import handler
    now = dt.datetime(2026, 7, 13, 12, 0, tzinfo=dt.timezone.utc)

    class Slot:
        key = "50@2026-07-13T17:00:00+00:00"; label = "Tech 30"; course_id = 50
        run_id = 9; free = 1; capacity = 2
        start = dt.datetime(2026, 7, 13, 17, 0, tzinfo=dt.timezone.utc)
        local = dt.datetime(2026, 7, 13, 18, 0)

    got = {}
    handler.run(read_state=lambda: {}, write_state=lambda f: None, courses=[],
                now=now, urgent_hours=168, horizon_days=7,
                find_openings=lambda *a, **k: [Slot()],
                send=lambda records, slots, when: got.update(
                    records=records, slots=slots, when=when))
    assert got["records"][0]["key"] == Slot.key
    assert got["slots"][0].key == Slot.key      # full current open set passed
    assert got["when"] == now
