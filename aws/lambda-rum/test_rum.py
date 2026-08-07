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
