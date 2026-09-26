from conftest import SEARCH_BODY, FakeSearch, make_client, wait_until


def test_query_rows_and_state_commit_together(settings, monkeypatch):
    """A query is either stored fully with state 'done' or still 'pending'; never rows without a state change."""
    monkeypatch.setenv("SERPAPI_KEY", "k")
    fake = FakeSearch({"alpha": [f"https://a.example/{i}" for i in range(5)]})
    with make_client(settings, search_one=fake) as c:
        run_id = c.post("/api/runs", json={**SEARCH_BODY, "confirmed_calls": 2}).json()["id"]
        wait_until(lambda: c.get(f"/api/runs/{run_id}").json()["status"] == "scraped")
    from pipeline_api.db import session

    with session(settings.db_path) as conn:
        rows = conn.execute(
            "SELECT q.state, COUNT(s.id) n, q.found FROM queries q LEFT JOIN serp_rows s "
            "ON s.query_id = q.id GROUP BY q.id"
        ).fetchall()
    assert all(r["state"] == "done" and r["n"] == r["found"] for r in rows)
