import json

from conftest import wait_until
from fastapi.testclient import TestClient

from pipeline_api.fixture_search import make_fixture_search
from pipeline_api.main import create_app
from pipeline_api.monitor_bridge import load_bulk_search
from pipeline_api.settings import Settings, load_settings

ITEMS = {
    "queries": {"mokobara luggage": [{"title": "T", "link": "http://x.example/1", "snippet": "s", "date": ""}]},
    "default": [],
}


def test_matches_by_containment_and_fails_on_prefix(tmp_path):
    bs = load_bulk_search(load_settings({}).company_monitor_dir)
    path = tmp_path / "f.json"
    path.write_text(json.dumps(ITEMS))
    search = make_fixture_search(bs, path)
    rows, error, attempts = search("mokobara luggage desktop-1280", "", "", 1, "web", "serpapi", None)
    assert error == "" and attempts == 1
    assert rows[0]["link"] == "http://x.example/1" and rows[0]["query"] == "mokobara luggage desktop-1280"
    assert search("fail: x", "", "", 1, "web", "serpapi", None)[1].startswith("fixture")
    assert search("other", "", "", 1, "web", "serpapi", None)[0] == []


def test_create_app_uses_fixture_backend(settings, tmp_path, monkeypatch):
    monkeypatch.setenv("SERPAPI_KEY", "k")
    path = tmp_path / "f.json"
    path.write_text(json.dumps(ITEMS))
    fixture_settings = Settings(**{**settings.__dict__, "search_backend": "fixture", "search_fixture": path})
    with TestClient(create_app(fixture_settings)) as c:
        run_id = c.post("/api/runs", json={"queries": "mokobara luggage", "confirmed_calls": 1}).json()["id"]
        wait_until(lambda: c.get(f"/api/runs/{run_id}").json()["counts"]["serp_rows"] == 1)
