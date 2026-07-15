import json
import handler


def test_sub_id_is_stable_sha256_of_endpoint():
    a = handler.sub_id("https://push.example/abc")
    b = handler.sub_id("https://push.example/abc")
    c = handler.sub_id("https://push.example/xyz")
    assert a == b            # deterministic
    assert a != c            # endpoint-specific
    assert len(a) == 64      # hex sha256


def test_sub_item_extracts_endpoint_and_keys():
    sub = {"endpoint": "https://push.example/abc",
           "keys": {"p256dh": "PUB", "auth": "AUTH"}}
    item = handler.sub_item(sub, now_iso="2026-07-09T12:00:00Z")
    assert item == {
        "subId": handler.sub_id("https://push.example/abc"),
        "endpoint": "https://push.example/abc",
        "p256dh": "PUB",
        "authKey": "AUTH",
        "createdAt": "2026-07-09T12:00:00Z",
        **handler.clean_prefs(None),
    }


def test_parse_request_subscribe_and_unsubscribe():
    sub = {"endpoint": "https://push.example/abc",
           "keys": {"p256dh": "PUB", "auth": "AUTH"}}
    assert handler.parse_request("POST", json.dumps({"subscription": sub})) == \
        ("subscribe", {"subscription": sub, "prefs": None})
    assert handler.parse_request("DELETE", json.dumps({"endpoint": "https://push.example/abc"})) == \
        ("unsubscribe", "https://push.example/abc")


def test_parse_request_rejects_bad_input():
    assert handler.parse_request("POST", "{}")[0] == "error"
    assert handler.parse_request("PATCH", "{}")[0] == "error"
    assert handler.parse_request("POST", "not json")[0] == "error"


def test_parse_request_rejects_malformed_subscription():
    # keys present but missing p256dh/auth -> would have crashed sub_item
    bad_keys = {"subscription": {"endpoint": "https://x", "keys": {"foo": "bar"}}}
    assert handler.parse_request("POST", json.dumps(bad_keys))[0] == "error"
    # non-string endpoint -> would have crashed sub_id
    bad_ep = {"subscription": {"endpoint": 123, "keys": {"p256dh": "a", "auth": "b"}}}
    assert handler.parse_request("POST", json.dumps(bad_ep))[0] == "error"


def test_parse_request_delete_without_endpoint_is_error():
    assert handler.parse_request("DELETE", "{}")[0] == "error"


def test_clean_prefs_defaults_and_validates():
    p = handler.clean_prefs({"days": ["Mon", "Xx", "Sun"], "types": ["Tech 30", "Bogus"],
                             "travelMins": "40"})
    assert p == {"days": ["Mon", "Sun"], "types": ["Tech 30"], "travelMins": 40}


def test_clean_prefs_falls_back_when_missing_or_bad():
    p = handler.clean_prefs(None)
    assert p["days"] == handler.ALL_DAYS and p["types"] == handler.DEFAULT_TYPES
    assert p["travelMins"] == 30
    assert handler.clean_prefs({"travelMins": -5})["travelMins"] == 30  # negative -> default


def test_subscribe_response_echoes_stored_prefs():
    # The echoed prefs are the STORED (validated/stripped) ones, so the client can reconcile.
    sub = {"endpoint": "https://push.example/abc", "keys": {"p256dh": "p", "auth": "a"}}
    item = handler.sub_item(sub, now_iso="2026-07-09T12:00:00Z",
                            prefs={"days": ["Mon", "Xx"], "types": ["Tech 30", "Bogus"], "travelMins": 40})
    body = handler.subscribe_response(item)
    assert body["ok"] is True
    assert body["prefs"] == {"days": ["Mon"], "types": ["Tech 30"], "travelMins": 40}  # unknowns stripped


def test_sub_item_includes_clean_prefs_not_server_state():
    sub = {"endpoint": "https://push.example/abc", "keys": {"p256dh": "P", "auth": "A"}}
    item = handler.sub_item(sub, now_iso="2026-07-13T12:00:00Z",
                            prefs={"days": ["Sat"], "types": ["Air 30"], "travelMins": 20})
    assert item["days"] == ["Sat"] and item["types"] == ["Air 30"] and item["travelMins"] == 20
    assert "notifyLog" not in item and "pending" not in item  # server owns these


def test_parse_request_suppress():
    ep, k = "https://push.example/abc", "50@2026-07-15T15:00:00+00:00"
    body = json.dumps({"suppress": {"endpoint": ep, "key": k}})
    assert handler.parse_request("POST", body) == ("suppress", {"endpoint": ep, "key": k})


def test_parse_request_suppress_malformed_is_error():
    assert handler.parse_request("POST", json.dumps({"suppress": {"endpoint": "x"}}))[0] == "error"  # no key
    assert handler.parse_request("POST", json.dumps({"suppress": "nope"}))[0] == "error"             # not an object
