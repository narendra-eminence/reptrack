import pytest
from conftest import SEARCH_BODY, FakeSearch, make_client, wait_until


@pytest.fixture
def keys(monkeypatch):
    monkeypatch.setenv("SERPAPI_KEY", "test-key")
    monkeypatch.setenv("DATAFORSEO_LOGIN", "l")
    monkeypatch.setenv("DATAFORSEO_PASSWORD", "p")


def test_plan_returns_parsed_queries_so_comma_split_is_visible(settings, keys):
    with make_client(settings, search_one=FakeSearch()) as c:
        body = {**SEARCH_BODY, "queries": '"Safari, luggage" OR Safari\nbeta'}
        plan = c.post("/api/plan", json=body).json()
    assert plan["queries"] == ['"Safari', 'luggage" OR Safari', "beta"]
    assert plan["count"] == 3 and plan["pages"] == 1 and plan["max_calls"] == 3 and plan["cached_calls"] == 0
    assert "cost" not in plan and "usd" not in str(plan).lower()


@pytest.mark.parametrize(
    "patch,message",
    [
        ({"queries": "  \n "}, "at least one query"),
        ({"start": "", "end": "2026-08-31"}, "together"),
        ({"start": "2026-02-30"}, "start"),
        ({"start": "2026-09-01", "end": "2026-08-31"}, "before"),
        ({"start": "20260301"}, "start"),
        ({"end": "2026-W10-1"}, "end"),
        ({"vertical": "images"}, "vertical"),
        ({"provider": "bing"}, "provider"),
    ],
)
def test_invalid_search_is_422_with_message(settings, keys, patch, message):
    with make_client(settings, search_one=FakeSearch()) as c:
        r = c.post("/api/plan", json={**SEARCH_BODY, **patch})
    assert r.status_code == 422
    assert message in r.json()["error"]


def test_news_and_dataforseo_pages_are_clamped(settings, keys):
    with make_client(settings, search_one=FakeSearch()) as c:
        assert c.post("/api/plan", json={**SEARCH_BODY, "vertical": "news", "pages": 9}).json()["pages"] == 1
        assert c.post("/api/plan", json={**SEARCH_BODY, "provider": "dataforseo", "pages": 50}).json()["pages"] == 20


def test_missing_key_is_reported(settings, monkeypatch):
    monkeypatch.setenv("SERPAPI_KEY", "")
    with make_client(settings, search_one=FakeSearch()) as c:
        r = c.post("/api/plan", json=SEARCH_BODY)
    assert r.status_code == 400 and "SERPAPI_KEY" in r.json()["error"]


def test_create_run_requires_confirmed_ceiling(settings, keys):
    with make_client(settings, search_one=FakeSearch()) as c:
        r = c.post("/api/runs", json={**SEARCH_BODY, "confirmed_calls": 1})
        assert r.status_code == 409 and r.json()["max_calls"] == 2
        r = c.post("/api/runs", json=SEARCH_BODY)
        assert r.status_code == 409


def test_run_lifecycle(settings, keys):
    fake = FakeSearch({"alpha": ["https://a.example/1", "https://a.example/2"], "beta": ["https://b.example/1"]})
    with make_client(settings, search_one=fake) as c:
        run_id = c.post("/api/runs", json={**SEARCH_BODY, "confirmed_calls": 2}).json()["id"]
        detail = wait_until(lambda: (d := c.get(f"/api/runs/{run_id}").json())["status"] == "scraped" and d)
        assert detail["counts"] == {"queries": 2, "done": 2, "failed": 0, "pending": 0, "serp_rows": 3}
        assert detail["name"] == "alpha"
        assert "rows" not in detail and all("row_json" not in q for q in detail["queries"])
        assert detail["last_job"]["state"] == "done"
        page = c.get(f"/api/runs/{run_id}/rows", params={"limit": 2}).json()
        assert page["total"] == 3 and len(page["rows"]) == 2
        assert list(page["rows"][0]) == [
            "Query",
            "Vertical",
            "Provider",
            "Page",
            "Rank",
            "Date",
            "Published",
            "Outside Range",
            "Domain",
            "Outlet",
            "Title",
            "Snippet",
            "Link",
            "Fetched At",
        ]
        assert c.get(f"/api/runs/{run_id}/rows", params={"q": "b.example"}).json()["total"] == 1
        runs = c.get("/api/runs").json()
        assert runs[0]["id"] == run_id and runs[0]["serp_rows"] == 3


