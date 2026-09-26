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
        options = client.get("/api/options").json()
        assert options["verticals"] == ["web", "news", "news_tab"]
        assert options["max_pages"] == {"serpapi": 50, "dataforseo": 20}
