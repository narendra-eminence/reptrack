import asyncio
import json
import threading
import time
from datetime import datetime

import pandas as pd
import pytest
from conftest import SEARCH_BODY, FakeSearch, make_client, wait_until
from openpyxl import Workbook

from pipeline_api.db import migrate, now, session
from pipeline_api.verify import VerifierThread, ingest_verified


@pytest.fixture
def keys(monkeypatch):
    monkeypatch.setenv("SERPAPI_KEY", "k")


def _scraped_run(c, links):
    fake_body = {**SEARCH_BODY, "queries": "alpha", "confirmed_calls": 1}
    run_id = c.post("/api/runs", json=fake_body).json()["id"]
    wait_until(lambda: c.get(f"/api/runs/{run_id}").json()["status"] == "scraped")
    return run_id


def _write_output(output_path, rows):
    pd.DataFrame(rows).to_excel(output_path, index=False)


def fake_pipeline(
    behaviour,
    record: list[dict] | None = None,
    gate: threading.Event | None = None,
    started: threading.Event | None = None,
):
    async def run(input_path, output_path, cfg, brand, cache_dir="cache", rules=None, on_result=None, **kw):
        if record is not None:
            record.append({"brand": brand, "rules": rules, "cache_dir": cache_dir})
        if behaviour == "block_cpu":
            if started is not None:
                started.set()  # the test waits on this so it times health calls DURING the blocking sleep below
            time.sleep(1.5)  # synchronous work on the verifier thread's own loop
        if behaviour == "forever":
            while True:
                await asyncio.sleep(0.05)
        if behaviour == "gate":
            assert gate is not None
            while not gate.is_set():
                await asyncio.sleep(0.02)
        df = pd.read_excel(input_path)
        statuses = ["Verified"] * len(df)
        for s in statuses:
            assert on_result is not None
            on_result(s)
        _write_output(
            output_path,
            [
                {**r, "Status": s, "Duplicate Of Row": None}
                for r, s in zip(df.to_dict("records"), statuses, strict=True)
            ],
        )
        return {"Verified": len(df), "_rows": len(df), "_duplicates": 0, "_unique": len(df)}

    return run


def test_verify_ingests_and_filters_search_snippet_match_status(settings, keys):
    """The API ingests the sheet's columns generically (whatever Status/Evidence Source values the pipeline
    writes), so no API code change is needed for the new SERP-fallback status - this only proves it round-trips:
    ingestion into verify_rows, the status_counts summary, and the results endpoint's status filter."""

    async def run(input_path, output_path, cfg, brand, cache_dir="cache", rules=None, on_result=None, **kw):
        df = pd.read_excel(input_path)
        statuses = ["Search snippet match"] + ["Verified"] * (len(df) - 1)
        evidence = ["serp"] + ["page"] * (len(df) - 1)
        for s in statuses:
            assert on_result is not None
            on_result(s)
        _write_output(
            output_path,
            [
                {
                    **r,
                    "Status": s,
                    "Evidence Source": e,
                    "Hit Sentence": "Acme reported growth",
                    "Duplicate Of Row": None,
                }
                for r, s, e in zip(df.to_dict("records"), statuses, evidence, strict=True)
            ],
        )
        return {
            "Search snippet match": 1,
            "Verified": len(df) - 1,
            "_rows": len(df),
            "_duplicates": 0,
            "_unique": len(df),
        }

    with make_client(settings, search_one=FakeSearch(), pipeline_run=run) as c:
        run_id = _scraped_run(c, None)
        r = c.post(f"/api/runs/{run_id}/verify", json={"brand_set": "acme"})
        assert r.status_code == 200
        vj = r.json()["verify_job_id"]
        detail = wait_until(lambda: (d := c.get(f"/api/runs/{run_id}").json())["status"] == "verified" and d)
        job = detail["verify_jobs"][0]
        assert job["status_counts"]["Search snippet match"] == 1

        res = c.get(f"/api/runs/{run_id}/verify/{vj}/results", params={"status": "Search snippet match"}).json()
        assert res["total"] == 1
        row = res["rows"][0]
        assert row["status"] == "Search snippet match"
        assert row["row"]["Evidence Source"] == "serp"
        assert row["row"]["Hit Sentence"] == "Acme reported growth"


