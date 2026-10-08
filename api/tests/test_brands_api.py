from conftest import FakeSearch, make_client


def test_list_and_delete(settings):
    with make_client(settings, search_one=FakeSearch()) as c:
        sets = {s["name"]: s for s in c.get("/api/brands").json()["sets"]}
        assert list(sets) == ["acme", "other"]
        assert all("profile" in s and s["profile"] is None and s["managed"] is False for s in sets.values())
        assert c.delete("/api/brands/acme").status_code == 200
        assert "acme" not in [s["name"] for s in c.get("/api/brands").json()["sets"]]
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