def test_failed_queries_and_retry(settings, keys):
    fake = FakeSearch()
    with make_client(settings, search_one=fake) as c:
        body = {**SEARCH_BODY, "queries": "alpha\nfail: nope", "confirmed_calls": 2}
        run_id = c.post("/api/runs", json=body).json()["id"]
        detail = wait_until(lambda: (d := c.get(f"/api/runs/{run_id}").json())["status"] == "scraped" and d)
        failed = [q for q in detail["queries"] if q["state"] == "failed"]
        assert len(failed) == 1 and "after 3 attempts" in failed[0]["error"]
        fake.calls.clear()
        assert c.post(f"/api/runs/{run_id}/retry-failed").status_code == 200
        wait_until(lambda: c.get(f"/api/runs/{run_id}").json()["last_job"]["state"] == "done")
        assert fake.calls == ["fail: nope"]


def test_retry_failed_with_nothing_pending_is_409(settings, keys):
    with make_client(settings, search_one=FakeSearch()) as c:
        run_id = c.post("/api/runs", json={**SEARCH_BODY, "confirmed_calls": 2}).json()["id"]
        wait_until(lambda: c.get(f"/api/runs/{run_id}").json()["status"] == "scraped")
        r = c.post(f"/api/runs/{run_id}/retry-failed")
    assert r.status_code == 409
    assert "No failed or unfinished queries" in r.json()["error"]


def test_rows_search_handles_unicode_and_escapes_like_wildcards(settings, keys):
    from pipeline_api import runs as runs_module
    from pipeline_api.db import session

    with make_client(settings, search_one=FakeSearch()) as c:
        run_id = c.post("/api/runs", json={**SEARCH_BODY, "confirmed_calls": 2}).json()["id"]
        wait_until(lambda: c.get(f"/api/runs/{run_id}").json()["status"] == "scraped")

    def row(link, title, snippet):
        return {
            "query": "alpha",
            "vertical": "web",
            "provider": "serpapi",
            "page": 1,
            "rank": 1,
            "title": title,
            "link": link,
            "domain": "example.com",
            "date": "",
            "published": "",
            "out_of_range": None,
            "range_start": "",
            "range_end": "",
            "snippet": snippet,
            "outlet": "Example",
            "fetched_at": "2026-09-26T00:00:00+00:00",
        }

    rows = [
        row("https://a.example/apostrophe", "Safari’s luggage sale", "café in Delhi"),
        row("https://a.example/percent", "100% off luggage", "sale ends soon"),
        row("https://a.example/thousand", "1000 units left", "no percent here"),
    ]
    with session(settings.db_path) as conn:
        query_id = conn.execute(
            "SELECT id FROM queries WHERE run_id = ? ORDER BY position LIMIT 1", (run_id,)
        ).fetchone()["id"]
        runs_module.store_query_result(conn, run_id, query_id, rows, None, 1, 0)

    with make_client(settings, search_one=FakeSearch()) as c:
        assert c.get(f"/api/runs/{run_id}/rows", params={"q": "Safari’s"}).json()["total"] == 1
        assert c.get(f"/api/runs/{run_id}/rows", params={"q": "café"}).json()["total"] == 1
        page = c.get(f"/api/runs/{run_id}/rows", params={"q": "100%"}).json()
        assert page["total"] == 1
        assert page["rows"][0]["Link"] == "https://a.example/percent"


