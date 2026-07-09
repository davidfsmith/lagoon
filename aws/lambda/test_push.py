import push


def _rec(label="Tech", start="2026-07-12T18:00", free=2):
    return {"label": label, "startLondon": start, "free": free,
            "book": "https://booking.lagoon.co.uk/book?courseRunId=1"}


def test_build_payload_single():
    p = push.build_payload([_rec()])
    assert p["title"] == "A spot opened at Hove Lagoon"
    assert "Tech" in p["body"] and "18:00" in p["body"]
    assert p["url"].endswith("/lagoon/")


def test_build_payload_coalesces_count():
    p = push.build_payload([_rec(), _rec(start="2026-07-12T19:00")])
    assert "2 spots" in p["body"]


def test_send_all_posts_each_and_drops_410():
    subs = [
        {"subId": "a", "endpoint": "e1", "p256dh": "k1", "auth": "x1"},
        {"subId": "b", "endpoint": "e2", "p256dh": "k2", "auth": "x2"},
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
    subs = [{"subId": "a", "endpoint": "e1", "p256dh": "k", "auth": "x"},
            {"subId": "b", "endpoint": "e2", "p256dh": "k", "auth": "x"}]
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