def test_verify_happy_path_with_real_pipeline_and_snapshot(settings, keys, page_server, monkeypatch):
    fake = FakeSearch({"alpha": [page_server + "/acme", page_server + "/plain", page_server + "/acme?utm_source=x"]})
    import urlverify.pipeline as pl

    real_run = pl.run

    async def edit_config_then_run(*args, **kwargs):
        # The live set is edited and deleted after the snapshot was taken; the job must not notice.
        from urlverify import brands

        brands.delete_set(settings.verifier_config, "acme")
        return await real_run(*args, **kwargs, use_tier2=False)

    def never_by_name(*args, **kwargs):
        raise AssertionError("the app must never resolve a brand set by name")

    monkeypatch.setattr(pl, "resolve_brand", never_by_name)
    with make_client(settings, search_one=fake, pipeline_run=edit_config_then_run) as c:
        run_id = _scraped_run(c, None)
        r = c.post(f"/api/runs/{run_id}/verify", json={"brand_set": "acme"})
        assert r.status_code == 200
        vj = r.json()["verify_job_id"]
        detail = wait_until(lambda: (d := c.get(f"/api/runs/{run_id}").json())["status"] == "verified" and d)
        job = detail["verify_jobs"][0]
        assert job["brand_set"] == "acme" and job["brand_rules"][0]["pattern"] == r"Acme|[#@]acme\w*"
        assert job["status_counts"]["Verified"] == 1 and job["status_counts"]["Brand not found"] == 1
        assert job["total_urls"] == 2 and job["done_urls"] == 2
        res = c.get(f"/api/runs/{run_id}/verify/{vj}/results").json()
        assert res["total"] == 3
        assert c.get(f"/api/runs/{run_id}/verify/{vj}/results", params={"hide_duplicates": True}).json()["total"] == 2
        # 2, not 1: urlverify's annotate.annotated_frame copies the CANONICAL row's Status onto its duplicate too
        # (only "Duplicate Of Row" marks it as a duplicate) - so the duplicate of /acme also reads "Verified".
        # Verified by printing the verified sheet's Status/Notes for this exact scenario; see task-9-report.md.
        assert c.get(f"/api/runs/{run_id}/verify/{vj}/results", params={"status": "Verified"}).json()["total"] == 2
        xlsx = c.get(f"/api/runs/{run_id}/verify/{vj}/verified.xlsx")
        assert xlsx.status_code == 200 and "_verified_" in xlsx.headers["content-disposition"]
        assert c.post(f"/api/runs/{run_id}/verify", json={"brand_set": "acme"}).status_code == 422  # deleted now


def test_verify_allowed_after_cancelled_search_with_partial_results(settings, keys):
    """Controller ruling: verifying partial results after a cancelled search is allowed when there is no active
    job and serp_rows > 0 - even with queries still pending."""
    fake = FakeSearch()
    fake.gate.clear()
    fake.block_after = 1
    with make_client(settings, search_one=fake, pipeline_run=fake_pipeline("ok")) as c:
        body = {**SEARCH_BODY, "queries": "\n".join(f"q{i}" for i in range(10)), "confirmed_calls": 10}
        run_id = c.post("/api/runs", json=body).json()["id"]
        job_id = wait_until(lambda: c.get(f"/api/runs/{run_id}").json()["active_job"])["id"]
        wait_until(lambda: c.get(f"/api/runs/{run_id}").json()["counts"]["done"] >= 1)
        c.post(f"/api/jobs/{job_id}/cancel")
        fake.gate.set()
        detail = wait_until(lambda: (d := c.get(f"/api/runs/{run_id}").json())["status"] == "scraped" and d)
        assert detail["counts"]["pending"] > 0 and detail["counts"]["serp_rows"] > 0
        r = c.post(f"/api/runs/{run_id}/verify", json={"brand_set": "acme"})
        assert r.status_code == 200
        wait_until(lambda: c.get(f"/api/runs/{run_id}").json()["status"] == "verified")


