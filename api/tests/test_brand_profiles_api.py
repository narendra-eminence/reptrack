from conftest import FakeSearch, make_client

PROFILE = {
    "brands": [
        {
            "name": "Zeta",
            "always": ["Zeta Industries"],
            "handles": [],
            "everyday_word": {
                "word": "Zeta",
                "exact_case": True,
                "closeness": "close",
                "confirm": ["luggage"],
                "not_followed_by": ["Corp"],
                "not_preceded_by": [],
                "not_in_sentence_with": [],
                "ignore_phrases": [],
            },
        }
    ],
    "people": [],
}


def test_create_load_list_and_edit_a_form_set(settings):
    with make_client(settings, search_one=FakeSearch()) as c:
        r = c.put("/api/brand-profiles/zeta", json={"profile": PROFILE, "create": True})
        assert r.status_code == 200, r.text
        assert r.json()["warnings"] == [] and r.json()["backup"]
        assert c.get("/api/brand-profiles/zeta").json()["profile"] == PROFILE
        sets = {s["name"]: s for s in c.get("/api/brands").json()["sets"]}
        assert sets["zeta"]["managed"] is True and sets["zeta"]["stale"] is False
        assert sets["acme"]["managed"] is False
        assert [r["name"] for r in sets["zeta"]["rules"]] == ["Zeta", "Zeta"]
        edited = {**PROFILE, "people": [{"name": "Jo Bloggs", "common": False}]}
        assert c.put("/api/brand-profiles/zeta", json={"profile": edited}).status_code == 200
        assert c.get("/api/brand-profiles/zeta").json()["profile"]["people"] == [{"name": "Jo Bloggs", "common": False}]


def test_create_refuses_existing_names_and_raw_sets(settings):
    with make_client(settings, search_one=FakeSearch()) as c:
        c.put("/api/brand-profiles/zeta", json={"profile": PROFILE, "create": True})
        assert c.put("/api/brand-profiles/zeta", json={"profile": PROFILE, "create": True}).status_code == 409
        # acme is a raw set: the form never silently replaces hand-written rules, with or without create
        for create in (True, False):
            r = c.put("/api/brand-profiles/acme", json={"profile": PROFILE, "create": create})
            assert r.status_code == 409 and "raw" in r.json()["error"]


def test_raw_endpoint_refuses_a_managed_set(settings):
    with make_client(settings, search_one=FakeSearch()) as c:
        c.put("/api/brand-profiles/zeta", json={"profile": PROFILE, "create": True})
        r = c.put("/api/brands/zeta", json={"rules": [{"name": "Zeta", "pattern": "Zeta"}]})
        assert r.status_code == 409 and "simple form" in r.json()["error"]


def test_validation_errors_are_422_with_form_wording(settings):
    bad = {"brands": [{"name": "Zeta", "always": ["Zeta", "zeta"]}]}
    with make_client(settings, search_one=FakeSearch()) as c:
        r = c.put("/api/brand-profiles/zeta", json={"profile": bad, "create": True})
        assert r.status_code == 422 and "Names that always mean this brand" in r.json()["error"]
        r = c.put("/api/brand-profiles/Bad Name", json={"profile": PROFILE, "create": True})
        assert r.status_code == 422 and "set name" in r.json()["error"]
        r = c.put("/api/brand-profiles/zeta", json={"profile": {**PROFILE, "colour": "red"}, "create": True})
        assert r.status_code == 422


def test_preview_returns_rules_and_warnings_without_saving(settings):
    lonely = {"brands": [{"name": "Basil", "everyday_word": {"word": "Basil"}}]}
    with make_client(settings, search_one=FakeSearch()) as c:
        r = c.post("/api/brand-profiles/preview", json={"profile": lonely})
        assert r.status_code == 200
        body = r.json()
        assert body["rules"][0]["pattern"].startswith("Basil")
        assert body["warnings"][0]["brand"] == 0 and body["warnings"][0]["field"] == "confirm"
        assert "basil" not in [s["name"] for s in c.get("/api/brands").json()["sets"]]


def test_test_endpoint_explains_in_plain_language(settings):
    with make_client(settings, search_one=FakeSearch()) as c:
        text = "Zeta luggage is light. Zeta Corp makes anvils for cartoon coyotes everywhere they roam. Zeta again."
        r = c.post("/api/brand-profiles/test", json={"profile": PROFILE, "text": text})
        body = r.json()
        assert [h["brand"] for h in body["hits"]] == ["Zeta"]
        assert [x["reason"] for x in body["excluded"]] == [
            "followed by Corp",
            "no confirming word nearby",
        ]


def test_detach_and_missing(settings):
    with make_client(settings, search_one=FakeSearch()) as c:
        assert c.get("/api/brand-profiles/acme").status_code == 404
        assert c.get("/api/brand-profiles/nope").status_code == 404
        c.put("/api/brand-profiles/zeta", json={"profile": PROFILE, "create": True})
        assert c.delete("/api/brand-profiles/zeta/profile").status_code == 200
        sets = {s["name"]: s for s in c.get("/api/brands").json()["sets"]}
        assert sets["zeta"]["managed"] is False
        assert c.delete("/api/brand-profiles/zeta/profile").status_code == 404
        assert c.delete("/api/brand-profiles/nope/profile").status_code == 404
        assert c.delete("/api/brands/zeta").status_code == 200
