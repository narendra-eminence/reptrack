import sys

from fastapi.testclient import TestClient

from pipeline_api.main import create_app
from pipeline_api.monitor_bridge import load_bulk_search, provider_key_status
from pipeline_api.settings import load_settings


def test_bulk_search_imports_in_place_without_shadowing():
    bs = load_bulk_search(load_settings({}).company_monitor_dir)
    assert callable(bs.search_one)
    assert bs.EXPORT_COLUMNS[0] == "Query"
    assert sys.path.index(str(load_settings({}).company_monitor_dir)) > 0  # appended, never first


def test_key_status_names_the_missing_key(monkeypatch):
    bs = load_bulk_search(load_settings({}).company_monitor_dir)
    monkeypatch.setenv("SERPAPI_KEY", "")
    monkeypatch.setenv("DATAFORSEO_LOGIN", "x")
    monkeypatch.setenv("DATAFORSEO_PASSWORD", "y")
    status = provider_key_status(bs)
    assert "SERPAPI_KEY" in (status["serpapi"] or "")
    assert status["dataforseo"] is None


def test_health_and_options(settings, monkeypatch):
    monkeypatch.setenv("SERPAPI_KEY", "sk-test-SECRET-123")
    with TestClient(create_app(settings)) as client:
        health = client.get("/api/health").json()
        assert health["company_monitor"] and health["url_verification"]
        assert health["verifier_config_error"] is None
        assert health["keys"]["serpapi"] is None
        assert "SECRET" not in str(health)  # key values never leave the server
        assert "suggest_available" not in health
        assert client.post("/api/brand-profiles/suggest", json={"brand_name": "Safari"}).status_code in (404, 405)
        options = client.get("/api/options").json()
        assert options["verticals"] == ["web", "news", "news_tab"]
        assert options["max_pages"] == {"serpapi": 50, "dataforseo": 20}


def test_health_reports_malformed_yaml_instead_of_500(settings):
    """A hand-broken config.yaml (malformed YAML, or a well-formed top-level list/scalar instead of a mapping)
    must show up as verifier_config_error, never as a 500 - see verify.snapshot_rules for the same guarantee on
    the /verify route."""
    settings.verifier_config.write_text("brands: [unclosed")
    with TestClient(create_app(settings)) as client:
        r = client.get("/api/health")
        assert r.status_code == 200
        body = r.json()
        assert body["ok"] is False
        assert body["verifier_config_error"]  # yaml.YAMLError's message, not a raised 500

    settings.verifier_config.write_text("- a\n- b\n")
    with TestClient(create_app(settings)) as client:
        r = client.get("/api/health")
        assert r.status_code == 200
        assert r.json()["verifier_config_error"] is not None