def test_verify_with_no_results_is_still_409(settings, keys):
    with make_client(settings, search_one=FakeSearch(), pipeline_run=fake_pipeline("ok")) as c:
        run_id = c.post("/api/runs", json={**SEARCH_BODY, "queries": "fail: nope", "confirmed_calls": 1}).json()["id"]
        wait_until(lambda: c.get(f"/api/runs/{run_id}").json()["status"] == "scraped")
        r = c.post(f"/api/runs/{run_id}/verify", json={"brand_set": "acme"})
        assert r.status_code == 409
        assert "no search results to verify" in r.json()["error"]


def test_malformed_config_yaml_is_422_not_500(settings, keys):
    settings.verifier_config.write_text("brands: [unclosed")
    with make_client(settings, search_one=FakeSearch(), pipeline_run=fake_pipeline("ok")) as c:
        run_id = _scraped_run(c, None)
        r = c.post(f"/api/runs/{run_id}/verify", json={"brand_set": "acme"})
        assert r.status_code == 422
        assert settings.verifier_config.name in r.json()["error"]


def test_top_level_list_config_yaml_is_422_not_500(settings, keys):
    settings.verifier_config.write_text("- a\n- b\n")
    with make_client(settings, search_one=FakeSearch(), pipeline_run=fake_pipeline("ok")) as c:
        run_id = _scraped_run(c, None)
        r = c.post(f"/api/runs/{run_id}/verify", json={"brand_set": "acme"})
        assert r.status_code == 422
        assert settings.verifier_config.name in r.json()["error"]


def test_unknown_brand_set_rejected(settings, keys):
    with make_client(settings, search_one=FakeSearch(), pipeline_run=fake_pipeline("ok")) as c:
        run_id = _scraped_run(c, None)
        r = c.post(f"/api/runs/{run_id}/verify", json={"brand_set": "nope"})
        assert r.status_code == 422 and "nope" in r.json()["error"]
        assert c.get(f"/api/runs/{run_id}").json()["verify_jobs"] == []


def test_verify_does_not_block_the_api(settings, keys):
    started = threading.Event()
    with make_client(settings, search_one=FakeSearch(), pipeline_run=fake_pipeline("block_cpu", started=started)) as c:
        run_id = _scraped_run(c, None)
        c.post(f"/api/runs/{run_id}/verify", json={"brand_set": "acme"})
        # Proves the timing below actually lands during the fake pipeline's blocking time.sleep(1.5), rather than
        # relying on verify_jobs.status == "running" (set before the blocking call even starts) as a proxy for it.
        assert started.wait(10), "fake pipeline never reached its blocking sleep"
        timings = []
        for _ in range(3):
            t0 = time.monotonic()
            assert c.get("/api/health").status_code == 200
            timings.append(time.monotonic() - t0)
        assert sorted(timings)[1] < 0.2


def test_duplicate_verify_start_is_409(settings, keys):
    with make_client(settings, search_one=FakeSearch(), pipeline_run=fake_pipeline("forever")) as c:
        run_id = _scraped_run(c, None)
        assert c.post(f"/api/runs/{run_id}/verify", json={"brand_set": "acme"}).status_code == 200
        r = c.post(f"/api/runs/{run_id}/verify", json={"brand_set": "acme"})
        assert r.status_code == 409 and r.json()["active_job"]["kind"] == "verify"
        job_id = c.get(f"/api/runs/{run_id}").json()["active_job"]["id"]
        c.post(f"/api/jobs/{job_id}/cancel")
        wait_until(lambda: c.get(f"/api/runs/{run_id}").json()["active_job"] is None)


