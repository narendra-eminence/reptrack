import json

import pytest
from conftest import SEARCH_BODY, FakeSearch, make_client, wait_until

from pipeline_api.db import session


def test_restart_mid_scrape_runs_each_query_once(settings, monkeypatch):
    monkeypatch.setenv("SERPAPI_KEY", "k")
    queries = [f"q{i}" for i in range(12)]
    fake = FakeSearch()
    fake.gate.clear()
    fake.block_after = 4
    client = make_client(settings, search_one=fake)
    with client as c:
        run_id = c.post("/api/runs", json={**SEARCH_BODY, "queries": "\n".join(queries), "confirmed_calls": 12}).json()[
            "id"
        ]
        wait_until(lambda: c.get(f"/api/runs/{run_id}").json()["counts"]["done"] >= 4)
    # The TestClient exit ran lifespan shutdown with the job still 'running', like a killed process.
    with session(settings.db_path) as conn:
        assert conn.execute("SELECT state FROM jobs").fetchone()[0] == "running"
        done_before = {r[0] for r in conn.execute("SELECT text FROM queries WHERE state = 'done'")}
    fake.gate.set()
    second = FakeSearch()
    with make_client(settings, search_one=second) as c:
        detail = wait_until(lambda: (d := c.get(f"/api/runs/{run_id}").json())["status"] == "scraped" and d)
        assert detail["last_job"]["resumed_at"] is not None
    assert not (set(second.calls) & done_before)
    assert detail["counts"]["serp_rows"] == 12 and detail["counts"]["done"] == 12


class FakeResponse:
    def __init__(self, body):
        self.status_code = 200
        self.text = json.dumps(body)
        self.headers = {}

    def raise_for_status(self):
        pass


class RecordingSession:
    def __init__(self, body):
        self.body = body
        self.calls = 0

    def get(self, *a, **k):
        self.calls += 1
        return FakeResponse(self.body)

    post = get


class SimulatedCrash(BaseException):
    pass


SERPAPI_BODY = {
    "organic_results": [{"link": "https://x.example/1", "title": "t", "snippet": "s"}],
    "serpapi_pagination": {},
}
DATAFORSEO_BODY = {
    "status_code": 20000,
    "tasks": [
        {
            "status_code": 20000,
            "result": [
                {
                    "items": [
                        {
                            "type": "organic",
                            "url": "https://x.example/1",
                            "title": "t",
                            "description": "s",
                            "domain": "x.example",
                        }
                    ]
                }
            ],
        }
    ],
}


@pytest.mark.parametrize("provider,body", [("serpapi", SERPAPI_BODY), ("dataforseo", DATAFORSEO_BODY)])
def test_cached_response_is_reused_after_restart(provider, body, monkeypatch, tmp_path):
    from pipeline_api.monitor_bridge import load_bulk_search
    from pipeline_api.settings import load_settings

    bs = load_bulk_search(load_settings({}).company_monitor_dir)
    import net  # pyright: ignore[reportMissingImports]  # flat module on sys.path, added at runtime above

    monkeypatch.setenv("SERPAPI_KEY", "k")
    monkeypatch.setenv("DATAFORSEO_LOGIN", "l")
    monkeypatch.setenv("DATAFORSEO_PASSWORD", "p")
    transport = RecordingSession(body)
    monkeypatch.setattr(net, "_session", transport)
    rows, error, _ = bs.search_one("cache probe", "", "", 1, "web", provider)
    assert error == "" and rows and transport.calls == 1
    # "restart": nothing in memory survives except the on-disk cache
    rows2, _, _ = bs.search_one("cache probe", "", "", 1, "web", provider)
    assert transport.calls == 1 and [r["link"] for r in rows2] == [r["link"] for r in rows]


@pytest.mark.parametrize("provider,body", [("serpapi", SERPAPI_BODY), ("dataforseo", DATAFORSEO_BODY)])
def test_response_received_but_not_cached_is_sent_again_once(provider, body, monkeypatch):
    from pipeline_api.monitor_bridge import load_bulk_search
    from pipeline_api.settings import load_settings

    bs = load_bulk_search(load_settings({}).company_monitor_dir)
    import net  # pyright: ignore[reportMissingImports]  # flat module on sys.path, added at runtime above

    monkeypatch.setenv("SERPAPI_KEY", "k")
    monkeypatch.setenv("DATAFORSEO_LOGIN", "l")
    monkeypatch.setenv("DATAFORSEO_PASSWORD", "p")
    transport = RecordingSession(body)
    monkeypatch.setattr(net, "_session", transport)
    real_put = net._cache_put

    def crash(*a, **k):
        raise SimulatedCrash()

    monkeypatch.setattr(net, "_cache_put", crash)
    with pytest.raises(SimulatedCrash):
        bs.search_one("crash probe", "", "", 1, "web", provider)
    assert transport.calls == 1
    monkeypatch.setattr(net, "_cache_put", real_put)
    rows, error, _ = bs.search_one("crash probe", "", "", 1, "web", provider)
    assert error == "" and rows and transport.calls == 2