def test_cancel_unknown_job_is_404(settings, keys):
    with make_client(settings, search_one=FakeSearch()) as c:
        r = c.post("/api/jobs/999999/cancel")
    assert r.status_code == 404 and "error" in r.json()


def test_duplicate_start_is_409(settings, keys):
    fake = FakeSearch()
    fake.gate.clear()
    fake.block_after = 0
    with make_client(settings, search_one=fake) as c:
        run_id = c.post("/api/runs", json={**SEARCH_BODY, "confirmed_calls": 2}).json()["id"]
        r = c.post(f"/api/runs/{run_id}/retry-failed")
        assert r.status_code == 409 and r.json()["active_job"]["kind"] == "scrape"
        assert c.delete(f"/api/runs/{run_id}").status_code == 409
        fake.gate.set()


def test_cancel_scrape_keeps_unfinished_queries_pending(settings, keys):
    fake = FakeSearch()
    fake.gate.clear()
    fake.block_after = 1
    with make_client(settings, search_one=fake) as c:
        body = {**SEARCH_BODY, "queries": "\n".join(f"q{i}" for i in range(30)), "confirmed_calls": 30}
        run_id = c.post("/api/runs", json=body).json()["id"]
        job_id = wait_until(lambda: c.get(f"/api/runs/{run_id}").json()["active_job"])["id"]
        wait_until(lambda: c.get(f"/api/runs/{run_id}").json()["counts"]["done"] >= 1)
        assert c.post(f"/api/jobs/{job_id}/cancel").json()["state"] == "cancelling"
        fake.gate.set()
        detail = wait_until(
            lambda: (d := c.get(f"/api/runs/{run_id}").json())["last_job"]["state"] == "cancelled" and d
        )
        assert detail["status"] == "scraped"
        assert detail["counts"]["pending"] > 0
        assert detail["counts"]["done"] + detail["counts"]["pending"] == 30


def test_last_scrape_job_survives_a_later_verify_job(settings, keys):
    from test_verify import fake_pipeline

    with make_client(settings, search_one=FakeSearch(), pipeline_run=fake_pipeline("ok")) as c:
        run_id = c.post("/api/runs", json={**SEARCH_BODY, "confirmed_calls": 2}).json()["id"]
        detail = wait_until(lambda: (d := c.get(f"/api/runs/{run_id}").json())["status"] == "scraped" and d)
        assert detail["last_job"]["kind"] == "scrape"
        assert detail["last_scrape_job"]["kind"] == "scrape" and detail["last_scrape_job"]["state"] == "done"
        scrape_job_id = detail["last_scrape_job"]["id"]

        assert c.post(f"/api/runs/{run_id}/verify", json={"brand_set": "acme"}).status_code == 200
        detail = wait_until(lambda: (d := c.get(f"/api/runs/{run_id}").json())["status"] == "verified" and d)
        assert detail["last_job"]["kind"] == "verify"
        # the scrape job is still the one and only scrape job for this run, unchanged by the later verify job
        assert detail["last_scrape_job"]["id"] == scrape_job_id
        assert detail["last_scrape_job"]["kind"] == "scrape" and detail["last_scrape_job"]["state"] == "done"


def test_delete_run_removes_rows_and_files(settings, keys):
    with make_client(settings, search_one=FakeSearch()) as c:
        run_id = c.post("/api/runs", json={**SEARCH_BODY, "confirmed_calls": 2}).json()["id"]
        wait_until(lambda: c.get(f"/api/runs/{run_id}").json()["status"] == "scraped")
        assert c.get(f"/api/runs/{run_id}/serp.xlsx").status_code == 200
        assert (settings.exports_dir / run_id).exists()
        assert c.delete(f"/api/runs/{run_id}").status_code == 200
        assert c.get(f"/api/runs/{run_id}").status_code == 404
        assert not (settings.exports_dir / run_id).exists()