def test_cancel_verify_leaves_no_output(settings, keys):
    with make_client(settings, search_one=FakeSearch(), pipeline_run=fake_pipeline("forever")) as c:
        run_id = _scraped_run(c, None)
        vj = c.post(f"/api/runs/{run_id}/verify", json={"brand_set": "acme"}).json()["verify_job_id"]
        job_id = wait_until(lambda: c.get(f"/api/runs/{run_id}").json()["active_job"])["id"]
        wait_until(lambda: c.get(f"/api/runs/{run_id}").json()["verify_jobs"][0]["status"] == "running")
        c.post(f"/api/jobs/{job_id}/cancel")
        detail = wait_until(lambda: (d := c.get(f"/api/runs/{run_id}").json())["active_job"] is None and d)
        assert detail["verify_jobs"][0]["status"] == "cancelled" and detail["status"] == "scraped"
        assert c.get(f"/api/runs/{run_id}/verify/{vj}/results").json()["total"] == 0
        assert not list((settings.exports_dir / run_id).glob("*_verified_*"))


def test_restart_mid_verify_uses_the_stored_snapshot(settings, keys):
    record: list[dict] = []
    gate = threading.Event()
    with make_client(settings, search_one=FakeSearch(), pipeline_run=fake_pipeline("gate", record, gate)) as c:
        run_id = _scraped_run(c, None)
        c.post(f"/api/runs/{run_id}/verify", json={"brand_set": "acme"})
        wait_until(lambda: record)
    from urlverify import brands
    from urlverify.profile import BrandProfile, ProfileBrand

    brands.save_profile(settings.verifier_config, "acme", BrandProfile([ProfileBrand("Changed")]))
    gate.set()
    with make_client(settings, search_one=FakeSearch(), pipeline_run=fake_pipeline("ok", record)) as c:
        detail = wait_until(lambda: (d := c.get(f"/api/runs/{run_id}").json())["status"] == "verified" and d)
    assert record[-1]["rules"][0].name == "Acme"  # the snapshot, not the edited live set
    assert detail["verify_jobs"][0]["brand_rules"][0]["name"] == "Acme"
    with session(settings.db_path) as conn:
        assert conn.execute("SELECT COUNT(*) FROM verify_rows").fetchone()[0] == 1


def test_retry_failed_verify_job(settings, keys):
    calls = {"n": 0}

    async def flaky(input_path, output_path, cfg, brand, **kw):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("chromium crashed")
        return await fake_pipeline("ok")(input_path, output_path, cfg, brand, **kw)

    with make_client(settings, search_one=FakeSearch(), pipeline_run=flaky) as c:
        run_id = _scraped_run(c, None)
        c.post(f"/api/runs/{run_id}/verify", json={"brand_set": "acme"})
        detail = wait_until(lambda: (d := c.get(f"/api/runs/{run_id}").json())["status"] == "failed" and d)
        assert "chromium crashed" in detail["error"]
        job_id = detail["last_job"]["id"]
        assert c.post(f"/api/jobs/{job_id}/retry").status_code == 200
        wait_until(lambda: c.get(f"/api/runs/{run_id}").json()["status"] == "verified")


def test_ingest_handles_datetimes_blanks_and_numbers(tmp_path):
    db = tmp_path / "app.db"
    migrate(db)
    path = tmp_path / "v.xlsx"
    wb = Workbook()
    ws = wb.active
    assert ws is not None
    ws.append(["Link", "Status", "Published Date", "Query Count", "Duplicate Of Row", "Notes"])
    ws.append(["https://a", "Verified", datetime(2026, 5, 1, 10, 30), 2, None, "Safari’s café review"])
    ws.append(["https://a?x", "Verified", None, 1.5, 2, "dup"])
    wb.save(path)
    with session(db) as conn:
        conn.execute(
            "INSERT INTO runs (id, name, provider, vertical, pages, status, created_at, updated_at) "
            "VALUES ('r', 'n', 'serpapi', 'web', 1, 'verifying', ?, ?)",
            (now(), now()),
        )
        conn.execute(
            "INSERT INTO verify_jobs (run_id, brand_set, brand_rules_json, status, created_at) "
            "VALUES ('r', 'acme', '[]', 'running', ?)",
            (now(),),
        )
        assert ingest_verified(conn, 1, path) == 2
        rows = conn.execute("SELECT * FROM verify_rows ORDER BY seq").fetchall()
    raw = rows[0]["row_json"]
    # ensure_ascii=False, exercised through ingest_verified itself (not hand-written JSON): the literal curly
    # apostrophe and accented "e" survive in the stored JSON rather than becoming "’"/"é" escapes.
    assert "Safari’s café review" in raw
    assert "\\u2019" not in raw and "\\u00e9" not in raw
    first = json.loads(raw)
    assert first["Published Date"] == "2026-05-01T10:30:00" and first["Notes"] == "Safari’s café review"
    assert rows[1]["is_duplicate"] == 1 and rows[0]["is_duplicate"] == 0


