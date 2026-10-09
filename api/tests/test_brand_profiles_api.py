import pytest
from conftest import FakeSearch, make_client

PROFILE = {
    "brands": [
        {
            "name": "Zeta",
            "description": "",
            "aliases": ["Zeta Industries"],
            "hashtags": [],
            "handles": [],
            "common_word": True,
            "confirming_words": ["luggage"],
            "exclusions": {"followed_by": ["Corp"], "preceded_by": [], "nearby": [], "phrases": []},
            "people": [{"name": "Jo Bloggs", "require_brand_nearby": False}],
            "tests": [
                {"text": "Zeta Industries rose", "expect": "match"},
                {"text": "Zeta Corp makes anvils", "expect": "no_match"},
            ],
        }
    ]
}


def test_create_load_list_and_edit_a_form_set(settings):
    with make_client(settings, search_one=FakeSearch()) as c:
        r = c.put("/api/brand-profiles/zeta", json={"profile": PROFILE, "create": True})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["name"] == "zeta" and body["backup"]
        assert body["warnings"] == []
        assert [t["passed"] for t in body["tests"]] == [True, True]
        assert c.get("/api/brand-profiles/zeta").json()["profile"] == PROFILE
        sets = {s["name"]: s for s in c.get("/api/brands").json()["sets"]}
        assert sets["zeta"]["managed"] is True and sets["zeta"]["stale"] is False
        assert sets["zeta"]["profile"] == PROFILE
        assert sets["acme"]["managed"] is False and sets["acme"]["profile"] is None
        assert sets["zeta"]["rules"]
        edited = {"brands": [{**PROFILE["brands"][0], "description": "Luggage maker"}]}
        assert c.put("/api/brand-profiles/zeta", json={"profile": edited}).status_code == 200
        assert c.get("/api/brand-profiles/zeta").json()["profile"]["brands"][0]["description"] == "Luggage maker"


def test_create_refuses_existing_names_and_hand_written_sets(settings):
    with make_client(settings, search_one=FakeSearch()) as c:
        c.put("/api/brand-profiles/zeta", json={"profile": PROFILE, "create": True})
        assert c.put("/api/brand-profiles/zeta", json={"profile": PROFILE, "create": True}).status_code == 409
        for create in (True, False):
            r = c.put("/api/brand-profiles/acme", json={"profile": PROFILE, "create": create})
            assert r.status_code == 409 and "hand-written" in r.json()["error"]


def test_validation_errors_are_422_with_form_wording(settings):
    bad = {"brands": [{**PROFILE["brands"][0], "name": ""}]}
    with make_client(settings, search_one=FakeSearch()) as c:
        r = c.put("/api/brand-profiles/zeta", json={"profile": bad, "create": True})
        assert r.status_code == 422 and "Brand name" in r.json()["error"]
        assert "zeta" not in [s["name"] for s in c.get("/api/brands").json()["sets"]]


def test_unknown_keys_are_422(settings):
    top = {"brands": PROFILE["brands"], "extra": 1}
    nested = {"brands": [{**PROFILE["brands"][0], "regex": "x"}]}
    with make_client(settings, search_one=FakeSearch()) as c:
        for p in (top, nested):
            assert c.put("/api/brand-profiles/zeta", json={"profile": p, "create": True}).status_code == 422
            assert c.post("/api/brand-profiles/check", json={"profile": p}).status_code == 422


def test_get_profile_404_for_hand_written_and_unknown(settings):
    with make_client(settings, search_one=FakeSearch()) as c:
        assert c.get("/api/brand-profiles/acme").status_code == 404
        assert c.get("/api/brand-profiles/nope").status_code == 404


def test_check_returns_tests_with_reasons_and_saves_nothing(settings):
    with make_client(settings, search_one=FakeSearch()) as c:
        r = c.post("/api/brand-profiles/check", json={"profile": PROFILE})
        assert r.status_code == 200, r.text
        body = r.json()
        assert "warnings" in body
        assert [t["passed"] for t in body["tests"]] == [True, True]
        assert "followed by Corp" in body["tests"][1]["not_counted"][0]["reason"]
        assert "zeta" not in [s["name"] for s in c.get("/api/brands").json()["sets"]]


def test_check_validation_error_is_422(settings):
    bad = {"brands": [{**PROFILE["brands"][0], "name": ""}]}
    with make_client(settings, search_one=FakeSearch()) as c:
        assert c.post("/api/brand-profiles/check", json={"profile": bad}).status_code == 422


@pytest.mark.parametrize(
    "method,path",
    [
        ("put", "/api/brands/zeta"),
        ("post", "/api/brands/test"),
        ("post", "/api/brand-profiles/preview"),
        ("post", "/api/brand-profiles/test"),
        ("delete", "/api/brand-profiles/zeta/profile"),
        ("post", "/api/brand-profiles/suggest"),
    ],
)
def test_removed_endpoints(settings, method, path):
    with make_client(settings, search_one=FakeSearch()) as c:
        assert c.request(method.upper(), path).status_code in (404, 405)


@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/api/brand-profiles/acme"),
        ("put", "/api/brand-profiles/zeta"),
    ],
)
def test_malformed_config_is_422_on_profile_routes(settings, tmp_path, method, path):
    from pipeline_api.settings import Settings

    cfg = tmp_path / "verifier" / "config_bad.yaml"
    cfg.parent.mkdir(parents=True, exist_ok=True)
    cfg.write_text("invalid: yaml: content: [")
    bad = Settings(
        company_monitor_dir=settings.company_monitor_dir,
        url_verification_dir=settings.url_verification_dir,
        verifier_config=cfg,
        verifier_cache=tmp_path / "verifier" / "cache",
        data_dir=tmp_path / "data",
    )
    with make_client(bad, search_one=FakeSearch()) as c:
        body = {"profile": PROFILE, "create": True} if method == "put" else None
        r = c.request(method.upper(), path, json=body)
        assert r.status_code == 422 and r.json()["error"]


def test_invalid_set_name_is_422(settings):
    with make_client(settings, search_one=FakeSearch()) as c:
        r = c.put("/api/brand-profiles/Bad Name", json={"profile": PROFILE, "create": True})
        assert r.status_code == 422 and "set name" in r.json()["error"].lower()
