import datetime as dt
import json

import handler as h


def test_visitor_hash_is_16_hex_and_rotates_by_date():
    a = h.visitor_hash("secret", "2026-08-07", "1.2.3.4", "UA")
    b = h.visitor_hash("secret", "2026-08-08", "1.2.3.4", "UA")  # next day
    assert len(a) == 16 and all(c in "0123456789abcdef" for c in a)
    assert a != b                      # rotates daily
    assert a == h.visitor_hash("secret", "2026-08-07", "1.2.3.4", "UA")  # stable within a day


def test_visitor_hash_differs_by_ip_and_secret():
    base = h.visitor_hash("s", "2026-08-07", "1.2.3.4", "UA")
    assert base != h.visitor_hash("s", "2026-08-07", "9.9.9.9", "UA")
    assert base != h.visitor_hash("other", "2026-08-07", "1.2.3.4", "UA")


def test_device_os():
    assert h.device_os("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)") == ("mobile", "iOS")
    assert h.device_os("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)") == ("mobile", "iOS")
    assert h.device_os("Mozilla/5.0 (Linux; Android 14)") == ("mobile", "Android")
    assert h.device_os("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)") == ("desktop", "macOS")
    assert h.device_os("") == ("desktop", "Other")


def test_parse_client_reads_headers_case_insensitively():
    ip, ua, country = h.parse_client({
        "CloudFront-Viewer-Address": "203.0.113.5:51000",
        "User-Agent": "UA/1.0",
        "CloudFront-Viewer-Country": "gb",
    })
    assert ip == "203.0.113.5" and ua == "UA/1.0" and country == "GB"


def test_parse_client_falls_back_to_xff():
    ip, _, _ = h.parse_client({"X-Forwarded-For": "198.51.100.7, 70.0.0.1"})
    assert ip == "198.51.100.7"


def _payload(**kw):
    base = {"sid": "sess-1", "meta": {"ver": "v94", "theme": "dark", "disc": "wake",
            "standalone": True, "ref": "https://wa.me"}, "events": [{"t": "route", "route": "agenda"}]}
    base.update(kw)
    return base


def test_clean_events_happy_path():
    sid, meta, events = h.clean_events(_payload())
    assert sid == "sess-1"
    assert meta["theme"] == "dark" and meta["disc"] == "wake" and meta["standalone"] is True
    assert events == [{"t": "route", "route": "agenda"}]


def test_clean_events_drops_offlist_routes_and_events():
    p = _payload(events=[{"t": "route", "route": "hacker"},
                         {"t": "event", "name": "evil"},
                         {"t": "route", "route": "settings"}])
    sid, meta, events = h.clean_events(p)
    assert events == [{"t": "route", "route": "settings"}]


def test_clean_events_keeps_discipline_switch_to_prop_only():
    p = _payload(events=[{"t": "event", "name": "discipline_switch", "props": {"to": "sup", "x": "drop"}}])
    _, _, events = h.clean_events(p)
    assert events == [{"t": "event", "name": "discipline_switch", "to": "sup"}]


def test_clean_events_none_when_no_valid_events():
    assert h.clean_events(_payload(events=[{"t": "route", "route": "nope"}])) is None
    assert h.clean_events(_payload(events=[])) is None
    assert h.clean_events({"events": [{"t": "route", "route": "agenda"}]}) is None  # no sid
    assert h.clean_events("notadict") is None


def test_clean_events_sanitises_bad_meta_and_caps_count():
    p = _payload(meta={"theme": "rainbow", "disc": "surf", "standalone": "yes", "ver": "x" * 99},
                 events=[{"t": "route", "route": "agenda"}] * 100)
    sid, meta, events = h.clean_events(p)
    assert meta["theme"] is None and meta["disc"] is None and meta["standalone"] is True
    assert len(meta["ver"]) <= 16
    assert len(events) <= h.MAX_EVENTS


NOW = dt.datetime(2026, 8, 7, 12, 0, tzinfo=dt.timezone.utc)
HEADERS = {"CloudFront-Viewer-Address": "203.0.113.5:443", "User-Agent": "Mozilla/5.0 (iPhone)",
           "CloudFront-Viewer-Country": "GB"}


def test_build_records_flattens_events_with_shared_context():
    recs = h.build_records("s1", {"ver": "v94", "theme": "dark", "disc": "wake",
                                  "standalone": True, "ref": None},
                           [{"t": "route", "route": "agenda"},
                            {"t": "event", "name": "discipline_switch", "to": "sup"}],
                           "vid123", "GB", "mobile", "iOS", NOW)
    assert len(recs) == 2
    assert recs[0]["dt"] == "2026-08-07" and recs[0]["visitorId"] == "vid123"
    assert recs[0]["type"] == "route" and recs[0]["route"] == "agenda"
    assert recs[1]["type"] == "event" and recs[1]["name"] == "discipline_switch" and recs[1]["to"] == "sup"
    assert recs[0]["country"] == "GB" and recs[0]["device"] == "mobile" and recs[0]["os"] == "iOS"


def test_ingest_request_end_to_end_no_raw_pii():
    body = json.dumps({"sid": "s1", "meta": {"ver": "v94"}, "events": [{"t": "route", "route": "agenda"}]})
    status, recs = h.ingest_request(body, HEADERS, "secret", NOW)
    assert status == 200 and len(recs) == 1
    blob = json.dumps(recs)
    assert "203.0.113.5" not in blob and "iPhone" not in blob   # raw IP/UA never stored
    assert recs[0]["visitorId"] == h.visitor_hash("secret", "2026-08-07", "203.0.113.5", "Mozilla/5.0 (iPhone)")


def test_ingest_request_rejects_oversize_and_garbage():
    assert h.ingest_request("x" * (h.MAX_BYTES + 1), HEADERS, "s", NOW) == (413, [])
    assert h.ingest_request("not json", HEADERS, "s", NOW) == (400, [])
    assert h.ingest_request(json.dumps({"sid": "s", "events": []}), HEADERS, "s", NOW) == (400, [])