def test_verifier_thread_cancel_before_start_returns_none():
    started = []

    async def coro():
        started.append(True)
        await asyncio.sleep(10)
        return {}

    vt = VerifierThread(coro)
    vt.cancel()
    assert vt.run() is None


def test_results_text_search_escapes_like_wildcards_and_finds_non_ascii(settings, keys):
    """Controller ruling 1: q must find a row containing a curly apostrophe or non-ASCII text, and must not treat
    literal '%'/'_' in the query as SQL LIKE wildcards - matching runs.serp_rows_page's own guarantee."""
    with make_client(settings, search_one=FakeSearch(), pipeline_run=fake_pipeline("ok")) as c:
        run_id = _scraped_run(c, None)
        with session(settings.db_path) as conn:
            conn.execute(
                "INSERT INTO verify_jobs (run_id, brand_set, brand_rules_json, status, created_at) "
                "VALUES (?, 'acme', '[]', 'done', ?)",
                (run_id, now()),
            )
            vj_id = conn.execute("SELECT id FROM verify_jobs WHERE run_id = ?", (run_id,)).fetchone()[0]
            conn.execute(
                "INSERT INTO verify_rows (verify_job_id, seq, status, is_duplicate, row_json) VALUES "
                "(?, 0, 'Verified', 0, ?)",
                (vj_id, json.dumps({"title": "Safari’s café trip", "link": "https://a"}, ensure_ascii=False)),
            )
            conn.execute(
                "INSERT INTO verify_rows (verify_job_id, seq, status, is_duplicate, row_json) VALUES "
                "(?, 1, 'Verified', 0, ?)",
                (vj_id, json.dumps({"title": "100% off", "link": "https://b"}, ensure_ascii=False)),
            )
            conn.execute(
                "INSERT INTO verify_rows (verify_job_id, seq, status, is_duplicate, row_json) VALUES "
                "(?, 2, 'Verified', 0, ?)",
                (vj_id, json.dumps({"title": "1000 off", "link": "https://c"}, ensure_ascii=False)),
            )
            conn.execute(
                "INSERT INTO verify_rows (verify_job_id, seq, status, is_duplicate, row_json) VALUES "
                "(?, 3, 'Verified', 0, ?)",
                (vj_id, json.dumps({"title": "cat_dog", "link": "https://d"}, ensure_ascii=False)),
            )
            conn.execute(
                "INSERT INTO verify_rows (verify_job_id, seq, status, is_duplicate, row_json) VALUES "
                "(?, 4, 'Verified', 0, ?)",
                (vj_id, json.dumps({"title": "catXdog", "link": "https://e"}, ensure_ascii=False)),
            )
        res = c.get(f"/api/runs/{run_id}/verify/{vj_id}/results", params={"q": "Safari’s café"})
        assert res.json()["total"] == 1
        res_pct = c.get(f"/api/runs/{run_id}/verify/{vj_id}/results", params={"q": "100%"})
        # A literal '%' must not act as an unescaped SQL LIKE wildcard: "100%" must match only the row that
        # literally contains "100%", never the unrelated "1000 off" row.
        assert res_pct.json()["total"] == 1
        res_underscore = c.get(f"/api/runs/{run_id}/verify/{vj_id}/results", params={"q": "cat_dog"})
        # Likewise for '_': SQL LIKE treats it as "any single character", so an unescaped "_" would also match
        # "catXdog". Escaped, only the row literally containing "cat_dog" matches.
        assert res_underscore.json()["total"] == 1
