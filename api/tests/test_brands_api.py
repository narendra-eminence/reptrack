from conftest import FakeSearch, make_client

ACME = {
    "name": "Acme",
    "pattern": "Acme",
    "require_context": ["luggage"],
    "exclude": ["Acme Corp"],
    "case_sensitive": True,
    "context_window": 40,
}


def test_list_save_test_delete(settings):
    with make_client(settings, search_one=FakeSearch()) as c:
        names = [s["name"] for s in c.get("/api/brands").json()["sets"]]
        assert names == ["acme", "other"]
        r = c.put("/api/brands/newco", json={"rules": [ACME]})
        assert r.status_code == 200 and r.json()["backup"].endswith(tuple("0123456789"))
        sets = {s["name"]: s["rules"] for s in c.get("/api/brands").json()["sets"]}
        assert sets["newco"] == [ACME]
        hits = c.post("/api/brands/test", json={"set": "newco", "text": "Acme luggage is great. Acme Corp is not."})
        assert [h["brand"] for h in hits.json()["hits"]] == ["Acme"]
        assert hits.json()["excluded"][0]["reason"].startswith("excluded by")
        assert c.delete("/api/brands/newco").status_code == 200
        assert "newco" not in [s["name"] for s in c.get("/api/brands").json()["sets"]]


def test_invalid_regex_is_422_naming_the_rule(settings):
    with make_client(settings, search_one=FakeSearch()) as c:
        r = c.put("/api/brands/bad", json={"rules": [{**ACME, "pattern": "Ac(me"}]})
    assert r.status_code == 422 and "rule 1 ('Acme')" in r.json()["error"] and "pattern" in r.json()["error"]


def test_unknown_rule_field_and_missing_set(settings):
    with make_client(settings, search_one=FakeSearch()) as c:
        assert c.put("/api/brands/x", json={"rules": [{**ACME, "colour": "red"}]}).status_code == 422
        assert c.post("/api/brands/test", json={"set": "nope", "text": "t"}).status_code == 404
        assert c.delete("/api/brands/nope").status_code == 422


def test_malformed_yaml_returns_422_on_get(settings, tmp_path):
    # Corrupt the config.yaml to have invalid YAML syntax
    from pipeline_api.settings import Settings

    cfg = tmp_path / "verifier" / "config_bad.yaml"
    cfg.parent.mkdir(parents=True, exist_ok=True)
    cfg.write_text("invalid: yaml: content: [")
    bad_settings = Settings(
        company_monitor_dir=settings.company_monitor_dir,
        url_verification_dir=settings.url_verification_dir,
        verifier_config=cfg,
        verifier_cache=tmp_path / "verifier" / "cache",
        data_dir=tmp_path / "data",
    )
    with make_client(bad_settings, search_one=FakeSearch()) as c:
        r = c.get("/api/brands")
        assert r.status_code == 422
        assert "error" in r.json()


def test_malformed_yaml_returns_422_on_put(settings, tmp_path):
    # Corrupt the config.yaml to have invalid YAML syntax
    from pipeline_api.settings import Settings

    cfg = tmp_path / "verifier" / "config_bad.yaml"
    cfg.parent.mkdir(parents=True, exist_ok=True)
    cfg.write_text("invalid: yaml: content: [")
    bad_settings = Settings(
        company_monitor_dir=settings.company_monitor_dir,
        url_verification_dir=settings.url_verification_dir,
        verifier_config=cfg,
        verifier_cache=tmp_path / "verifier" / "cache",
        data_dir=tmp_path / "data",
    )
    with make_client(bad_settings, search_one=FakeSearch()) as c:
        r = c.put("/api/brands/newco", json={"rules": [ACME]})
        assert r.status_code == 422
        assert "error" in r.json()


def test_malformed_yaml_returns_422_on_delete(settings, tmp_path):
    # Corrupt the config.yaml to have invalid YAML syntax
    from pipeline_api.settings import Settings

    cfg = tmp_path / "verifier" / "config_bad.yaml"
    cfg.parent.mkdir(parents=True, exist_ok=True)
    cfg.write_text("invalid: yaml: content: [")
    bad_settings = Settings(
        company_monitor_dir=settings.company_monitor_dir,
        url_verification_dir=settings.url_verification_dir,
        verifier_config=cfg,
        verifier_cache=tmp_path / "verifier" / "cache",
        data_dir=tmp_path / "data",
    )
    with make_client(bad_settings, search_one=FakeSearch()) as c:
        r = c.delete("/api/brands/acme")
        assert r.status_code == 422
        assert "error" in r.json()


def test_malformed_yaml_returns_422_on_post_test_with_set(settings, tmp_path):
    # Corrupt the config.yaml to have invalid YAML syntax
    from pipeline_api.settings import Settings

    cfg = tmp_path / "verifier" / "config_bad.yaml"
    cfg.parent.mkdir(parents=True, exist_ok=True)
    cfg.write_text("invalid: yaml: content: [")
    bad_settings = Settings(
        company_monitor_dir=settings.company_monitor_dir,
        url_verification_dir=settings.url_verification_dir,
        verifier_config=cfg,
        verifier_cache=tmp_path / "verifier" / "cache",
        data_dir=tmp_path / "data",
    )
    with make_client(bad_settings, search_one=FakeSearch()) as c:
        r = c.post("/api/brands/test", json={"set": "acme", "text": "test"})
        assert r.status_code == 422
        assert "error" in r.json()
