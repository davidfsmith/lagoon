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
        "auth": "AUTH",
        "createdAt": "2026-07-09T12:00:00Z",
    }


def test_parse_request_subscribe_and_unsubscribe():
    sub = {"endpoint": "https://push.example/abc",
           "keys": {"p256dh": "PUB", "auth": "AUTH"}}
    assert handler.parse_request("POST", json.dumps({"subscription": sub})) == ("subscribe", sub)
    assert handler.parse_request("DELETE", json.dumps({"endpoint": "https://push.example/abc"})) == \
        ("unsubscribe", "https://push.example/abc")


def test_parse_request_rejects_bad_input():
    assert handler.parse_request("POST", "{}")[0] == "error"
    assert handler.parse_request("PATCH", "{}")[0] == "error"
    assert handler.parse_request("POST", "not json")[0] == "error"
