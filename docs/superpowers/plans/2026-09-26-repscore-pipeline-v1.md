# RepScore Pipeline v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One local web app where you paste queries, run them on SerpAPI or DataForSEO, then verify every result URL against an explicitly chosen brand set and download the verified xlsx.

**Architecture:** Next.js (App Router) UI in `web/` proxies `/api/*` to a FastAPI backend in `api/` (package `pipeline_api`). The backend imports Company Monitor's `bulk_search` from its folder and `urlverify` as an editable path package, runs one background job at a time from a SQLite `jobs` table, streams progress over SSE, and resumes interrupted jobs on startup. Verification runs in its own thread with its own event loop, using an immutable brand-rule snapshot.

**Tech Stack:** Python 3.12, uv, FastAPI, uvicorn, sqlite3 (stdlib, WAL), openpyxl, ruamel.yaml (in url-verification), pytest + pytest-asyncio, ruff, pyright. Node 24, Next.js (latest, App Router, TypeScript), Tailwind CSS, shadcn/ui, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-26-repscore-pipeline-design.md` (read it before starting any task).

## Global Constraints

- Runs on this Mac only. API binds `127.0.0.1:8000`, web on `localhost:3000`. No login.
- Company Monitor: `~/Desktop/Eminence/CompanyMonitor` (env `COMPANY_MONITOR_DIR`). Its venv is **Python 3.9**: code added there must run on 3.9 (no `X | Y` annotations evaluated at runtime, no `match`).
- url-verification: `~/Desktop/niks/url-verification` (env `URL_VERIFICATION_DIR`), config `config.yaml` (env `URL_VERIFICATION_CONFIG`), cache `cache/` (env `URL_VERIFICATION_CACHE`).
- The only changes allowed in those two repos: `bulk_search.search_one`; `pipeline.run` keywords `rules` and `on_result`; `urlverify/brands.py`; url-verification packaging metadata and the `ruamel.yaml` dependency. No other extraction or refactoring.
- Keys (`SERPAPI_KEY`, `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`) come from `COMPANY_MONITOR_DIR/.env`, never reach the browser, never appear in logs, exports or API responses.
- The cost preview is counts, never money: "Maximum billable SERP pages" and "Already cached (free)".
- A verify job's brand rules come only from `verify_jobs.brand_rules_json`; `resolve_brand` is never called by the app, and unknown set names are rejected.
- At most one active (`queued`/`running`/`cancelling`) job per run; a rejected start returns HTTP 409 with the active job's id and kind.
- Output xlsx columns: SERP export = `bulk_search.EXPORT_COLUMNS` in order; verified export = exactly what `urlverify.pipeline.run` writes.
- Never use the em dash character in code, copy, docs or commit messages; use "-".
- Commit messages: conventional style, no AI co-author lines.
- Quality gate: `make check` (ruff, pyright, pytest with warnings as errors, eslint, tsc, Playwright) passes with zero warnings; Company Monitor and url-verification suites pass. A flaky test is fixed, never retried.
- Eminence tokens: red `#D41829` (hover `#B81422`), navy `#000C66`, blue `#186AC9`; headings Georgia, body Aptos/Calibri/Arial; one red primary button per screen.

## Review Focus

1. A pasted query containing a comma inside quotes (`"Safari, luggage" OR Safari`) is split into two queries by `parse_queries`; the user must see the parsed list and count before spending (Task 7 API test, Task 13 E2E assertion).
2. SERP titles or snippets that start with `=` or contain control characters (`\x0b`, `\x1f`) must export as plain text without crashing openpyxl (Task 7 export test).
3. Only one date given, a malformed date, or end before start must be rejected with a message naming the problem, not a 500 (Task 7 validation tests).
4. With the backend down, the UI must show "Backend not reachable" with the start command instead of blank tables or spinners forever (Task 12 E2E test).
5. Verified sheets contain datetimes, NaN-like blanks and numbers; ingesting them into `verify_rows` must not crash on JSON serialization (Task 9 ingest test).

---

## File Structure

```
repscore-pipeline/
  Makefile                         install, dev, start, lint, test, e2e, check
  README.md
  .gitignore                       data/, e2e/.tmp/, node_modules/, .venv/, test-results/
  api/
    pyproject.toml
    pipeline_api/
      __init__.py
      settings.py                  Settings dataclass, load_settings(env)
      monitor_bridge.py            load_bulk_search(), key_errors(), provider_key_status()
      logs.py                      JSON-lines logging to data/logs/api.log
      errors.py                    ApiError + FastAPI handlers -> {"error": ...}
      db.py                        session(), transaction(), migrate()
      migrations/001_init.sql
      events.py                    EventBus (per-run subscriber queues, thread-safe publish)
      jobs.py                      JobRunner, JobKind, JobContext, JobOutcome, ActiveJobError
      runs.py                      run/query/row data access, validation, status transitions
      export.py                    xlsx writers and filenames
      scrape.py                    scrape JobKind
      verify.py                    verify JobKind, VerifierThread, ingest_verified()
      fixture_search.py            search_one replacement for E2E (PIPELINE_SEARCH_BACKEND=fixture)
      deps.py                      Deps dataclass, SearchFn and PipelineRunFn types
      main.py                      create_app() factory, lifespan
      routes/
        __init__.py
        health.py                  /api/health, /api/options
        runs.py                    /api/plan, /api/runs..., /api/jobs/{id}/cancel|retry
        verify.py                  /api/runs/{id}/verify...
        brands.py                  /api/brands...
        events.py                  /api/runs/{id}/events (SSE)
    tests/
      conftest.py                  settings/app fixtures, network guard, local HTTP server, FakeSearch
      fixtures/verifier_config.yaml
      test_settings.py test_bridge.py test_db.py test_events.py test_jobs.py
      test_runs_api.py test_scrape.py test_export.py test_resume.py
      test_verify.py test_sse.py test_brands_api.py
  web/                             Next.js app (created by create-next-app)
    next.config.ts                 /api rewrite, compress: false
    app/layout.tsx app/globals.css app/page.tsx
    app/runs/new/page.tsx app/runs/[id]/page.tsx app/brands/page.tsx
    components/ (AppHeader, BackendBanner, Stepper, NativeSelect, SearchForm, PlanPreview,
                 QueryTable, SerpResultsTable, VerifyPanel, BrandRules, StatusChips,
                 VerifyResultsTable, Pager, Elapsed, ui/* from shadcn)
    lib/types.ts lib/api.ts lib/useRun.ts lib/format.ts
  e2e/
    package.json playwright.config.ts start-api.sh pages-server.mjs
    fixtures/search.json
    tests/backend-down.spec.ts tests/run-flow.spec.ts tests/brands.spec.ts
```

Changes in sibling repos:

```
CompanyMonitor/bulk_search.py              + search_one()
CompanyMonitor/tests/test_search_one.py    new
url-verification/pyproject.toml            + [build-system], wheel packages, ruamel.yaml
url-verification/urlverify/pipeline.py     run(): + rules=, + on_result=
url-verification/urlverify/brands.py       new
url-verification/tests/test_pipeline_hooks.py  new
url-verification/tests/test_brands.py      new
```

---

### Task 0: Prerequisites and baseline

Both sibling repos have uncommitted work in progress (Company Monitor: `bulk_search.py`, `frontend/src/lib/types.ts`, `frontend/src/pages/BulkSearchPage.tsx`, `tests/test_bulk_search.py`; url-verification: `config.yaml`, `pyproject.toml`, `README.md`, `benchmark.py`, tests and fixtures, deleted `VIP-scrapped.xlsx`). This task never commits, stashes or discards that work itself.

**Files:** none changed.

- [ ] **Step 1: Show the user the WIP and stop**

Run:
```bash
git -C ~/Desktop/Eminence/CompanyMonitor status --short
git -C ~/Desktop/niks/url-verification status --short
```
Report both lists to the user and ask them to commit (or explicitly approve how to handle) their WIP in both repos. Do not continue until both `git status --short` outputs are empty or the user has said exactly how to proceed.

- [ ] **Step 2: Create feature branches**

```bash
git -C ~/Desktop/Eminence/CompanyMonitor switch -c feat/pipeline-search-one
git -C ~/Desktop/niks/url-verification switch -c feat/pipeline-hooks
git -C ~/Desktop/niks/repscore-pipeline switch -c feat/v1
```

- [ ] **Step 3: Record the baseline test results**

Run:
```bash
cd ~/Desktop/Eminence/CompanyMonitor && venv/bin/python -m unittest discover -s tests -q
cd ~/Desktop/niks/url-verification && uv run pytest -q
```
Expected: both pass. If either has failures, investigate and fix them first (separate commit on the feature branch, message `fix: ...` describing the actual cause), since later tasks rely on green suites.

---

### Task 1: `bulk_search.search_one` (Company Monitor)

**Files:**
- Modify: `~/Desktop/Eminence/CompanyMonitor/bulk_search.py` (add after `_run_one_query`, before `def run(`)
- Create: `~/Desktop/Eminence/CompanyMonitor/tests/test_search_one.py`

**Interfaces:**
- Produces: `bulk_search.search_one(query, start, end, pages, vertical, provider="serpapi", stop=None) -> (rows: list[dict], error: str, attempts: int)`. `error` is `""` on success. Raises `MissingKeyError` (or DataForSEO's `MissingCredentialsError`) when the provider's key is absent. Never reads or writes `.runs/bulk_search.json`.

- [ ] **Step 1: Write the failing tests**

`tests/test_search_one.py`:
```python
import json
import os
import tempfile
import unittest
from unittest.mock import patch

import bulk_search


def _page(links):
    return {"organic_results": [{"link": l, "title": "t " + l, "snippet": "s"} for l in links],
            "serpapi_pagination": {}}


class SearchOneTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.store = os.path.join(self.tmp, "bulk_search.json")
        self.patches = [
            patch.object(bulk_search, "STORE_PATH", self.store),
            patch.dict(os.environ, {"SERPAPI_KEY": "test-key"}),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()

    def test_returns_rows_without_touching_the_store(self):
        with patch("monitor._serp_get", return_value=_page(["https://a.example/1", "https://a.example/2"])):
            rows, error, attempts = bulk_search.search_one("alpha", "", "", 1, "web")
        self.assertEqual(error, "")
        self.assertEqual(attempts, 1)
        self.assertEqual([r["link"] for r in rows], ["https://a.example/1", "https://a.example/2"])
        self.assertEqual(rows[0]["query"], "alpha")
        self.assertFalse(os.path.exists(self.store))

    def test_rows_match_what_run_stores(self):
        page = _page(["https://b.example/1"])
        with patch("monitor._serp_get", return_value=page):
            rows, _, _ = bulk_search.search_one("beta", "", "", 1, "web")
            list(bulk_search.run(["beta"], "", "", 1, "web"))
        with open(self.store) as f:
            stored = json.load(f)["rows"]
        strip = lambda r: {k: v for k, v in r.items() if k != "fetched_at"}
        self.assertEqual([strip(r) for r in rows], [strip(r) for r in stored])

    def test_news_is_clamped_to_one_page(self):
        calls = []
        def fake(params, label):
            calls.append(params)
            return {"news_results": []}
        with patch("monitor._serp_get", side_effect=fake):
            bulk_search.search_one("gamma", "", "", 7, "news")
        self.assertEqual(len(calls), 1)

    def test_missing_key_raises(self):
        with patch.dict(os.environ, {"SERPAPI_KEY": ""}):
            with self.assertRaises(bulk_search.MissingKeyError):
                bulk_search.search_one("delta", "", "", 1, "web")

    def test_failure_is_reported_not_raised(self):
        with patch("monitor._serp_get", return_value=None), \
             patch.object(bulk_search, "RETRY_BACKOFF_SECONDS", 0):
            rows, error, attempts = bulk_search.search_one("eps", "", "", 1, "web")
        self.assertEqual(rows, [])
        self.assertIn("request failed", error)
        self.assertEqual(attempts, bulk_search.QUERY_ATTEMPTS)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run to verify failure**

Run: `cd ~/Desktop/Eminence/CompanyMonitor && venv/bin/python -m unittest tests.test_search_one -v`
Expected: FAIL with `AttributeError: module 'bulk_search' has no attribute 'search_one'`.

- [ ] **Step 3: Implement**

Insert into `bulk_search.py` immediately before `def run(`:
```python
def search_one(query, start, end, pages, vertical, provider=DEFAULT_PROVIDER,
               stop=None):
    """Run ONE query with exactly the retries, throttling and 30-day cache
    run() uses, and return (rows, error, attempts) instead of storing them.
    SPENDS CREDITS on a cache miss.

    For callers that keep their own per-run results (the RepScore pipeline
    app): run() appends to the single global store and its events carry
    counts, not rows. This never reads or writes that store.

    `pages` goes through pages_for, so news is one call and DataForSEO is
    capped at its ceiling, matching plan(). `error` is "" on success. A
    missing key raises MissingKeyError (or DataForSEO's
    MissingCredentialsError) because that is a configuration problem, not a
    failed query. `stop` is a threading.Event; when set, a query waiting in
    retry backoff gives up instead of spending another attempt.
    """
    pages = pages_for(vertical, pages, provider)
    check_credentials(provider)
    key = api_key() if provider != "dataforseo" else None
    fetched_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    return _run_one_query(query, start, end, pages, vertical, key, fetched_at,
                          provider, stop)
```

- [ ] **Step 4: Run the new tests and the full suite**

Run: `venv/bin/python -m unittest tests.test_search_one -v && venv/bin/python -m unittest discover -s tests -q`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add bulk_search.py tests/test_search_one.py
git commit -m "feat: add bulk_search.search_one for callers that keep their own results"
```

---

### Task 2: `pipeline.run` keywords `rules` and `on_result`, and packaging (url-verification)

**Files:**
- Modify: `~/Desktop/niks/url-verification/urlverify/pipeline.py` (`run` signature and body)
- Modify: `~/Desktop/niks/url-verification/pyproject.toml`
- Create: `~/Desktop/niks/url-verification/tests/test_pipeline_hooks.py`

**Interfaces:**
- Produces: `urlverify.pipeline.run(input_path, output_path, cfg, brand, cache_dir="cache", refetch=False, retry_failed=False, use_tier2=True, limit=None, verbose=False, progress=None, proxy=None, report_path=None, rules=None, on_result=None) -> dict`. With `rules` given, `resolve_brand` is not called. `on_result(status: str)` is called once per unique URL after it finishes.
- Produces: url-verification installable as a path package `url-verification` exposing `urlverify`.

- [ ] **Step 1: Write the failing tests**

`tests/test_pipeline_hooks.py`:
```python
from pathlib import Path
from unittest.mock import patch

import pandas as pd

from urlverify.config import load_config
from urlverify.models import STATUS_NOT_FOUND, STATUS_VERIFIED, BrandRule
from urlverify.pipeline import run

ROOT = Path(__file__).resolve().parents[1]


def _input(tmp_path, server):
    df = pd.DataFrame({"Query": ["q", "q", "q"], "Title": ["a", "b", "c"], "Snippet": ["", "", ""],
                       "Link": [server + "/ok", server + "/ok?utm_source=x", server + "/missing"]})
    path = tmp_path / "in.xlsx"
    df.to_excel(path, index=False)
    return path


def _cfg():
    cfg = load_config(ROOT / "config.yaml")
    cfg.fetch["retries"] = 0
    cfg.fetch["per_domain_gap_seconds"] = 0
    return cfg


async def test_rules_bypass_resolve_brand(server, tmp_path):
    inp = _input(tmp_path, server)
    rules = [BrandRule(name="VIP Industries", pattern="VIP Industries")]
    with patch("urlverify.pipeline.resolve_brand", side_effect=AssertionError("must not resolve by name")):
        counts = await run(inp, tmp_path / "out.xlsx", _cfg(), "label-only", cache_dir=tmp_path / "c",
                           use_tier2=False, rules=rules)
    assert counts[STATUS_VERIFIED] == 1


async def test_rules_are_the_rules_used(server, tmp_path):
    inp = _input(tmp_path, server)
    counts = await run(inp, tmp_path / "out.xlsx", _cfg(), "vip", cache_dir=tmp_path / "c",
                       use_tier2=False, rules=[BrandRule(name="Acme", pattern="Acme")])
    assert counts.get(STATUS_VERIFIED, 0) == 0
    assert counts[STATUS_NOT_FOUND] == 1


async def test_on_result_called_once_per_unique_url(server, tmp_path):
    inp = _input(tmp_path, server)
    seen: list[str] = []
    counts = await run(inp, tmp_path / "out.xlsx", _cfg(), "vip", cache_dir=tmp_path / "c",
                       use_tier2=False, on_result=seen.append)
    assert len(seen) == counts["_unique"] == 2
    assert sorted(seen) == sorted(s for s in counts if not s.startswith("_") for _ in range(counts[s]))


async def test_explicit_rules_match_named_set_cell_for_cell(server, tmp_path):
    inp = _input(tmp_path, server)
    cfg = _cfg()
    await run(inp, tmp_path / "a.xlsx", cfg, "vip", cache_dir=tmp_path / "c", use_tier2=False)
    await run(inp, tmp_path / "b.xlsx", cfg, "vip", cache_dir=tmp_path / "c", use_tier2=False,
              rules=cfg.brands["vip"])
    a = pd.read_excel(tmp_path / "a.xlsx").fillna("")
    b = pd.read_excel(tmp_path / "b.xlsx").fillna("")
    pd.testing.assert_frame_equal(a, b)
```

- [ ] **Step 2: Run to verify failure**

Run: `cd ~/Desktop/niks/url-verification && uv run pytest tests/test_pipeline_hooks.py -v`
Expected: FAIL with `TypeError: run() got an unexpected keyword argument 'rules'`.

- [ ] **Step 3: Implement the keywords**

In `urlverify/pipeline.py` add to the imports:
```python
from collections.abc import Callable

from .models import BrandRule
```
(merge `BrandRule` into the existing `from .models import ...` line). Replace the `run` signature and its first line:
```python
async def run(input_path, output_path, cfg: Config, brand: str, cache_dir="cache", refetch=False, retry_failed=False,
              use_tier2=True, limit=None, verbose=False, progress=None, proxy=None, report_path=None,
              rules: list[BrandRule] | None = None, on_result: Callable[[str], None] | None = None) -> dict:
    # Explicit rules win and skip the by-name lookup entirely, so a caller holding a snapshot is never affected by
    # later edits to config.yaml. `brand` is then only a label.
    if rules is None:
        rules, _ = resolve_brand(cfg, brand)
```
In the inner `one()` function, after the `if progress: progress()` lines, add:
```python
        if on_result:
            on_result(r.status)
```

- [ ] **Step 4: Add packaging metadata**

Append to `pyproject.toml`:
```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["urlverify"]
```

- [ ] **Step 5: Run tests**

Run: `uv sync && uv run pytest -q`
Expected: all PASS, including the four new tests. Also run `uv run verify_urls.py --help` and confirm it prints usage (CLI unaffected).

- [ ] **Step 6: Commit**

```bash
git add urlverify/pipeline.py pyproject.toml uv.lock tests/test_pipeline_hooks.py
git commit -m "feat: pipeline.run accepts explicit brand rules and a per-URL result callback"
```

---

### Task 3: `urlverify/brands.py` brand-set editor helpers (url-verification)

**Files:**
- Create: `~/Desktop/niks/url-verification/urlverify/brands.py`
- Create: `~/Desktop/niks/url-verification/tests/test_brands.py`
- Modify: `~/Desktop/niks/url-verification/pyproject.toml` (add `ruamel.yaml` dependency via `uv add`)

**Interfaces:**
- Produces:
  - `list_sets(config_path) -> dict[str, list[BrandRule]]`
  - `validate_set(name: str, rules: list[BrandRule]) -> None` (raises `ConfigError` naming rule index, rule name and field)
  - `save_set(config_path, name: str, rules: list[BrandRule]) -> Path` (returns the backup path)
  - `delete_set(config_path, name: str) -> Path` (returns the backup path; refuses the last set)
  - `try_rules(rules: list[BrandRule], text: str) -> dict` with keys `hits: list[{"brand","offset","snippet"}]` (exactly `BrandMatcher.find(text, "body")`) and `excluded: list[{"brand","offset","text","reason"}]`
  - `rule_to_dict(rule) -> dict` and `rule_from_dict(d) -> BrandRule`

- [ ] **Step 1: Add the dependency**

Run: `cd ~/Desktop/niks/url-verification && uv add "ruamel.yaml>=0.18"`

- [ ] **Step 2: Write the failing tests**

`tests/test_brands.py`:
```python
from pathlib import Path

import pytest

from urlverify import brands
from urlverify.config import ConfigError, load_config
from urlverify.match import BrandMatcher
from urlverify.models import BrandRule

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def cfg_path(tmp_path):
    p = tmp_path / "config.yaml"
    p.write_text((ROOT / "config.yaml").read_text())
    return p


def test_list_sets_matches_load_config(cfg_path):
    assert brands.list_sets(cfg_path) == load_config(cfg_path).brands


def test_save_new_set_preserves_comments_and_loads(cfg_path):
    before = cfg_path.read_text()
    comment = "# Runtime configuration for verify_urls.py. Every threshold and list lives here."
    assert comment in before
    rules = [BrandRule(name="Acme", pattern=r"Acme|[#@]acme\w*", require_context=["luggage"],
                       exclude=[r"Acme (Corp|Inc)"], case_sensitive=True, context_window=40)]
    backup = brands.save_set(cfg_path, "acme", rules)
    after = cfg_path.read_text()
    assert comment in after
    assert "# Named sets; --brand picks one." in after
    assert load_config(cfg_path).brands["acme"] == rules
    assert backup.read_text() == before


def test_round_trip_existing_set_is_unchanged(cfg_path):
    original = brands.list_sets(cfg_path)
    brands.save_set(cfg_path, "safari", original["safari"])
    assert brands.list_sets(cfg_path) == original
    assert list(brands.list_sets(cfg_path)) == list(original)  # set order kept


def test_invalid_regex_names_rule_and_field(cfg_path):
    bad = [BrandRule(name="Ok", pattern="Ok"), BrandRule(name="Broken", pattern="Br(oken", exclude=[])]
    with pytest.raises(ConfigError, match=r"rule 2 \('Broken'\).*pattern"):
        brands.save_set(cfg_path, "acme", bad)
    bad_ctx = [BrandRule(name="Ctx", pattern="Ctx", require_context=["[unclosed"])]
    with pytest.raises(ConfigError, match=r"rule 1 \('Ctx'\).*require_context"):
        brands.save_set(cfg_path, "acme", bad_ctx)
    assert "acme" not in brands.list_sets(cfg_path)


@pytest.mark.parametrize("name", ["", "Has Space", "UPPER", "-lead", "x" * 65])
def test_invalid_set_name(cfg_path, name):
    with pytest.raises(ConfigError, match="set name"):
        brands.save_set(cfg_path, name, [BrandRule(name="A", pattern="A")])


def test_empty_rules_rejected(cfg_path):
    with pytest.raises(ConfigError, match="at least one rule"):
        brands.save_set(cfg_path, "acme", [])


def test_delete_set_and_refuse_last(tmp_path):
    p = tmp_path / "config.yaml"
    p.write_text("brands:\n  a:\n    - name: A\n      pattern: 'A'\n  b:\n    - name: B\n      pattern: 'B'\n")
    brands.delete_set(p, "a")
    assert list(brands.list_sets(p)) == ["b"]
    with pytest.raises(ConfigError, match="last brand set"):
        brands.delete_set(p, "b")
    with pytest.raises(ConfigError, match="no brand set"):
        brands.delete_set(p, "zzz")


def test_try_rules_hits_equal_matcher(cfg_path):
    rules = brands.list_sets(cfg_path)["safari"]
    text = ("Safari Industries posted strong luggage sales. We went on a jungle safari last week. "
            "Open the page in Apple Safari to read more.")
    result = brands.try_rules(rules, text)
    expected = BrandMatcher(rules).find(text, "body")
    assert [(h["brand"], h["offset"]) for h in result["hits"]] == [(h.brand, h.offset) for h in expected]
    reasons = {e["text"].lower(): e["reason"] for e in result["excluded"]}
    assert any("excluded by" in r for r in reasons.values())


def test_try_rules_reports_missing_context():
    rules = [BrandRule(name="Genie", pattern="Genie", case_sensitive=True, require_context=["luggage"])]
    result = brands.try_rules(rules, "Genie made a wish come true.")
    assert result["hits"] == []
    assert result["excluded"][0]["reason"].startswith("no context word")


def test_rule_dict_round_trip():
    r = BrandRule(name="A", pattern="A", require_context=["x"], exclude=["y"], case_sensitive=True, context_window=10)
    assert brands.rule_from_dict(brands.rule_to_dict(r)) == r
    with pytest.raises(ConfigError, match="unknown field"):
        brands.rule_from_dict({"name": "A", "pattern": "A", "colour": "red"})
```

- [ ] **Step 3: Run to verify failure**

Run: `uv run pytest tests/test_brands.py -v`
Expected: FAIL with `ImportError: cannot import name 'brands' from 'urlverify'`.

- [ ] **Step 4: Implement**

`urlverify/brands.py`:
```python
"""Read, write and try out brand sets in config.yaml without losing its comments.

Used by the RepScore pipeline app's brand editor. Hits reported by try_rules come from BrandMatcher itself, so the
editor's test box and a real verification run always agree; the `excluded` list is an explanation layered on top.
"""
from __future__ import annotations

import io
import os
import re
import shutil
import tempfile
import time
from dataclasses import asdict, fields
from pathlib import Path

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap, CommentedSeq
from ruamel.yaml.scalarstring import SingleQuotedScalarString

from .config import ConfigError, load_config
from .match import BrandMatcher, word_window
from .models import BrandRule

NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
_DEFAULT = BrandRule(name="", pattern="")
_FIELDS = {f.name for f in fields(BrandRule)}


def _yaml() -> YAML:
    y = YAML()
    y.preserve_quotes = True
    y.width = 4096
    y.indent(mapping=2, sequence=4, offset=2)
    return y


def list_sets(config_path: str | Path) -> dict[str, list[BrandRule]]:
    return load_config(config_path).brands


def rule_to_dict(rule: BrandRule) -> dict:
    return asdict(rule)


def rule_from_dict(d: dict) -> BrandRule:
    unknown = set(d) - _FIELDS
    if unknown:
        raise ConfigError(f"unknown field(s) in brand rule: {sorted(unknown)}")
    try:
        return BrandRule(**d)
    except TypeError as e:
        raise ConfigError(f"bad brand rule {d!r}: {e}") from e


def validate_set(name: str, rules: list[BrandRule]) -> None:
    if not NAME_RE.match(name or ""):
        raise ConfigError(f"set name {name!r} must be 1-64 characters of a-z, 0-9, '_' or '-', starting with a letter "
                          "or digit")
    if not rules:
        raise ConfigError(f"brand set {name!r} needs at least one rule")
    for i, rule in enumerate(rules, start=1):
        where = f"rule {i} ({rule.name!r})"
        if not rule.name.strip():
            raise ConfigError(f"rule {i}: name is required")
        if not rule.pattern.strip():
            raise ConfigError(f"{where}: pattern is required")
        if rule.context_window <= 0:
            raise ConfigError(f"{where}: context_window must be positive")
        for field_name, patterns in (("pattern", [rule.pattern]), ("require_context", rule.require_context),
                                     ("exclude", rule.exclude)):
            for rx in patterns:
                try:
                    re.compile(rx)
                except re.error as e:
                    raise ConfigError(f"{where}: invalid regex in {field_name}: {rx!r}: {e}") from e


def _rule_node(rule: BrandRule) -> CommentedMap:
    node = CommentedMap()
    node["name"] = rule.name
    node["pattern"] = SingleQuotedScalarString(rule.pattern)
    if rule.case_sensitive != _DEFAULT.case_sensitive:
        node["case_sensitive"] = rule.case_sensitive
    if rule.context_window != _DEFAULT.context_window:
        node["context_window"] = rule.context_window
    for key in ("require_context", "exclude"):
        values = getattr(rule, key)
        if values:
            seq = CommentedSeq([SingleQuotedScalarString(v) for v in values])
            seq.fa.set_flow_style()
            node[key] = seq
    return node


def _write(config_path: Path, doc) -> Path:
    """Validate the new document by loading it, back up the old file, then atomically replace it."""
    buf = io.StringIO()
    _yaml().dump(doc, buf)
    text = buf.getvalue()
    fd, tmp = tempfile.mkstemp(dir=config_path.parent, prefix=".config_", suffix=".yaml")
    try:
        with os.fdopen(fd, "w") as f:
            f.write(text)
        load_config(tmp)  # never write a file the verifier cannot read
        backup = config_path.with_name(f"{config_path.name}.bak-{time.strftime('%Y%m%d-%H%M%S')}")
        n = 1
        while backup.exists():
            backup = config_path.with_name(f"{config_path.name}.bak-{time.strftime('%Y%m%d-%H%M%S')}-{n}")
            n += 1
        shutil.copy2(config_path, backup)
        os.replace(tmp, config_path)
        return backup
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def _load_doc(config_path: Path):
    return _yaml().load(config_path.read_text())


def save_set(config_path: str | Path, name: str, rules: list[BrandRule]) -> Path:
    config_path = Path(config_path)
    validate_set(name, rules)
    doc = _load_doc(config_path)
    seq = CommentedSeq([_rule_node(r) for r in rules])
    doc["brands"][name] = seq  # an existing key keeps its position
    return _write(config_path, doc)


def delete_set(config_path: str | Path, name: str) -> Path:
    config_path = Path(config_path)
    doc = _load_doc(config_path)
    sets = doc["brands"]
    if name not in sets:
        raise ConfigError(f"no brand set named {name!r}")
    if len(sets) == 1:
        raise ConfigError("cannot delete the last brand set; the verifier needs at least one")
    del sets[name]
    return _write(config_path, doc)


def try_rules(rules: list[BrandRule], text: str) -> dict:
    matcher = BrandMatcher(rules)
    hits = matcher.find(text, "body")
    hit_spans = {(h.brand, h.offset) for h in hits}
    excluded = []
    for rule in rules:
        flags = 0 if rule.case_sensitive else re.IGNORECASE
        pat = re.compile(rf"(?<![\w-])(?:{rule.pattern})(?![\w-])", flags)
        exclusions = [(m.span(), e) for e in rule.exclude for m in re.finditer(e, text, flags)]
        for m in pat.finditer(text):
            s, e = m.span()
            if (rule.name, s) in hit_spans:
                continue
            covering = next((rx for (a, b), rx in exclusions if a <= s and e <= b), None)
            if covering:
                reason = f"excluded by {covering!r}"
            elif rule.require_context:
                reason = f"no context word within {rule.context_window} characters"
            else:
                reason = "overlaps a longer match from another rule"
            excluded.append({"brand": rule.name, "offset": s, "text": m.group(0), "reason": reason,
                             "snippet": word_window(text, s, e, 8)})
    return {
        "hits": [{"brand": h.brand, "offset": h.offset, "snippet": h.snippet} for h in hits],
        "excluded": sorted(excluded, key=lambda x: x["offset"]),
    }
```

Note on `try_rules`: when both an exclusion and a missing context word apply, the exclusion is reported (it is checked first by `BrandMatcher.find` too). A rule with `require_context` whose hit is rejected because a longer rule already claimed the span is reported as "no context word"; that imprecision is acceptable for a test box because `hits` stays authoritative.

- [ ] **Step 5: Run tests**

Run: `uv run pytest -q`
Expected: all PASS. If `test_round_trip_existing_set_is_unchanged` fails on list equality because YAML normalises a value (for example an int written as string), fix `_rule_node` to preserve the type rather than weakening the test.

- [ ] **Step 6: Commit**

```bash
git add urlverify/brands.py tests/test_brands.py pyproject.toml uv.lock
git commit -m "feat: brand set helpers that edit config.yaml without losing comments"
```

---

### Task 4: API scaffold: settings, Company Monitor bridge, logging, errors, health

**Files:**
- Create: `api/pyproject.toml`, `api/pipeline_api/__init__.py` (empty), `api/pipeline_api/settings.py`, `api/pipeline_api/monitor_bridge.py`, `api/pipeline_api/logs.py`, `api/pipeline_api/errors.py`, `api/pipeline_api/deps.py`, `api/pipeline_api/routes/__init__.py` (empty), `api/pipeline_api/routes/health.py`, `api/pipeline_api/main.py`
- Create: `api/tests/conftest.py`, `api/tests/test_settings.py`, `api/tests/test_bridge.py`
- Create: `Makefile`, `.gitignore`

**Interfaces:**
- Produces:
  - `Settings(company_monitor_dir, url_verification_dir, verifier_config, verifier_cache, data_dir, search_backend="live", search_fixture=None)` with `.db_path`, `.exports_dir`, `.logs_dir`, `.check()`; `load_settings(env: Mapping[str, str] | None = None) -> Settings`
  - `load_bulk_search(company_monitor_dir: Path) -> ModuleType`, `key_errors(bs) -> tuple[type[Exception], ...]`, `provider_key_status(bs) -> dict[str, str | None]` (None = key OK, else the message)
  - `ApiError(status: int, message: str, **extra)`; responses are `{"error": message, **extra}`
  - `Deps(settings, bs, search_one, pipeline_run)`; `SearchFn`, `PipelineRunFn` type aliases
  - `create_app(settings=None, *, search_one=None, pipeline_run=None) -> FastAPI`
  - `GET /api/health` -> `{"ok": bool, "company_monitor": bool, "url_verification": bool, "verifier_config_error": str | None, "keys": {"serpapi": str | None, "dataforseo": str | None}, "chromium": bool}`
  - `GET /api/options` -> `{"providers": [...], "verticals": ["web","news","news_tab"], "max_pages": {"serpapi": 50, "dataforseo": 20}}`
  - Test fixtures: `settings` (tmp data dir, tmp verifier config copied from `tests/fixtures/verifier_config.yaml`, tmp cache), network guard (autouse)

- [ ] **Step 1: Create the uv project**

`api/pyproject.toml`:
```toml
[project]
name = "repscore-pipeline-api"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.32",
    "openpyxl>=3.1.5",
    "python-dotenv>=1.0",
    "url-verification",
    # Company Monitor is imported from its folder (monitor_bridge.py), not installed. These are the entries of its
    # requirements.txt that bulk_search, monitor, net and dataforseo_serp import. test_bridge.py fails if one is missing.
    "requests>=2.31",
    "feedparser>=6.0",
    "PyYAML>=6.0",
    "beautifulsoup4>=4.12",
]

[tool.uv.sources]
url-verification = { path = "../../url-verification", editable = true }

[dependency-groups]
dev = ["pytest>=8", "pytest-asyncio>=0.24", "httpx>=0.27", "ruff>=0.7", "pyright>=1.1.390"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["pipeline_api"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
asyncio_default_fixture_loop_scope = "function"
testpaths = ["tests"]
filterwarnings = ["error"]

[tool.ruff]
line-length = 120
target-version = "py312"

[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP", "SIM"]

[tool.pyright]
include = ["pipeline_api", "tests"]
typeCheckingMode = "standard"
pythonVersion = "3.12"
```
Run: `cd ~/Desktop/niks/repscore-pipeline/api && uv sync`

- [ ] **Step 2: Write the failing tests**

`api/tests/fixtures/verifier_config.yaml` (a small real config the verifier accepts):
```yaml
# Test verifier config.
fetch:
  global_concurrency: 4
  per_domain_concurrency: 2
  per_domain_gap_seconds: 0
  http_timeout_seconds: 5
  browser_timeout_seconds: 10
  browser_concurrency: 1
  retries: 0
  min_main_text_chars: 200
  user_agent: "Mozilla/5.0 test"
match:
  context_words: 15
  snippet_found_threshold: 80
report:
  opening_words: 60
verdict:
  min_paragraphs: 2
  min_paragraph_share: 0.25
  max_context_paragraphs: 5
  max_context_chars: 4000
tracking_params: [fbclid, gclid]
brands:
  # Acme is a coined test brand.
  acme:
    - name: Acme
      pattern: 'Acme|[#@]acme\w*'
  other:
    - name: Other Brand
      pattern: 'Other Brand'
categories:
  news: [news.example]
platform_domains:
  reddit: [reddit.com]
unsupported_platforms: [reddit]
```

`api/tests/conftest.py`:
```python
import shutil
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from pipeline_api.settings import Settings, load_settings

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def settings(tmp_path) -> Settings:
    base = load_settings({})
    cfg = tmp_path / "verifier" / "config.yaml"
    cfg.parent.mkdir()
    shutil.copy(FIXTURES / "verifier_config.yaml", cfg)
    return Settings(
        company_monitor_dir=base.company_monitor_dir,
        url_verification_dir=base.url_verification_dir,
        verifier_config=cfg,
        verifier_cache=tmp_path / "verifier" / "cache",
        data_dir=tmp_path / "data",
    )


class _NoNetwork:
    def get(self, *a, **k):
        raise AssertionError("tests must not make live provider requests")

    post = get


@pytest.fixture(autouse=True)
def no_live_provider_calls(monkeypatch, tmp_path):
    """Company Monitor's shared requests session and disk cache are replaced for every test."""
    from pipeline_api.monitor_bridge import load_bulk_search

    load_bulk_search(load_settings({}).company_monitor_dir)
    import net

    monkeypatch.setattr(net, "_session", _NoNetwork())
    monkeypatch.setattr(net, "CACHE_DIR", str(tmp_path / "monitor-cache"))


PARA = "Acme reported steady growth in its luggage business this quarter across every region it serves. "
FILLER = "Travel gear demand stayed firm as more families booked trips during the long holiday season. "
PAGES = {
    "/acme": "<html><head><title>Acme grows</title></head><body><article><h1>Acme grows</h1>"
    + "".join(f"<p>{PARA}</p>" for _ in range(3)) + "</article></body></html>",
    "/plain": "<html><head><title>Travel</title></head><body><article><h1>Travel</h1>"
    + "".join(f"<p>{FILLER}</p>" for _ in range(4)) + "</article></body></html>",
}


class _Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        body = PAGES.get(self.path.split("?")[0])
        status = 200 if body else 404
        data = (body or "<html><body>missing</body></html>").encode()
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *a):
        pass


@pytest.fixture(scope="session")
def page_server():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()
```

`api/tests/test_settings.py`:
```python
from pathlib import Path

import pytest

from pipeline_api.settings import Settings, load_settings


def test_defaults_point_at_sibling_repos():
    s = load_settings({})
    assert s.company_monitor_dir == Path.home() / "Desktop/Eminence/CompanyMonitor"
    assert s.url_verification_dir == Path.home() / "Desktop/niks/url-verification"
    assert s.verifier_config == s.url_verification_dir / "config.yaml"
    assert s.verifier_cache == s.url_verification_dir / "cache"
    assert s.data_dir.name == "data" and s.data_dir.parent.name == "repscore-pipeline"
    assert s.search_backend == "live"


def test_env_overrides(tmp_path):
    s = load_settings({"PIPELINE_DATA_DIR": str(tmp_path), "URL_VERIFICATION_CONFIG": str(tmp_path / "c.yaml"),
                       "PIPELINE_SEARCH_BACKEND": "fixture", "PIPELINE_SEARCH_FIXTURE": str(tmp_path / "f.json")})
    assert s.data_dir == tmp_path and s.db_path == tmp_path / "app.db"
    assert s.verifier_config == tmp_path / "c.yaml"
    assert s.search_backend == "fixture" and s.search_fixture == tmp_path / "f.json"


def test_check_names_missing_path(settings: Settings, tmp_path):
    settings.check()
    broken = Settings(**{**settings.__dict__, "verifier_config": tmp_path / "nope.yaml"})
    with pytest.raises(RuntimeError, match="URL_VERIFICATION_CONFIG"):
        broken.check()


def test_fixture_backend_requires_fixture(settings: Settings):
    broken = Settings(**{**settings.__dict__, "search_backend": "fixture"})
    with pytest.raises(RuntimeError, match="PIPELINE_SEARCH_FIXTURE"):
        broken.check()
```

`api/tests/test_bridge.py`:
```python
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
```

- [ ] **Step 3: Run to verify failure**

Run: `uv run pytest -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'pipeline_api.settings'`.

- [ ] **Step 4: Implement settings, bridge, logs, errors, deps**

`api/pipeline_api/settings.py`:
```python
"""Where the two sibling repos, the verifier config and this app's data live."""
from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class Settings:
    company_monitor_dir: Path
    url_verification_dir: Path
    verifier_config: Path
    verifier_cache: Path
    data_dir: Path
    search_backend: str = "live"  # "live" | "fixture"
    search_fixture: Path | None = None

    @property
    def db_path(self) -> Path:
        return self.data_dir / "app.db"

    @property
    def exports_dir(self) -> Path:
        return self.data_dir / "exports"

    @property
    def logs_dir(self) -> Path:
        return self.data_dir / "logs"

    def check(self) -> None:
        """Fail at startup, naming the setting and path, instead of on the first request."""
        required = (
            ("COMPANY_MONITOR_DIR", self.company_monitor_dir / "bulk_search.py"),
            ("URL_VERIFICATION_DIR", self.url_verification_dir / "urlverify"),
            ("URL_VERIFICATION_CONFIG", self.verifier_config),
        )
        for label, path in required:
            if not path.exists():
                raise RuntimeError(f"{label}: {path} does not exist")
        if self.search_backend not in ("live", "fixture"):
            raise RuntimeError(f"PIPELINE_SEARCH_BACKEND must be 'live' or 'fixture', not {self.search_backend!r}")
        if self.search_backend == "fixture" and (self.search_fixture is None or not self.search_fixture.exists()):
            raise RuntimeError("PIPELINE_SEARCH_FIXTURE must point to an existing file when "
                               "PIPELINE_SEARCH_BACKEND=fixture")


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    env = os.environ if env is None else env
    home = Path.home()
    uv_dir = Path(env.get("URL_VERIFICATION_DIR", str(home / "Desktop/niks/url-verification"))).expanduser()
    fixture = env.get("PIPELINE_SEARCH_FIXTURE")
    return Settings(
        company_monitor_dir=Path(env.get("COMPANY_MONITOR_DIR", str(home / "Desktop/Eminence/CompanyMonitor")))
        .expanduser(),
        url_verification_dir=uv_dir,
        verifier_config=Path(env.get("URL_VERIFICATION_CONFIG", str(uv_dir / "config.yaml"))).expanduser(),
        verifier_cache=Path(env.get("URL_VERIFICATION_CACHE", str(uv_dir / "cache"))).expanduser(),
        data_dir=Path(env.get("PIPELINE_DATA_DIR", str(REPO_ROOT / "data"))).expanduser(),
        search_backend=env.get("PIPELINE_SEARCH_BACKEND", "live"),
        search_fixture=Path(fixture).expanduser() if fixture else None,
    )
```

`api/pipeline_api/monitor_bridge.py`:
```python
"""Import Company Monitor's bulk_search from its own folder, in place.

Company Monitor is a folder of flat modules, not a package, and it has its own app.py and config/. Its folder is
appended to sys.path (never prepended) so nothing there can shadow a module of this app.
"""
from __future__ import annotations

import importlib
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

from dotenv import load_dotenv


def load_bulk_search(company_monitor_dir: Path) -> ModuleType:
    # Keys live in Company Monitor's .env; override=False so a value exported in the shell wins.
    load_dotenv(company_monitor_dir / ".env", override=False)
    path = str(company_monitor_dir)
    if path not in sys.path:
        sys.path.append(path)
    return importlib.import_module("bulk_search")


def key_errors(bs: Any) -> tuple[type[Exception], ...]:
    return (bs.MissingKeyError, bs.dataforseo_serp.MissingCredentialsError)


def provider_key_status(bs: Any) -> dict[str, str | None]:
    """provider -> None when its credentials are present, else the message saying what to set."""
    status: dict[str, str | None] = {}
    for provider in bs.PROVIDERS:
        try:
            bs.check_credentials(provider)
            status[provider] = None
        except key_errors(bs) as e:
            status[provider] = str(e)
    return status
```

`api/pipeline_api/logs.py`:
```python
"""JSON-lines logs with run and job IDs on every line that has them."""
from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        for key in ("run_id", "job_id"):
            if hasattr(record, key):
                entry[key] = getattr(record, key)
        if record.exc_info:
            entry["exc"] = self.formatException(record.exc_info)
        return json.dumps(entry)


def configure_logging(logs_dir: Path) -> None:
    logs_dir.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("pipeline_api")
    logger.setLevel(logging.INFO)
    target = str(logs_dir / "api.log")
    if not any(isinstance(h, RotatingFileHandler) and h.baseFilename == target for h in logger.handlers):
        handler = RotatingFileHandler(target, maxBytes=10_000_000, backupCount=3)
        handler.setFormatter(JsonFormatter())
        logger.addHandler(handler)
```

`api/pipeline_api/errors.py`:
```python
"""Every error response is {"error": "<what failed and what to do>", ...extra}."""
from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class ApiError(Exception):
    def __init__(self, status: int, message: str, **extra: Any):
        super().__init__(message)
        self.status = status
        self.message = message
        self.extra = extra


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse({"error": exc.message, **exc.extra}, status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        first = exc.errors()[0] if exc.errors() else {"loc": [], "msg": "invalid request"}
        where = ".".join(str(p) for p in first.get("loc", []) if p != "body")
        return JSONResponse({"error": f"{where}: {first.get('msg')}" if where else str(first.get("msg"))},
                            status_code=422)
```

`api/pipeline_api/deps.py`:
```python
"""What route handlers and jobs need, bundled so tests can swap the provider and the verifier."""
from __future__ import annotations

import threading
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from .settings import Settings

# (query, start, end, pages, vertical, provider, stop) -> (rows, error, attempts); same as bulk_search.search_one
SearchFn = Callable[[str, str, str, int, str, str, threading.Event | None], tuple[list[dict[str, Any]], str, int]]
# Same signature as urlverify.pipeline.run
PipelineRunFn = Callable[..., Awaitable[dict[str, Any]]]


@dataclass
class Deps:
    settings: Settings
    bs: Any  # the bulk_search module
    search_one: SearchFn
    pipeline_run: PipelineRunFn
```

- [ ] **Step 5: Implement health routes and the app factory**

`api/pipeline_api/routes/health.py`:
```python
from __future__ import annotations

import glob
import os
from pathlib import Path

from fastapi import APIRouter, Request

from ..monitor_bridge import provider_key_status

router = APIRouter()
VERTICALS = ("web", "news", "news_tab")  # Company Monitor app.py BULK_VERTICALS


def _chromium_installed() -> bool:
    root = os.environ.get("PLAYWRIGHT_BROWSERS_PATH") or str(Path.home() / "Library/Caches/ms-playwright")
    return bool(glob.glob(os.path.join(root, "chromium*")))


@router.get("/api/health")
def health(request: Request) -> dict:
    deps = request.app.state.deps
    from urlverify.config import ConfigError, load_config

    config_error = None
    try:
        load_config(deps.settings.verifier_config)
    except (ConfigError, OSError, ValueError) as e:
        config_error = str(e)
    keys = provider_key_status(deps.bs)
    result = {
        "company_monitor": (deps.settings.company_monitor_dir / "bulk_search.py").exists(),
        "url_verification": (deps.settings.url_verification_dir / "urlverify").exists(),
        "verifier_config_error": config_error,
        "keys": keys,
        "chromium": _chromium_installed(),
    }
    result["ok"] = bool(result["company_monitor"] and result["url_verification"] and config_error is None
                        and result["chromium"])
    return result


@router.get("/api/options")
def options(request: Request) -> dict:
    bs = request.app.state.deps.bs
    return {"providers": list(bs.PROVIDERS), "verticals": list(VERTICALS),
            "max_pages": {p: bs.max_pages_for(p) for p in bs.PROVIDERS}}
```

`api/pipeline_api/main.py`:
```python
"""FastAPI app factory. Start with: uvicorn pipeline_api.main:create_app --factory --host 127.0.0.1 --port 8000"""
from __future__ import annotations

from fastapi import FastAPI

from .deps import Deps, PipelineRunFn, SearchFn
from .errors import install_error_handlers
from .logs import configure_logging
from .monitor_bridge import load_bulk_search
from .routes import health
from .settings import Settings, load_settings


def create_app(settings: Settings | None = None, *, search_one: SearchFn | None = None,
               pipeline_run: PipelineRunFn | None = None) -> FastAPI:
    settings = settings or load_settings()
    settings.check()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.exports_dir.mkdir(parents=True, exist_ok=True)
    configure_logging(settings.logs_dir)
    bs = load_bulk_search(settings.company_monitor_dir)
    if pipeline_run is None:
        from urlverify.pipeline import run as pipeline_run
    deps = Deps(settings=settings, bs=bs, search_one=search_one or bs.search_one, pipeline_run=pipeline_run)

    app = FastAPI(title="RepScore Pipeline API")
    app.state.deps = deps
    install_error_handlers(app)
    app.include_router(health.router)
    return app
```

- [ ] **Step 6: Makefile and .gitignore**

`.gitignore` (repo root):
```
data/
e2e/.tmp/
e2e/test-results/
e2e/playwright-report/
node_modules/
.venv/
__pycache__/
.next/
.DS_Store
```

`Makefile` (repo root):
```make
COMPANY_MONITOR_DIR ?= $(HOME)/Desktop/Eminence/CompanyMonitor
URL_VERIFICATION_DIR ?= $(HOME)/Desktop/niks/url-verification
API = uv run uvicorn pipeline_api.main:create_app --factory --host 127.0.0.1 --port 8000

.PHONY: install dev start lint test e2e check

install:
	cd api && uv sync
	cd web && npm install
	cd e2e && npm install && npx playwright install chromium

dev:
	@trap 'kill 0' EXIT; \
	(cd api && $(API) --reload) & \
	(cd web && npm run dev) & \
	wait

start:
	cd web && npm run build
	@trap 'kill 0' EXIT; \
	(cd api && $(API)) & \
	(cd web && npm run start) & \
	wait

lint:
	cd api && uv run ruff check . && uv run ruff format --check . && uv run pyright
	cd web && npm run lint && npx tsc --noEmit

test:
	cd api && uv run pytest -q
	cd $(COMPANY_MONITOR_DIR) && venv/bin/python -m unittest discover -s tests -q
	cd $(URL_VERIFICATION_DIR) && uv run pytest -q

e2e:
	cd e2e && npx playwright test

check: lint test e2e
```
(`web` and `e2e` targets start working in Task 12.)

- [ ] **Step 7: Run tests and lint**

Run: `cd api && uv run pytest -q && uv run ruff check . && uv run ruff format --check . && uv run pyright`
Expected: all PASS, zero warnings. Fix any pyright complaints in the new code rather than suppressing them. `filterwarnings = ["error"]` turns every warning into a failure: fix warnings from this repo's code at the cause; for a warning raised inside a third-party package that cannot be fixed here, add one narrowly scoped `"ignore:<message>:<Category>:<module>"` entry with a comment naming the package and why.

- [ ] **Step 8: Commit**

```bash
git add .gitignore Makefile api
git commit -m "feat: api scaffold with settings, company monitor bridge and health endpoint"
```

---

### Task 5: Database and migration

**Files:**
- Create: `api/pipeline_api/db.py`, `api/pipeline_api/migrations/001_init.sql`
- Create: `api/tests/test_db.py`
- Modify: `api/pipeline_api/main.py` (call `migrate` in `create_app`)

**Interfaces:**
- Produces: `session(db_path) -> ContextManager[sqlite3.Connection]` (row_factory `sqlite3.Row`, WAL, foreign keys on, autocommit mode), `transaction(conn, immediate=False) -> ContextManager[None]`, `migrate(db_path) -> list[int]` (versions applied), `now() -> str` (UTC ISO seconds).

- [ ] **Step 1: Write the failing tests**

`api/tests/test_db.py`:
```python
import sqlite3

import pytest

from pipeline_api.db import migrate, now, session, transaction


def _run(conn, run_id="r1"):
    conn.execute("INSERT INTO runs (id, name, provider, vertical, pages, status, created_at, updated_at) "
                 "VALUES (?, 'n', 'serpapi', 'web', 1, 'scraping', ?, ?)", (run_id, now(), now()))


def test_migrate_is_idempotent(tmp_path):
    db = tmp_path / "app.db"
    assert migrate(db) == [1]
    assert migrate(db) == []


def test_pragmas(tmp_path):
    db = tmp_path / "app.db"
    migrate(db)
    with session(db) as conn:
        assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
        assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1


def test_one_active_job_per_run(tmp_path):
    db = tmp_path / "app.db"
    migrate(db)
    with session(db) as conn:
        _run(conn)
        conn.execute("INSERT INTO jobs (kind, run_id, state, created_at) VALUES ('scrape', 'r1', 'running', ?)",
                     (now(),))
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("INSERT INTO jobs (kind, run_id, state, created_at) VALUES ('verify', 'r1', 'queued', ?)",
                         (now(),))
        conn.execute("UPDATE jobs SET state = 'done'")
        conn.execute("INSERT INTO jobs (kind, run_id, state, created_at) VALUES ('verify', 'r1', 'queued', ?)",
                     (now(),))


def test_transaction_rolls_back(tmp_path):
    db = tmp_path / "app.db"
    migrate(db)
    with session(db) as conn:
        with pytest.raises(RuntimeError), transaction(conn):
            _run(conn)
            raise RuntimeError("boom")
        assert conn.execute("SELECT COUNT(*) FROM runs").fetchone()[0] == 0


def test_delete_run_cascades(tmp_path):
    db = tmp_path / "app.db"
    migrate(db)
    with session(db) as conn:
        _run(conn)
        conn.execute("INSERT INTO queries (run_id, position, text, state) VALUES ('r1', 0, 'q', 'pending')")
        conn.execute("DELETE FROM runs WHERE id = 'r1'")
        assert conn.execute("SELECT COUNT(*) FROM queries").fetchone()[0] == 0
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest tests/test_db.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pipeline_api.db'`.

- [ ] **Step 3: Write the migration**

`api/pipeline_api/migrations/001_init.sql`:
```sql
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  vertical TEXT NOT NULL,
  pages INTEGER NOT NULL,
  start_date TEXT,
  end_date TEXT,
  status TEXT NOT NULL,          -- scraping | scraped | verifying | verified | failed
  max_calls INTEGER,             -- billable SERP page ceiling quoted by bulk_search.plan and confirmed
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE queries (
  id INTEGER PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  text TEXT NOT NULL,
  state TEXT NOT NULL,           -- pending | done | failed
  found INTEGER,
  out_of_range INTEGER,
  attempts INTEGER,
  error TEXT,
  UNIQUE (run_id, position)
);
CREATE INDEX queries_run_state ON queries(run_id, state);

CREATE TABLE serp_rows (
  id INTEGER PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  query_id INTEGER NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  row_json TEXT NOT NULL
);
CREATE INDEX serp_rows_run ON serp_rows(run_id, query_id, seq);

CREATE TABLE verify_jobs (
  id INTEGER PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  brand_set TEXT NOT NULL,
  brand_rules_json TEXT NOT NULL, -- immutable deep copy taken at start; the job's only brand source
  status TEXT NOT NULL,           -- queued | running | done | failed | cancelled
  total_urls INTEGER,
  done_urls INTEGER NOT NULL DEFAULT 0,
  status_counts_json TEXT NOT NULL DEFAULT '{}',
  output_path TEXT,
  error TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE verify_rows (
  id INTEGER PRIMARY KEY,
  verify_job_id INTEGER NOT NULL REFERENCES verify_jobs(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  status TEXT,
  is_duplicate INTEGER NOT NULL DEFAULT 0,
  row_json TEXT NOT NULL,
  UNIQUE (verify_job_id, seq)
);
CREATE INDEX verify_rows_job_status ON verify_rows(verify_job_id, status, seq);

CREATE TABLE jobs (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,             -- scrape | verify
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  ref_id INTEGER,                 -- verify_jobs.id for verify
  state TEXT NOT NULL,            -- queued | running | cancelling | done | failed | cancelled
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  resumed_at TEXT                 -- set when a restart re-queued this job
);
CREATE UNIQUE INDEX jobs_one_active_per_run ON jobs(run_id)
  WHERE state IN ('queued', 'running', 'cancelling');
CREATE INDEX jobs_state ON jobs(state, id);
```

- [ ] **Step 4: Implement db.py**

`api/pipeline_api/db.py`:
```python
"""SQLite access. Short-lived connections per unit of work; each thread opens its own."""
from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from importlib import resources
from pathlib import Path


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


@contextmanager
def session(db_path: Path) -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(db_path, timeout=30, isolation_level=None)  # autocommit; transactions are explicit
    try:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=30000")
        yield conn
    finally:
        conn.close()


@contextmanager
def transaction(conn: sqlite3.Connection, immediate: bool = False) -> Iterator[None]:
    conn.execute("BEGIN IMMEDIATE" if immediate else "BEGIN")
    try:
        yield
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    conn.execute("COMMIT")


def migrate(db_path: Path) -> list[int]:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    files = sorted(resources.files("pipeline_api.migrations").iterdir(), key=lambda p: p.name)
    applied: list[int] = []
    with session(db_path) as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT)")
        done = {r[0] for r in conn.execute("SELECT version FROM schema_migrations")}
        for f in files:
            if not f.name.endswith(".sql"):
                continue
            version = int(f.name.split("_", 1)[0])
            if version in done:
                continue
            with transaction(conn, immediate=True):
                for statement in f.read_text().split(";\n"):
                    if statement.strip():
                        conn.execute(statement)
                conn.execute("INSERT INTO schema_migrations VALUES (?, ?)", (version, now()))
            applied.append(version)
    return applied
```
Also create empty `api/pipeline_api/migrations/__init__.py` so `importlib.resources` can find the package.

In `main.py` `create_app`, after `configure_logging(...)`, add:
```python
    migrate(settings.db_path)
```
with `from .db import migrate` in the imports.

- [ ] **Step 5: Run tests**

Run: `uv run pytest -q`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add api
git commit -m "feat: sqlite schema with one-active-job-per-run guard"
```

---

### Task 6: Event bus and job runner

**Files:**
- Create: `api/pipeline_api/events.py`, `api/pipeline_api/jobs.py`
- Create: `api/tests/test_events.py`, `api/tests/test_jobs.py`

**Interfaces:**
- Produces (`events.py`): `EventBus()` with `bind(loop)`, `subscribe(run_id) -> asyncio.Queue[dict]`, `unsubscribe(run_id, queue)`, `publish(run_id, event)` (loop thread only), `publish_threadsafe(run_id, event)` (any thread). A full subscriber queue is cleared and receives `{"type": "resync"}`.
- Produces (`jobs.py`):
  - `class JobOutcome(Enum): DONE, CANCELLED`
  - `@dataclass JobRecord(id, kind, run_id, ref_id, state, error, created_at, started_at, finished_at, resumed_at)` with `JobRecord.from_row(row)` and `to_dict()`
  - `@dataclass JobContext(job: JobRecord, db_path: Path, cancel: threading.Event, publish: Callable[[dict], None])`
  - `@dataclass(frozen=True) JobKind(run: Callable[[JobContext], Awaitable[JobOutcome]], on_failed: Callable[[sqlite3.Connection, JobRecord, str], None], on_cancelled: Callable[[sqlite3.Connection, JobRecord], None])`
  - `class ActiveJobError(Exception)` with `.job_id`, `.kind`
  - `JobRunner(db_path, bus, kinds: dict[str, JobKind])` with `async start()`, `async stop()`, `enqueue(conn, run_id, kind, ref_id=None) -> int` (caller holds an immediate transaction), `wake()`, `cancel(job_id) -> str` (returns new state), `requeue(conn, job_id) -> None` (failed/cancelled -> queued, caller holds transaction; raises `ActiveJobError`), `resume_interrupted() -> list[int]`
  - Module function `active_job(conn, run_id) -> JobRecord | None`, `latest_job(conn, run_id) -> JobRecord | None`
  - Events published: `{"type": "job", "job_id", "kind", "state", "error"}` on every state change.

- [ ] **Step 1: Write the failing tests**

`api/tests/test_events.py`:
```python
import asyncio
import threading

from pipeline_api.events import EventBus


async def test_publish_reaches_subscribers_of_that_run_only():
    bus = EventBus()
    bus.bind(asyncio.get_running_loop())
    a, b = bus.subscribe("r1"), bus.subscribe("r2")
    bus.publish("r1", {"type": "x"})
    assert await asyncio.wait_for(a.get(), 1) == {"type": "x"}
    assert b.empty()
    bus.unsubscribe("r1", a)
    bus.publish("r1", {"type": "y"})
    assert a.empty()


async def test_publish_threadsafe_from_worker_thread():
    bus = EventBus()
    bus.bind(asyncio.get_running_loop())
    q = bus.subscribe("r1")
    threading.Thread(target=bus.publish_threadsafe, args=("r1", {"type": "t"})).start()
    assert await asyncio.wait_for(q.get(), 1) == {"type": "t"}


async def test_full_queue_becomes_resync():
    bus = EventBus(max_queue=3)
    bus.bind(asyncio.get_running_loop())
    q = bus.subscribe("r1")
    for i in range(5):
        bus.publish("r1", {"type": "n", "i": i})
    items = [q.get_nowait() for _ in range(q.qsize())]
    assert {"type": "resync"} in items
```

`api/tests/test_jobs.py`:
```python
import asyncio
import threading

import pytest

from pipeline_api.db import migrate, now, session, transaction
from pipeline_api.events import EventBus
from pipeline_api.jobs import ActiveJobError, JobContext, JobKind, JobOutcome, JobRunner, active_job


def _make_run(db, run_id):
    with session(db) as conn:
        conn.execute("INSERT INTO runs (id, name, provider, vertical, pages, status, created_at, updated_at) "
                     "VALUES (?, 'n', 'serpapi', 'web', 1, 'scraping', ?, ?)", (run_id, now(), now()))


def _enqueue(runner, db, run_id, kind="fake"):
    with session(db) as conn, transaction(conn, immediate=True):
        job_id = runner.enqueue(conn, run_id, kind)
    runner.wake()
    return job_id


async def _wait_state(db, job_id, states, timeout=5.0):
    for _ in range(int(timeout / 0.02)):
        with session(db) as conn:
            state = conn.execute("SELECT state FROM jobs WHERE id = ?", (job_id,)).fetchone()[0]
        if state in states:
            return state
        await asyncio.sleep(0.02)
    raise AssertionError(f"job {job_id} stuck in {state}")


@pytest.fixture
def db(tmp_path):
    path = tmp_path / "app.db"
    migrate(path)
    _make_run(path, "r1")
    _make_run(path, "r2")
    return path


class Recorder:
    def __init__(self):
        self.running = 0
        self.max_running = 0
        self.ran: list[int] = []
        self.failed: list[tuple[int, str]] = []
        self.cancelled: list[int] = []
        self.gate = threading.Event()
        self.gate.set()

    def kind(self, behaviour="ok"):
        async def run(ctx: JobContext) -> JobOutcome:
            self.running += 1
            self.max_running = max(self.max_running, self.running)
            try:
                while not self.gate.is_set():
                    if ctx.cancel.is_set():
                        return JobOutcome.CANCELLED
                    await asyncio.sleep(0.01)
                if behaviour == "boom":
                    raise ValueError("kaput")
                self.ran.append(ctx.job.id)
                return JobOutcome.DONE
            finally:
                self.running -= 1

        return JobKind(run=run, on_failed=lambda conn, job, msg: self.failed.append((job.id, msg)),
                       on_cancelled=lambda conn, job: self.cancelled.append(job.id))


async def test_jobs_run_one_at_a_time(db):
    rec = Recorder()
    rec.gate.clear()
    runner = JobRunner(db, EventBus(), {"fake": rec.kind()})
    await runner.start()
    try:
        j1 = _enqueue(runner, db, "r1")
        j2 = _enqueue(runner, db, "r2")
        await asyncio.sleep(0.1)
        assert rec.max_running == 1
        rec.gate.set()
        await _wait_state(db, j2, {"done"})
        assert rec.ran == [j1, j2]
    finally:
        await runner.stop()


async def test_duplicate_enqueue_rejected(db):
    runner = JobRunner(db, EventBus(), {"fake": Recorder().kind()})
    _enqueue(runner, db, "r1")
    with pytest.raises(ActiveJobError) as err:
        _enqueue(runner, db, "r1")
    assert err.value.kind == "fake"


async def test_concurrent_enqueue_creates_exactly_one(db):
    runner = JobRunner(db, EventBus(), {"fake": Recorder().kind()})
    results: list[str] = []

    def attempt():
        try:
            _enqueue(runner, db, "r1")
            results.append("ok")
        except ActiveJobError:
            results.append("rejected")

    threads = [threading.Thread(target=attempt) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert results.count("ok") == 1
    with session(db) as conn:
        assert conn.execute("SELECT COUNT(*) FROM jobs").fetchone()[0] == 1


async def test_failure_marks_failed_and_calls_hook(db):
    rec = Recorder()
    runner = JobRunner(db, EventBus(), {"fake": rec.kind("boom")})
    await runner.start()
    try:
        job_id = _enqueue(runner, db, "r1")
        await _wait_state(db, job_id, {"failed"})
        assert rec.failed == [(job_id, "ValueError: kaput")]
        with session(db) as conn:
            assert active_job(conn, "r1") is None
    finally:
        await runner.stop()


async def test_cancel_running_is_cooperative(db):
    rec = Recorder()
    rec.gate.clear()
    runner = JobRunner(db, EventBus(), {"fake": rec.kind()})
    await runner.start()
    try:
        job_id = _enqueue(runner, db, "r1")
        await _wait_state(db, job_id, {"running"})
        assert runner.cancel(job_id) == "cancelling"
        await _wait_state(db, job_id, {"cancelled"})
        assert rec.cancelled == [job_id]
    finally:
        await runner.stop()


async def test_cancel_queued_never_runs(db):
    rec = Recorder()
    runner = JobRunner(db, EventBus(), {"fake": rec.kind()})
    job_id = _enqueue(runner, db, "r1")
    assert runner.cancel(job_id) == "cancelled"
    await runner.start()
    try:
        await asyncio.sleep(0.1)
        assert rec.ran == [] and rec.cancelled == [job_id]
    finally:
        await runner.stop()


async def test_resume_interrupted_requeues_running_and_finishes_cancelling(db):
    rec = Recorder()
    with session(db) as conn:
        conn.execute("INSERT INTO jobs (kind, run_id, state, created_at) VALUES ('fake', 'r1', 'running', ?)", (now(),))
        conn.execute("INSERT INTO jobs (kind, run_id, state, created_at) VALUES ('fake', 'r2', 'cancelling', ?)",
                     (now(),))
    runner = JobRunner(db, EventBus(), {"fake": rec.kind()})
    await runner.start()
    try:
        await _wait_state(db, 1, {"done"})
        await _wait_state(db, 2, {"cancelled"})
        with session(db) as conn:
            assert conn.execute("SELECT resumed_at FROM jobs WHERE id = 1").fetchone()[0] is not None
        assert rec.cancelled == [2]
    finally:
        await runner.stop()


async def test_requeue_failed_job(db):
    rec = Recorder()
    runner = JobRunner(db, EventBus(), {"fake": rec.kind("boom")})
    await runner.start()
    try:
        job_id = _enqueue(runner, db, "r1")
        await _wait_state(db, job_id, {"failed"})
        runner.kinds["fake"] = rec.kind()
        with session(db) as conn, transaction(conn, immediate=True):
            runner.requeue(conn, job_id)
        runner.wake()
        await _wait_state(db, job_id, {"done"})
    finally:
        await runner.stop()
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest tests/test_events.py tests/test_jobs.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Implement events.py**

```python
"""Per-run fan-out of progress events to SSE subscribers."""
from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import Any


class EventBus:
    def __init__(self, max_queue: int = 1000):
        self._subs: dict[str, set[asyncio.Queue[dict[str, Any]]]] = defaultdict(set)
        self._loop: asyncio.AbstractEventLoop | None = None
        self._max_queue = max_queue

    def bind(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def subscribe(self, run_id: str) -> asyncio.Queue[dict[str, Any]]:
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=self._max_queue)
        self._subs[run_id].add(q)
        return q

    def unsubscribe(self, run_id: str, q: asyncio.Queue[dict[str, Any]]) -> None:
        self._subs[run_id].discard(q)
        if not self._subs[run_id]:
            del self._subs[run_id]

    def publish(self, run_id: str, event: dict[str, Any]) -> None:
        for q in list(self._subs.get(run_id, ())):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                # A subscriber that fell behind refetches the whole state instead of replaying a backlog.
                while not q.empty():
                    q.get_nowait()
                q.put_nowait({"type": "resync"})

    def publish_threadsafe(self, run_id: str, event: dict[str, Any]) -> None:
        if self._loop is None or self._loop.is_closed():
            return
        self._loop.call_soon_threadsafe(self.publish, run_id, event)
```

- [ ] **Step 4: Implement jobs.py**

```python
"""One-at-a-time background job runner over the `jobs` table.

Jobs run as asyncio tasks inside the API process, one at a time, in id order. Every job kind is resumable from
stored state, so a restart re-queues whatever was running. Cancel is cooperative: it sets an event the job checks.
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import sqlite3
import threading
from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass
from enum import Enum
from pathlib import Path
from typing import Any

from .db import now, session, transaction
from .events import EventBus

log = logging.getLogger("pipeline_api.jobs")
ACTIVE_STATES = ("queued", "running", "cancelling")


class JobOutcome(Enum):
    DONE = "done"
    CANCELLED = "cancelled"


@dataclass
class JobRecord:
    id: int
    kind: str
    run_id: str
    ref_id: int | None
    state: str
    error: str | None
    created_at: str
    started_at: str | None
    finished_at: str | None
    resumed_at: str | None

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> JobRecord:
        return cls(**{k: row[k] for k in row.keys()})

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class JobContext:
    job: JobRecord
    db_path: Path
    cancel: threading.Event
    publish: Callable[[dict[str, Any]], None]  # thread-safe


@dataclass(frozen=True)
class JobKind:
    run: Callable[[JobContext], Awaitable[JobOutcome]]
    on_failed: Callable[[sqlite3.Connection, JobRecord, str], None]
    on_cancelled: Callable[[sqlite3.Connection, JobRecord], None]


class ActiveJobError(Exception):
    def __init__(self, job_id: int, kind: str):
        super().__init__(f"a {kind} job (#{job_id}) is already queued or running for this run")
        self.job_id = job_id
        self.kind = kind


def active_job(conn: sqlite3.Connection, run_id: str) -> JobRecord | None:
    row = conn.execute(f"SELECT * FROM jobs WHERE run_id = ? AND state IN {ACTIVE_STATES}", (run_id,)).fetchone()
    return JobRecord.from_row(row) if row else None


def latest_job(conn: sqlite3.Connection, run_id: str) -> JobRecord | None:
    row = conn.execute("SELECT * FROM jobs WHERE run_id = ? ORDER BY id DESC LIMIT 1", (run_id,)).fetchone()
    return JobRecord.from_row(row) if row else None


def _get(conn: sqlite3.Connection, job_id: int) -> JobRecord:
    return JobRecord.from_row(conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone())


class JobRunner:
    def __init__(self, db_path: Path, bus: EventBus, kinds: dict[str, JobKind]):
        self.db_path = db_path
        self.bus = bus
        self.kinds = kinds
        self._wake = asyncio.Event()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._task: asyncio.Task[None] | None = None
        self._cancel_events: dict[int, threading.Event] = {}

    async def start(self) -> None:
        self._loop = asyncio.get_running_loop()
        self.bus.bind(self._loop)
        self.resume_interrupted()
        self._task = asyncio.create_task(self._loop_forever())

    async def stop(self) -> None:
        for ev in self._cancel_events.values():
            ev.set()
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task

    def wake(self) -> None:
        if self._loop is not None and not self._loop.is_closed():
            self._loop.call_soon_threadsafe(self._wake.set)

    def enqueue(self, conn: sqlite3.Connection, run_id: str, kind: str, ref_id: int | None = None) -> int:
        """Insert a queued job. The caller holds `transaction(conn, immediate=True)` and calls wake() after commit."""
        existing = active_job(conn, run_id)
        if existing:
            raise ActiveJobError(existing.id, existing.kind)
        try:
            cur = conn.execute("INSERT INTO jobs (kind, run_id, ref_id, state, created_at) VALUES (?, ?, ?, 'queued', ?)",
                               (kind, run_id, ref_id, now()))
        except sqlite3.IntegrityError:
            existing = active_job(conn, run_id)
            if existing:
                raise ActiveJobError(existing.id, existing.kind) from None
            raise
        assert cur.lastrowid is not None
        return cur.lastrowid

    def requeue(self, conn: sqlite3.Connection, job_id: int) -> None:
        job = _get(conn, job_id)
        existing = active_job(conn, job.run_id)
        if existing:
            raise ActiveJobError(existing.id, existing.kind)
        conn.execute("UPDATE jobs SET state = 'queued', error = NULL, started_at = NULL, finished_at = NULL "
                     "WHERE id = ?", (job_id,))

    def cancel(self, job_id: int) -> str:
        with session(self.db_path) as conn, transaction(conn, immediate=True):
            job = _get(conn, job_id)
            if job.state == "queued":
                conn.execute("UPDATE jobs SET state = 'cancelled', finished_at = ? WHERE id = ?", (now(), job_id))
                self.kinds[job.kind].on_cancelled(conn, job)
                new_state = "cancelled"
            elif job.state == "running":
                conn.execute("UPDATE jobs SET state = 'cancelling' WHERE id = ?", (job_id,))
                new_state = "cancelling"
            else:
                return job.state
        if job_id in self._cancel_events:
            self._cancel_events[job_id].set()
        self.bus.publish_threadsafe(job.run_id, {"type": "job", "job_id": job_id, "kind": job.kind,
                                                 "state": new_state, "error": None})
        return new_state

    def resume_interrupted(self) -> list[int]:
        resumed: list[int] = []
        with session(self.db_path) as conn, transaction(conn, immediate=True):
            for row in conn.execute("SELECT * FROM jobs WHERE state = 'cancelling'").fetchall():
                job = JobRecord.from_row(row)
                conn.execute("UPDATE jobs SET state = 'cancelled', finished_at = ? WHERE id = ?", (now(), job.id))
                self.kinds[job.kind].on_cancelled(conn, job)
            for row in conn.execute("SELECT id FROM jobs WHERE state = 'running'").fetchall():
                conn.execute("UPDATE jobs SET state = 'queued', resumed_at = ? WHERE id = ?", (now(), row["id"]))
                resumed.append(row["id"])
        if resumed:
            log.info("re-queued jobs interrupted by a restart: %s", resumed)
        return resumed

    def _claim_next(self) -> JobRecord | None:
        with session(self.db_path) as conn, transaction(conn, immediate=True):
            row = conn.execute("SELECT * FROM jobs WHERE state = 'queued' ORDER BY id LIMIT 1").fetchone()
            if row is None:
                return None
            conn.execute("UPDATE jobs SET state = 'running', started_at = ? WHERE id = ?", (now(), row["id"]))
            return _get(conn, row["id"])

    async def _loop_forever(self) -> None:
        while True:
            job = self._claim_next()
            if job is None:
                self._wake.clear()
                job = self._claim_next()  # an enqueue may have landed between the claim and the clear
                if job is None:
                    await self._wake.wait()
                    continue
            await self._execute(job)

    async def _execute(self, job: JobRecord) -> None:
        cancel = threading.Event()
        self._cancel_events[job.id] = cancel
        extra = {"run_id": job.run_id, "job_id": job.id}
        ctx = JobContext(job=job, db_path=self.db_path, cancel=cancel,
                         publish=lambda ev: self.bus.publish_threadsafe(job.run_id, ev))
        self.bus.publish(job.run_id, {"type": "job", "job_id": job.id, "kind": job.kind, "state": "running",
                                      "error": None})
        log.info("job started: %s", job.kind, extra=extra)
        outcome: JobOutcome | None = None
        error: str | None = None
        try:
            outcome = await self.kinds[job.kind].run(ctx)
        except asyncio.CancelledError:
            # Runner shutdown: leave the job 'running' so the next start re-queues it.
            self._cancel_events.pop(job.id, None)
            raise
        except Exception as e:
            log.exception("job failed: %s", job.kind, extra=extra)
            error = f"{type(e).__name__}: {e}"
        finally:
            self._cancel_events.pop(job.id, None)
        with session(self.db_path) as conn, transaction(conn, immediate=True):
            current = _get(conn, job.id)
            if error is not None:
                conn.execute("UPDATE jobs SET state = 'failed', error = ?, finished_at = ? WHERE id = ?",
                             (error, now(), job.id))
                self.kinds[job.kind].on_failed(conn, current, error)
                state = "failed"
            elif outcome is JobOutcome.CANCELLED:
                conn.execute("UPDATE jobs SET state = 'cancelled', finished_at = ? WHERE id = ?", (now(), job.id))
                self.kinds[job.kind].on_cancelled(conn, current)
                state = "cancelled"
            else:
                conn.execute("UPDATE jobs SET state = 'done', finished_at = ? WHERE id = ?", (now(), job.id))
                state = "done"
        log.info("job %s: %s", state, job.kind, extra=extra)
        self.bus.publish(job.run_id, {"type": "job", "job_id": job.id, "kind": job.kind, "state": state,
                                      "error": error})
```

- [ ] **Step 5: Run tests**

Run: `uv run pytest tests/test_events.py tests/test_jobs.py -v && uv run pytest -q`
Expected: all PASS, no warnings.

- [ ] **Step 6: Commit**

```bash
git add api
git commit -m "feat: event bus and one-at-a-time job runner with resume and cooperative cancel"
```

---

### Task 7: Runs, scrape job, SERP export and run endpoints

**Files:**
- Create: `api/pipeline_api/runs.py`, `api/pipeline_api/export.py`, `api/pipeline_api/scrape.py`, `api/pipeline_api/routes/runs.py`
- Modify: `api/pipeline_api/main.py`
- Modify: `api/tests/conftest.py` (add `FakeSearch`, `make_client`, `wait_until`)
- Create: `api/tests/test_runs_api.py`, `api/tests/test_scrape.py`, `api/tests/test_export.py`

**Interfaces:**
- Consumes: `Deps`, `JobRunner`, `JobKind`, `JobOutcome`, `JobContext`, `ActiveJobError`, `session`, `transaction`, `now`, `ApiError`.
- Produces (`runs.py`):
  - `@dataclass SearchRequest(queries: list[str], provider: str, vertical: str, pages: int, start: str, end: str)`
  - `validate_search(bs, *, queries: str, provider: str, vertical: str, pages: int | str | None, start: str, end: str) -> SearchRequest` (raises `ApiError(422, ...)`)
  - `create_run(conn, req: SearchRequest, max_calls: int) -> str`
  - `get_run(conn, run_id) -> sqlite3.Row` (raises `ApiError(404)`)
  - `pending_queries(conn, run_id) -> list[sqlite3.Row]`, `query_counts(conn, run_id) -> dict`
  - `store_query_result(conn, run_id, query_id, rows, error, attempts, out_of_range) -> dict` (the `query` event payload)
  - `set_run_status(conn, run_id, status, error=None) -> None`
  - `run_detail(conn, run_id) -> dict`, `list_runs(conn) -> list[dict]`
  - `serp_rows(conn, run_id) -> list[dict]`, `serp_rows_page(conn, bs, run_id, offset, limit, q) -> dict`
- Produces (`export.py`): `write_rows_xlsx(path, header: list[str], rows: list[list], sheet: str) -> None`, `write_serp_xlsx(path, bs, rows: list[dict]) -> None`, `slug(text) -> str`, `serp_filename(run) -> str`, `verified_filename(run, verify_job_id) -> str`
- Produces (`scrape.py`): `scrape_kind(deps: Deps) -> JobKind`
- Produces (routes): `POST /api/plan`, `POST /api/runs`, `GET /api/runs`, `GET /api/runs/{id}`, `GET /api/runs/{id}/rows?offset&limit&q`, `GET /api/runs/{id}/serp.xlsx`, `POST /api/runs/{id}/retry-failed`, `DELETE /api/runs/{id}`, `POST /api/jobs/{id}/cancel`
- `run_detail` shape: run columns plus `counts: {queries, done, failed, pending, serp_rows}`, `queries: [...]`, `verify_jobs: []` (filled in Task 9), `active_job: JobRecord dict | None`, `last_job: JobRecord dict | None`. It never includes SERP rows.
- Query event: `{"type": "query", "query_id", "position", "state", "found", "out_of_range", "attempts", "error", "done", "failed", "total", "rows"}`.

- [ ] **Step 1: Add shared test helpers**

Append to `api/tests/conftest.py`:
```python
import time as _time
from collections.abc import Callable
from typing import Any

from fastapi.testclient import TestClient


class FakeSearch:
    """Stands in for bulk_search.search_one. `results[query]` is a list of links; a query starting with 'fail:'
    fails; `gate` (when cleared) blocks every call until set, to hold a scrape mid-run."""

    def __init__(self, results: dict[str, list[str]] | None = None):
        self.results = results or {}
        self.calls: list[str] = []
        self.gate = threading.Event()
        self.gate.set()
        self.block_after: int | None = None  # calls beyond this many block on `gate`

    def __call__(self, query, start, end, pages, vertical, provider, stop):
        self.calls.append(query)
        if self.block_after is not None and len(self.calls) > self.block_after:
            self.gate.wait(10)
        if query.startswith("fail:"):
            return [], "page 1 request failed (SerpAPI call returned no data) (after 3 attempts)", 3
        links = self.results.get(query, [f"https://example.com/{query.replace(' ', '-')}"])
        rows = [{"query": query, "vertical": vertical, "provider": provider, "page": 1, "rank": i + 1,
                 "title": f"Title {i}", "link": link, "domain": "example.com", "date": "", "published": "",
                 "out_of_range": None, "range_start": start, "range_end": end, "snippet": "snippet",
                 "outlet": "Example", "fetched_at": "2026-09-26T00:00:00+00:00"} for i, link in enumerate(links)]
        return rows, "", 1


def make_client(settings, **kwargs) -> TestClient:
    from pipeline_api.main import create_app

    return TestClient(create_app(settings, **kwargs))


def wait_until(check: Callable[[], Any], timeout: float = 10.0) -> Any:
    deadline = _time.monotonic() + timeout
    while _time.monotonic() < deadline:
        value = check()
        if value:
            return value
        _time.sleep(0.02)
    raise AssertionError("condition not met in time")


SEARCH_BODY = {"queries": "alpha\nbeta", "provider": "serpapi", "vertical": "web", "pages": 1,
               "start": "2026-03-01", "end": "2026-08-31"}
```

- [ ] **Step 2: Write the failing tests**

`api/tests/test_runs_api.py`:
```python
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


@pytest.mark.parametrize("patch,message", [
    ({"queries": "  \n "}, "at least one query"),
    ({"start": "", "end": "2026-08-31"}, "together"),
    ({"start": "2026-02-30"}, "start"),
    ({"start": "2026-09-01", "end": "2026-08-31"}, "before"),
    ({"vertical": "images"}, "vertical"),
    ({"provider": "bing"}, "provider"),
])
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
        assert list(page["rows"][0]) == ["Query", "Vertical", "Provider", "Page", "Rank", "Date", "Published",
                                         "Outside Range", "Domain", "Outlet", "Title", "Snippet", "Link",
                                         "Fetched At"]
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
        detail = wait_until(lambda: (d := c.get(f"/api/runs/{run_id}").json())["last_job"]["state"] == "cancelled"
                            and d)
        assert detail["status"] == "scraped"
        assert detail["counts"]["pending"] > 0
        assert detail["counts"]["done"] + detail["counts"]["pending"] == 30


def test_delete_run_removes_rows_and_files(settings, keys):
    with make_client(settings, search_one=FakeSearch()) as c:
        run_id = c.post("/api/runs", json={**SEARCH_BODY, "confirmed_calls": 2}).json()["id"]
        wait_until(lambda: c.get(f"/api/runs/{run_id}").json()["status"] == "scraped")
        assert c.get(f"/api/runs/{run_id}/serp.xlsx").status_code == 200
        assert (settings.exports_dir / run_id).exists()
        assert c.delete(f"/api/runs/{run_id}").status_code == 200
        assert c.get(f"/api/runs/{run_id}").status_code == 404
        assert not (settings.exports_dir / run_id).exists()
```

`api/tests/test_export.py`:
```python
from openpyxl import load_workbook

from conftest import SEARCH_BODY, FakeSearch, make_client, wait_until
from pipeline_api.export import slug, write_rows_xlsx


def test_formula_like_text_stays_text_and_control_chars_are_stripped(tmp_path):
    path = tmp_path / "x.xlsx"
    write_rows_xlsx(path, ["Title", "Snippet"], [["=HYPERLINK(\"http://evil\")", "bad\x0bchars\x1fhere"]], "Sheet")
    ws = load_workbook(path)["Sheet"]
    assert ws["A2"].value == '=HYPERLINK("http://evil")' and ws["A2"].data_type == "s"
    assert ws["B2"].value == "badcharshere"


def test_serp_export_columns_and_filename(settings, monkeypatch):
    monkeypatch.setenv("SERPAPI_KEY", "k")
    with make_client(settings, search_one=FakeSearch()) as c:
        run_id = c.post("/api/runs", json={**SEARCH_BODY, "confirmed_calls": 2}).json()["id"]
        wait_until(lambda: c.get(f"/api/runs/{run_id}").json()["status"] == "scraped")
        r = c.get(f"/api/runs/{run_id}/serp.xlsx")
        bs = c.app.state.deps.bs
    assert r.status_code == 200
    assert 'filename="alpha_2026-03-01_2026-08-31_serp.xlsx"' in r.headers["content-disposition"]
    path = settings.exports_dir / run_id / "alpha_2026-03-01_2026-08-31_serp.xlsx"
    ws = load_workbook(path).active
    assert [c.value for c in ws[1]] == bs.EXPORT_COLUMNS
    assert ws.max_row == 3


def test_slug():
    assert slug('"Safari" luggage OR bags / 2026') == "Safari-luggage-OR-bags-2026"
    assert slug("   ") == "run"
```

`api/tests/test_scrape.py`:
```python
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
        rows = conn.execute("SELECT q.state, COUNT(s.id) n, q.found FROM queries q LEFT JOIN serp_rows s "
                            "ON s.query_id = q.id GROUP BY q.id").fetchall()
    assert all(r["state"] == "done" and r["n"] == r["found"] for r in rows)
```

- [ ] **Step 3: Run to verify failure**

Run: `uv run pytest tests/test_runs_api.py tests/test_export.py tests/test_scrape.py -v`
Expected: FAIL (404 on `/api/plan`, missing modules).

- [ ] **Step 4: Implement export.py**

```python
"""xlsx writers shared by the SERP export and the verifier input."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from openpyxl import Workbook
from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE


def _clean(value: Any) -> Any:
    if isinstance(value, str):
        return ILLEGAL_CHARACTERS_RE.sub("", value)
    return value


def write_rows_xlsx(path: Path, header: list[str], rows: list[list[Any]], sheet: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    wb = Workbook()
    ws = wb.active
    assert ws is not None
    ws.title = sheet
    ws.append(header)
    for r, row in enumerate(rows, start=2):
        for col, value in enumerate(row, start=1):
            value = _clean(value)
            cell = ws.cell(row=r, column=col, value=value)
            if isinstance(value, str) and value.startswith("="):
                cell.data_type = "s"  # text that looks like a formula is data, never a formula
    tmp = path.with_suffix(".tmp.xlsx")
    wb.save(tmp)
    tmp.replace(path)


def write_serp_xlsx(path: Path, bs: Any, rows: list[dict[str, Any]]) -> None:
    write_rows_xlsx(path, list(bs.EXPORT_COLUMNS), bs.export_rows(rows), "Bulk Search")


def slug(text: str) -> str:
    s = re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-")[:60].strip("-")
    return s or "run"


def _period(run: Any) -> str:
    return f"_{run['start_date']}_{run['end_date']}" if run["start_date"] else ""


def serp_filename(run: Any) -> str:
    return f"{slug(run['name'])}{_period(run)}_serp.xlsx"


def verified_filename(run: Any, verify_job_id: int) -> str:
    return f"{slug(run['name'])}{_period(run)}_verified_{verify_job_id}.xlsx"
```

- [ ] **Step 5: Implement runs.py**

```python
"""Run, query and SERP row data access, request validation and run status transitions."""
from __future__ import annotations

import json
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import date
from typing import Any

from .db import now, transaction
from .errors import ApiError
from .jobs import active_job, latest_job
from .monitor_bridge import key_errors
from .routes.health import VERTICALS


@dataclass
class SearchRequest:
    queries: list[str]
    provider: str
    vertical: str
    pages: int
    start: str
    end: str


def _iso(label: str, value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise ApiError(422, f"{label} date {value!r} is not a valid YYYY-MM-DD date") from None


def validate_search(bs: Any, *, queries: str, provider: str, vertical: str, pages: int | str | None, start: str,
                    end: str) -> SearchRequest:
    parsed = bs.parse_queries(queries or "")
    if not parsed:
        raise ApiError(422, "Enter at least one query (one per line).")
    start, end = (start or "").strip(), (end or "").strip()
    if bool(start) != bool(end):
        raise ApiError(422, "Start and end dates must be given together, or both left empty.")
    if start:
        if _iso("start", start) > _iso("end", end):
            raise ApiError(422, f"Start date {start} is after end date {end}; the start must be on or before the end.")
    if vertical not in VERTICALS:
        raise ApiError(422, f"Unknown vertical {vertical!r}. Expected one of {', '.join(VERTICALS)}.")
    if provider not in bs.PROVIDERS:
        raise ApiError(422, f"Unknown provider {provider!r}. Expected one of {', '.join(bs.PROVIDERS)}.")
    return SearchRequest(parsed, provider, vertical, bs.pages_for(vertical, pages, provider), start, end)


def check_key(bs: Any, provider: str) -> None:
    try:
        bs.check_credentials(provider)
    except key_errors(bs) as e:
        raise ApiError(400, f"{e} (Company Monitor's .env is read at API startup.)") from None


def create_run(conn: sqlite3.Connection, req: SearchRequest, max_calls: int) -> str:
    run_id = uuid.uuid4().hex[:12]
    ts = now()
    conn.execute("INSERT INTO runs (id, name, provider, vertical, pages, start_date, end_date, status, max_calls, "
                 "created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'scraping', ?, ?, ?)",
                 (run_id, req.queries[0][:80], req.provider, req.vertical, req.pages, req.start or None,
                  req.end or None, max_calls, ts, ts))
    conn.executemany("INSERT INTO queries (run_id, position, text, state) VALUES (?, ?, ?, 'pending')",
                     [(run_id, i, q) for i, q in enumerate(req.queries)])
    return run_id


def get_run(conn: sqlite3.Connection, run_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
    if row is None:
        raise ApiError(404, f"No run {run_id!r}. It may have been deleted.")
    return row


def set_run_status(conn: sqlite3.Connection, run_id: str, status: str, error: str | None = None) -> None:
    conn.execute("UPDATE runs SET status = ?, error = ?, updated_at = ? WHERE id = ?", (status, error, now(), run_id))


def pending_queries(conn: sqlite3.Connection, run_id: str) -> list[sqlite3.Row]:
    return conn.execute("SELECT * FROM queries WHERE run_id = ? AND state = 'pending' ORDER BY position",
                        (run_id,)).fetchall()


def query_counts(conn: sqlite3.Connection, run_id: str) -> dict[str, int]:
    counts = {"queries": 0, "done": 0, "failed": 0, "pending": 0}
    for row in conn.execute("SELECT state, COUNT(*) n FROM queries WHERE run_id = ? GROUP BY state", (run_id,)):
        counts[row["state"]] = row["n"]
        counts["queries"] += row["n"]
    counts["serp_rows"] = conn.execute("SELECT COUNT(*) FROM serp_rows WHERE run_id = ?", (run_id,)).fetchone()[0]
    return counts


def store_query_result(conn: sqlite3.Connection, run_id: str, query_id: int, rows: list[dict[str, Any]],
                       error: str | None, attempts: int, out_of_range: int) -> dict[str, Any]:
    """Rows and the query's new state in ONE transaction: a query is fully stored or still pending."""
    state = "failed" if error else "done"
    with transaction(conn, immediate=True):
        conn.execute("DELETE FROM serp_rows WHERE query_id = ?", (query_id,))  # a retry replaces earlier rows
        conn.executemany("INSERT INTO serp_rows (run_id, query_id, seq, row_json) VALUES (?, ?, ?, ?)",
                         [(run_id, query_id, i, json.dumps(r)) for i, r in enumerate(rows)])
        conn.execute("UPDATE queries SET state = ?, found = ?, out_of_range = ?, attempts = ?, error = ? WHERE id = ?",
                     (state, len(rows), out_of_range, attempts, error, query_id))
        conn.execute("UPDATE runs SET updated_at = ? WHERE id = ?", (now(), run_id))
    q = conn.execute("SELECT position FROM queries WHERE id = ?", (query_id,)).fetchone()
    counts = query_counts(conn, run_id)
    return {"type": "query", "query_id": query_id, "position": q["position"], "state": state, "found": len(rows),
            "out_of_range": out_of_range, "attempts": attempts, "error": error, "done": counts["done"],
            "failed": counts["failed"], "total": counts["queries"], "rows": counts["serp_rows"]}


def serp_rows(conn: sqlite3.Connection, run_id: str) -> list[dict[str, Any]]:
    cur = conn.execute("SELECT s.row_json FROM serp_rows s JOIN queries q ON q.id = s.query_id WHERE s.run_id = ? "
                       "ORDER BY q.position, s.seq", (run_id,))
    return [json.loads(r[0]) for r in cur]


def serp_rows_page(conn: sqlite3.Connection, bs: Any, run_id: str, offset: int, limit: int, q: str) -> dict[str, Any]:
    where, args = "s.run_id = ?", [run_id]
    if q:
        where += " AND s.row_json LIKE ?"
        args.append(f"%{q}%")
    total = conn.execute(f"SELECT COUNT(*) FROM serp_rows s WHERE {where}", args).fetchone()[0]
    cur = conn.execute(f"SELECT s.row_json FROM serp_rows s JOIN queries qq ON qq.id = s.query_id WHERE {where} "
                       "ORDER BY qq.position, s.seq LIMIT ? OFFSET ?", [*args, limit, offset])
    raw = [json.loads(r[0]) for r in cur]
    cols = list(bs.EXPORT_COLUMNS)
    return {"total": total, "offset": offset, "limit": limit,
            "rows": [dict(zip(cols, values, strict=True)) for values in bs.export_rows(raw)]}


def verify_jobs_for(conn: sqlite3.Connection, run_id: str) -> list[dict[str, Any]]:
    """Filled in by Task 9; returns [] until verify_jobs rows exist."""
    out = []
    for r in conn.execute("SELECT * FROM verify_jobs WHERE run_id = ? ORDER BY id DESC", (run_id,)):
        out.append({"id": r["id"], "brand_set": r["brand_set"], "brand_rules": json.loads(r["brand_rules_json"]),
                    "status": r["status"], "total_urls": r["total_urls"], "done_urls": r["done_urls"],
                    "status_counts": json.loads(r["status_counts_json"]), "error": r["error"],
                    "started_at": r["started_at"], "finished_at": r["finished_at"],
                    "has_output": bool(r["output_path"]) and r["status"] == "done"})
    return out


def run_detail(conn: sqlite3.Connection, run_id: str) -> dict[str, Any]:
    run = dict(get_run(conn, run_id))
    queries = [dict(q) for q in conn.execute(
        "SELECT id, position, text, state, found, out_of_range, attempts, error FROM queries WHERE run_id = ? "
        "ORDER BY position", (run_id,))]
    active, last = active_job(conn, run_id), latest_job(conn, run_id)
    return {**run, "counts": query_counts(conn, run_id), "queries": queries, "verify_jobs": verify_jobs_for(conn, run_id),
            "active_job": active.to_dict() if active else None, "last_job": last.to_dict() if last else None}


def list_runs(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = conn.execute("""
        SELECT r.id, r.name, r.provider, r.vertical, r.start_date, r.end_date, r.status, r.updated_at,
               (SELECT COUNT(*) FROM serp_rows s WHERE s.run_id = r.id) AS serp_rows,
               (SELECT v.status_counts_json FROM verify_jobs v WHERE v.run_id = r.id AND v.status = 'done'
                ORDER BY v.id DESC LIMIT 1) AS last_counts
        FROM runs r ORDER BY r.updated_at DESC""").fetchall()
    out = []
    for r in rows:
        d = dict(r)
        counts = json.loads(d.pop("last_counts")) if d["last_counts"] else None
        d["verified"] = counts.get("Verified", 0) if counts is not None else None
        out.append(d)
    return out
```

- [ ] **Step 6: Implement scrape.py**

```python
"""Scrape job: run a run's pending queries through search_one on a thread pool, storing each as it finishes."""
from __future__ import annotations

import asyncio
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from . import runs
from .db import session
from .deps import Deps
from .jobs import JobContext, JobKind, JobOutcome, JobRecord


async def run_scrape(ctx: JobContext, deps: Deps) -> JobOutcome:
    run_id = ctx.job.run_id
    with session(ctx.db_path) as conn:
        run = runs.get_run(conn, run_id)
        pending = runs.pending_queries(conn, run_id)
    if pending:
        loop = asyncio.get_running_loop()
        pool = ThreadPoolExecutor(max_workers=max(1, min(int(deps.bs.MAX_WORKERS), len(pending))),
                                  thread_name_prefix=f"scrape-{run_id}")

        def work(q: sqlite3.Row) -> tuple[list[dict[str, Any]], str, int] | None:
            if ctx.cancel.is_set():
                return None  # never started: stays pending
            return deps.search_one(q["text"], run["start_date"] or "", run["end_date"] or "", run["pages"],
                                   run["vertical"], run["provider"], ctx.cancel)

        futures = {loop.run_in_executor(pool, work, q): q for q in pending}
        try:
            remaining: set[asyncio.Future[Any]] = set(futures)
            while remaining:
                done, remaining = await asyncio.wait(remaining, return_when=asyncio.FIRST_COMPLETED)
                for fut in done:
                    result = fut.result()
                    if result is None:
                        continue
                    rows, error, attempts = result
                    with session(ctx.db_path) as conn:
                        event = runs.store_query_result(conn, run_id, futures[fut]["id"], rows, error or None,
                                                        attempts, deps.bs.count_out_of_range(rows))
                    ctx.publish(event)
        finally:
            # In-flight calls finish in their threads; nothing new starts. On runner shutdown their results are
            # dropped and those queries stay pending, to be re-run (from cache where possible) on restart.
            pool.shutdown(wait=False, cancel_futures=True)
    if ctx.cancel.is_set():
        return JobOutcome.CANCELLED
    with session(ctx.db_path) as conn:
        runs.set_run_status(conn, run_id, "scraped")
    return JobOutcome.DONE


def scrape_kind(deps: Deps) -> JobKind:
    async def run(ctx: JobContext) -> JobOutcome:
        return await run_scrape(ctx, deps)

    def on_failed(conn: sqlite3.Connection, job: JobRecord, message: str) -> None:
        runs.set_run_status(conn, job.run_id, "failed", f"Search failed: {message}. Use Retry to continue.")

    def on_cancelled(conn: sqlite3.Connection, job: JobRecord) -> None:
        runs.set_run_status(conn, job.run_id, "scraped")

    return JobKind(run=run, on_failed=on_failed, on_cancelled=on_cancelled)
```

- [ ] **Step 7: Implement routes/runs.py**

```python
from __future__ import annotations

import shutil
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .. import runs
from ..db import session, transaction
from ..errors import ApiError
from ..export import serp_filename, write_serp_xlsx
from ..jobs import ActiveJobError, active_job

router = APIRouter()


class SearchBody(BaseModel):
    queries: str = ""
    provider: str = "serpapi"
    vertical: str = "web"
    pages: int | str | None = 1
    start: str = ""
    end: str = ""
    confirmed_calls: int | None = None


def _deps(request: Request) -> Any:
    return request.app.state.deps


def _conflict(e: ActiveJobError) -> ApiError:
    return ApiError(409, f"{e} Wait for it to finish or cancel it first.",
                    active_job={"id": e.job_id, "kind": e.kind})


def _validate(request: Request, body: SearchBody) -> runs.SearchRequest:
    return runs.validate_search(_deps(request).bs, queries=body.queries, provider=body.provider,
                                vertical=body.vertical, pages=body.pages, start=body.start, end=body.end)


@router.post("/api/plan")
def plan(request: Request, body: SearchBody) -> dict:
    bs = _deps(request).bs
    req = _validate(request, body)
    runs.check_key(bs, req.provider)
    p = bs.plan(req.queries, req.start, req.end, req.pages, req.vertical, req.provider)
    return {"queries": req.queries, "count": p["queries"], "pages": p["pages"], "max_calls": p["max_calls"],
            "cached_calls": p["cached_calls"]}


@router.post("/api/runs")
def create_run(request: Request, body: SearchBody) -> dict:
    deps = _deps(request)
    req = _validate(request, body)
    ceiling = deps.bs.max_calls(req.queries, req.pages)
    if body.confirmed_calls != ceiling:
        raise ApiError(409, f"This search can make up to {ceiling} billable SERP page requests. Confirm that figure "
                            "to start.", max_calls=ceiling)
    runs.check_key(deps.bs, req.provider)
    runner = request.app.state.runner
    with session(deps.settings.db_path) as conn:
        try:
            with transaction(conn, immediate=True):
                run_id = runs.create_run(conn, req, ceiling)
                runner.enqueue(conn, run_id, "scrape")
        except ActiveJobError as e:  # defensive: a brand-new run cannot have an active job
            raise _conflict(e) from None
    runner.wake()
    return {"id": run_id}


@router.get("/api/runs")
def list_runs(request: Request) -> list[dict]:
    with session(_deps(request).settings.db_path) as conn:
        return runs.list_runs(conn)


@router.get("/api/runs/{run_id}")
def run_detail(request: Request, run_id: str) -> dict:
    with session(_deps(request).settings.db_path) as conn:
        return runs.run_detail(conn, run_id)


@router.get("/api/runs/{run_id}/rows")
def rows(request: Request, run_id: str, offset: int = 0, limit: int = 100, q: str = "") -> dict:
    deps = _deps(request)
    limit = max(1, min(limit, 500))
    with session(deps.settings.db_path) as conn:
        runs.get_run(conn, run_id)
        return runs.serp_rows_page(conn, deps.bs, run_id, max(0, offset), limit, q.strip())


@router.get("/api/runs/{run_id}/serp.xlsx")
def serp_export(request: Request, run_id: str) -> FileResponse:
    deps = _deps(request)
    with session(deps.settings.db_path) as conn:
        run = runs.get_run(conn, run_id)
        data = runs.serp_rows(conn, run_id)
    name = serp_filename(run)
    path = deps.settings.exports_dir / run_id / name
    write_serp_xlsx(path, deps.bs, data)
    return FileResponse(path, filename=name,
                        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@router.post("/api/runs/{run_id}/retry-failed")
def retry_failed(request: Request, run_id: str) -> dict:
    deps = _deps(request)
    runner = request.app.state.runner
    with session(deps.settings.db_path) as conn:
        try:
            with transaction(conn, immediate=True):
                runs.get_run(conn, run_id)
                active = active_job(conn, run_id)
                if active:
                    raise ActiveJobError(active.id, active.kind)
                n = conn.execute("UPDATE queries SET state = 'pending' WHERE run_id = ? AND state = 'failed'",
                                 (run_id,)).rowcount
                pending = conn.execute("SELECT COUNT(*) FROM queries WHERE run_id = ? AND state = 'pending'",
                                       (run_id,)).fetchone()[0]
                if not pending:
                    raise ApiError(409, "No failed or unfinished queries to retry.")
                job_id = runner.enqueue(conn, run_id, "scrape")
                runs.set_run_status(conn, run_id, "scraping")
        except ActiveJobError as e:
            raise _conflict(e) from None
    runner.wake()
    return {"job_id": job_id, "requeued_failed": n, "pending": pending}


@router.delete("/api/runs/{run_id}")
def delete_run(request: Request, run_id: str) -> dict:
    deps = _deps(request)
    with session(deps.settings.db_path) as conn:
        with transaction(conn, immediate=True):
            runs.get_run(conn, run_id)
            active = active_job(conn, run_id)
            if active:
                raise _conflict(ActiveJobError(active.id, active.kind))
            conn.execute("DELETE FROM runs WHERE id = ?", (run_id,))
    shutil.rmtree(deps.settings.exports_dir / run_id, ignore_errors=True)
    return {"deleted": run_id}


@router.post("/api/jobs/{job_id}/cancel")
def cancel_job(request: Request, job_id: int) -> dict:
    deps = _deps(request)
    with session(deps.settings.db_path) as conn:
        if conn.execute("SELECT 1 FROM jobs WHERE id = ?", (job_id,)).fetchone() is None:
            raise ApiError(404, f"No job #{job_id}.")
    return {"state": request.app.state.runner.cancel(job_id)}
```
Every start route converts `ActiveJobError` to 409 through `_conflict`.

- [ ] **Step 8: Wire into main.py**

Replace the body of `create_app` after `deps = Deps(...)` with:
```python
    bus = EventBus()
    runner = JobRunner(settings.db_path, bus, {"scrape": scrape_kind(deps)})

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        await runner.start()
        try:
            yield
        finally:
            await runner.stop()

    app = FastAPI(title="RepScore Pipeline API", lifespan=lifespan)
    app.state.deps = deps
    app.state.bus = bus
    app.state.runner = runner
    install_error_handlers(app)
    app.include_router(health.router)
    app.include_router(runs_routes.router)
    return app
```
with imports:
```python
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from .events import EventBus
from .jobs import JobRunner
from .routes import runs as runs_routes
from .scrape import scrape_kind
```

- [ ] **Step 9: Run tests and lint**

Run: `uv run pytest -q && uv run ruff check . && uv run pyright`
Expected: all PASS, zero warnings.

- [ ] **Step 10: Commit**

```bash
git add api
git commit -m "feat: runs, scrape job, SERP export and run endpoints"
```

---

### Task 8: Resume and cache-boundary tests

**Files:**
- Create: `api/tests/test_resume.py`

**Interfaces:**
- Consumes: `create_app`, `FakeSearch`, real `bulk_search.search_one`, `net._session`, `net._cache_put`, `net.CACHE_DIR`.

These tests pin behaviour the earlier tasks already implement. If one fails, fix the implementation, not the test.

- [ ] **Step 1: Write the tests**

`api/tests/test_resume.py`:
```python
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
        run_id = c.post("/api/runs", json={**SEARCH_BODY, "queries": "\n".join(queries),
                                           "confirmed_calls": 12}).json()["id"]
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


SERPAPI_BODY = {"organic_results": [{"link": "https://x.example/1", "title": "t", "snippet": "s"}],
                "serpapi_pagination": {}}
DATAFORSEO_BODY = {"status_code": 20000, "tasks": [{"status_code": 20000, "result": [{"items": [
    {"type": "organic", "url": "https://x.example/1", "title": "t", "description": "s", "domain": "x.example"}]}]}]}


@pytest.mark.parametrize("provider,body", [("serpapi", SERPAPI_BODY), ("dataforseo", DATAFORSEO_BODY)])
def test_cached_response_is_reused_after_restart(provider, body, monkeypatch, tmp_path):
    from pipeline_api.monitor_bridge import load_bulk_search
    from pipeline_api.settings import load_settings

    bs = load_bulk_search(load_settings({}).company_monitor_dir)
    import net

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
    import net

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
```

- [ ] **Step 2: Run**

Run: `uv run pytest tests/test_resume.py -v`
Expected: PASS. If `test_restart_mid_scrape_runs_each_query_once` finds a query executed twice, the cause is in `run_scrape` storing results after shutdown or `resume_interrupted`; fix there.

- [ ] **Step 3: Commit**

```bash
git add api/tests/test_resume.py
git commit -m "test: resume after restart and provider cache boundary"
```

---

### Task 9: Verify job, verified rows and verify endpoints

**Files:**
- Create: `api/pipeline_api/verify.py`, `api/pipeline_api/routes/verify.py`
- Modify: `api/pipeline_api/main.py` (register `verify` kind and router)
- Create: `api/tests/test_verify.py`

**Interfaces:**
- Consumes: `runs.*`, `export.write_serp_xlsx`, `export.verified_filename`, `JobRunner.enqueue/requeue`, `urlverify.config.load_config`, `urlverify.load.load_records/read_input`, `urlverify.annotate.DUPLICATE_COLUMN`, `urlverify.brands.rule_from_dict`, `urlverify.models.BrandRule`.
- Produces (`verify.py`):
  - `snapshot_rules(config_path, brand_set) -> str` (JSON; raises `ApiError(422)` for unknown set or bad config)
  - `rules_from_snapshot(snapshot_json) -> list[BrandRule]`
  - `class VerifierThread(make_coro)` with `run() -> dict | None` (None = cancelled) and `cancel()`
  - `ingest_verified(conn, verify_job_id, path) -> int`
  - `verify_kind(deps) -> JobKind`
- Produces (routes): `POST /api/runs/{id}/verify` body `{"brand_set": str}` -> `{"verify_job_id", "job_id"}`; `GET /api/runs/{id}/verify/{vj}/results?offset&limit&status&hide_duplicates&q` -> `{"total", "offset", "limit", "rows": [{"seq", "status", "is_duplicate", "row": {...}}]}`; `GET /api/runs/{id}/verify/{vj}/verified.xlsx`; `POST /api/jobs/{id}/retry`.
- Verify progress event: `{"type": "verify_progress", "verify_job_id", "done_urls", "total_urls", "status_counts"}`.

- [ ] **Step 1: Write the failing tests**

`api/tests/test_verify.py`:
```python
import asyncio
import json
import time
from datetime import datetime

import pandas as pd
import pytest
from openpyxl import Workbook

from conftest import SEARCH_BODY, FakeSearch, make_client, wait_until
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


def fake_pipeline(behaviour, record=None, gate=None):
    async def run(input_path, output_path, cfg, brand, cache_dir="cache", rules=None, on_result=None, **kw):
        if record is not None:
            record.append({"brand": brand, "rules": rules, "cache_dir": cache_dir})
        if behaviour == "block_cpu":
            time.sleep(1.5)  # synchronous work on the verifier thread's own loop
        if behaviour == "forever":
            while True:
                await asyncio.sleep(0.05)
        if behaviour == "gate":
            while not gate.is_set():
                await asyncio.sleep(0.02)
        df = pd.read_excel(input_path)
        statuses = ["Verified"] * len(df)
        for s in statuses:
            on_result(s)
        _write_output(output_path, [{**r, "Status": s, "Duplicate Of Row": None}
                                    for r, s in zip(df.to_dict("records"), statuses, strict=True)])
        return {"Verified": len(df), "_rows": len(df), "_duplicates": 0, "_unique": len(df)}
    return run


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
        assert c.get(f"/api/runs/{run_id}/verify/{vj}/results", params={"status": "Verified"}).json()["total"] == 1
        xlsx = c.get(f"/api/runs/{run_id}/verify/{vj}/verified.xlsx")
        assert xlsx.status_code == 200 and "_verified_" in xlsx.headers["content-disposition"]
        assert c.post(f"/api/runs/{run_id}/verify", json={"brand_set": "acme"}).status_code == 422  # deleted now


def test_unknown_brand_set_rejected(settings, keys):
    with make_client(settings, search_one=FakeSearch(), pipeline_run=fake_pipeline("ok")) as c:
        run_id = _scraped_run(c, None)
        r = c.post(f"/api/runs/{run_id}/verify", json={"brand_set": "nope"})
        assert r.status_code == 422 and "nope" in r.json()["error"]
        assert c.get(f"/api/runs/{run_id}").json()["verify_jobs"] == []


def test_verify_does_not_block_the_api(settings, keys):
    with make_client(settings, search_one=FakeSearch(), pipeline_run=fake_pipeline("block_cpu")) as c:
        run_id = _scraped_run(c, None)
        c.post(f"/api/runs/{run_id}/verify", json={"brand_set": "acme"})
        wait_until(lambda: c.get(f"/api/runs/{run_id}").json()["verify_jobs"][0]["status"] == "running")
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
    import threading
    gate = threading.Event()
    with make_client(settings, search_one=FakeSearch(), pipeline_run=fake_pipeline("gate", record, gate)) as c:
        run_id = _scraped_run(c, None)
        c.post(f"/api/runs/{run_id}/verify", json={"brand_set": "acme"})
        wait_until(lambda: record)
    from urlverify import brands
    from urlverify.models import BrandRule
    brands.save_set(settings.verifier_config, "acme", [BrandRule(name="Changed", pattern="Changed")])
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
    ws.append(["Link", "Status", "Published Date", "Query Count", "Duplicate Of Row", "Notes"])
    ws.append(["https://a", "Verified", datetime(2026, 5, 1, 10, 30), 2, None, None])
    ws.append(["https://a?x", "Verified", None, 1.5, 2, "dup"])
    wb.save(path)
    with session(db) as conn:
        conn.execute("INSERT INTO runs (id, name, provider, vertical, pages, status, created_at, updated_at) "
                     "VALUES ('r', 'n', 'serpapi', 'web', 1, 'verifying', ?, ?)", (now(), now()))
        conn.execute("INSERT INTO verify_jobs (run_id, brand_set, brand_rules_json, status, created_at) "
                     "VALUES ('r', 'acme', '[]', 'running', ?)", (now(),))
        assert ingest_verified(conn, 1, path) == 2
        rows = conn.execute("SELECT * FROM verify_rows ORDER BY seq").fetchall()
    first = json.loads(rows[0]["row_json"])
    assert first["Published Date"] == "2026-05-01T10:30:00" and first["Notes"] is None
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
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest tests/test_verify.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pipeline_api.verify'`.

- [ ] **Step 3: Implement verify.py**

```python
"""Verify job: verify a run's SERP rows with an immutable brand-rule snapshot, off the API event loop."""
from __future__ import annotations

import asyncio
import contextlib
import json
import math
import sqlite3
import threading
import time
from collections import Counter
from collections.abc import Callable, Coroutine
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from datetime import date, datetime
from pathlib import Path
from typing import Any

from openpyxl import load_workbook

from . import runs
from .db import now, session, transaction
from .deps import Deps
from .errors import ApiError
from .export import verified_filename, write_serp_xlsx
from .jobs import JobContext, JobKind, JobOutcome, JobRecord


def snapshot_rules(config_path: Path, brand_set: str) -> str:
    """Resolve the set from a FRESH read of config.yaml and deep-copy it to JSON. Exact name; no fallback."""
    from urlverify.config import ConfigError, load_config

    try:
        cfg = load_config(config_path)
    except (ConfigError, OSError, ValueError) as e:
        raise ApiError(422, f"The verifier config {config_path} could not be read: {e}") from None
    rules = cfg.brands.get(brand_set)
    if rules is None:
        raise ApiError(422, f"Brand set {brand_set!r} is not in {config_path.name}. Pick one of: "
                            f"{', '.join(sorted(cfg.brands))}, or add it in the brand editor.")
    return json.dumps([asdict(r) for r in rules])


def rules_from_snapshot(snapshot_json: str) -> list[Any]:
    from urlverify.brands import rule_from_dict

    return [rule_from_dict(d) for d in json.loads(snapshot_json)]


class VerifierThread:
    """Runs one pipeline coroutine on its own event loop in a worker thread. urlverify's pipeline does synchronous
    extraction work inside its coroutines; on this loop that can never stall the API's loop."""

    def __init__(self, make_coro: Callable[[], Coroutine[Any, Any, dict[str, Any]]]):
        self._make_coro = make_coro
        self._loop: asyncio.AbstractEventLoop | None = None
        self._task: asyncio.Task[dict[str, Any]] | None = None
        self._started = threading.Event()
        self._cancel_requested = threading.Event()

    def run(self) -> dict[str, Any] | None:
        loop = asyncio.new_event_loop()
        self._loop = loop
        try:
            asyncio.set_event_loop(loop)
            self._task = loop.create_task(self._make_coro())
            self._started.set()
            if self._cancel_requested.is_set():
                self._task.cancel()
            return loop.run_until_complete(self._task)
        except asyncio.CancelledError:
            return None
        finally:
            self._started.set()
            try:
                loop.run_until_complete(loop.shutdown_asyncgens())
            finally:
                asyncio.set_event_loop(None)
                loop.close()

    def cancel(self) -> None:
        """Cooperative: takes effect at the pipeline's next await; a synchronous step in progress finishes first."""
        self._cancel_requested.set()
        if self._started.is_set() and self._loop is not None and self._task is not None:
            with contextlib.suppress(RuntimeError):  # loop already closed: nothing left to cancel
                self._loop.call_soon_threadsafe(self._task.cancel)


def _jsonable(value: Any) -> Any:
    if value is None or isinstance(value, bool | int | str):
        return value
    if isinstance(value, float):
        return None if math.isnan(value) else value
    if isinstance(value, datetime | date):
        return value.isoformat()
    return str(value)


def ingest_verified(conn: sqlite3.Connection, verify_job_id: int, path: Path) -> int:
    """Copy every row of the verified sheet into verify_rows. The caller holds the transaction."""
    from urlverify.annotate import DUPLICATE_COLUMN

    wb = load_workbook(path, read_only=True, data_only=True)
    try:
        ws = wb.worksheets[0]
        it = ws.iter_rows(values_only=True)
        header = [str(h) if h is not None else "" for h in next(it)]
        status_i = header.index("Status")
        dup_i = header.index(DUPLICATE_COLUMN) if DUPLICATE_COLUMN in header else None
        batch = []
        for seq, raw in enumerate(it):
            values = list(raw) + [None] * (len(header) - len(raw))
            row = {h: _jsonable(v) for h, v in zip(header, values, strict=True)}
            is_dup = int(dup_i is not None and values[dup_i] not in (None, ""))
            batch.append((verify_job_id, seq, row["Status"] if status_i is not None else None, is_dup,
                          json.dumps(row)))
        conn.execute("DELETE FROM verify_rows WHERE verify_job_id = ?", (verify_job_id,))
        conn.executemany("INSERT INTO verify_rows (verify_job_id, seq, status, is_duplicate, row_json) "
                         "VALUES (?, ?, ?, ?, ?)", batch)
        return len(batch)
    finally:
        wb.close()


class _Progress:
    def __init__(self, total: int):
        self.total = total
        self.done = 0
        self.counts: Counter[str] = Counter()
        self.dirty = False

    def add(self, status: str) -> None:
        self.done += 1
        self.counts[status] += 1
        self.dirty = True


async def run_verify(ctx: JobContext, deps: Deps) -> JobOutcome:
    from urlverify.config import load_config
    from urlverify.load import load_records, read_input

    vj_id = ctx.job.ref_id
    assert vj_id is not None
    with session(ctx.db_path) as conn:
        vj = conn.execute("SELECT * FROM verify_jobs WHERE id = ?", (vj_id,)).fetchone()
        run = runs.get_run(conn, ctx.job.run_id)
        rows = runs.serp_rows(conn, run["id"])
    rules = rules_from_snapshot(vj["brand_rules_json"])  # the job's only brand source
    cfg = load_config(deps.settings.verifier_config)  # fetch, match and verdict settings only
    job_dir = deps.settings.exports_dir / run["id"]
    input_path = job_dir / f"verify-{vj_id}-input.xlsx"
    output_path = job_dir / verified_filename(run, vj_id)
    write_serp_xlsx(input_path, deps.bs, rows)
    total = len(load_records(read_input(input_path), cfg.tracking_params)[0])
    with session(ctx.db_path) as conn:
        conn.execute("UPDATE verify_jobs SET status = 'running', total_urls = ?, done_urls = 0, "
                     "status_counts_json = '{}', error = NULL, started_at = ? WHERE id = ?", (total, now(), vj_id))
    progress = _Progress(total)
    api_loop = asyncio.get_running_loop()

    def on_result(status: str) -> None:  # called on the verifier thread
        api_loop.call_soon_threadsafe(progress.add, status)

    def flush() -> None:
        if not progress.dirty:
            return
        progress.dirty = False
        counts = dict(progress.counts)
        with session(ctx.db_path) as conn:
            conn.execute("UPDATE verify_jobs SET done_urls = ?, status_counts_json = ? WHERE id = ?",
                         (progress.done, json.dumps(counts), vj_id))
        ctx.publish({"type": "verify_progress", "verify_job_id": vj_id, "done_urls": progress.done,
                     "total_urls": total, "status_counts": counts})

    vt = VerifierThread(lambda: deps.pipeline_run(input_path, output_path, cfg, vj["brand_set"],
                                                  cache_dir=str(deps.settings.verifier_cache), rules=rules,
                                                  on_result=on_result))
    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix=f"verify-{vj_id}")
    try:
        fut = api_loop.run_in_executor(executor, vt.run)
        last_flush = time.monotonic()
        while not fut.done():
            if ctx.cancel.is_set():
                vt.cancel()
            await asyncio.wait({fut}, timeout=0.2)
            if time.monotonic() - last_flush >= 1.0:
                flush()
                last_flush = time.monotonic()
        counts = fut.result()
    except asyncio.CancelledError:
        vt.cancel()  # runner shutdown: stop the thread; the job stays 'running' and is re-queued on restart
        raise
    finally:
        executor.shutdown(wait=False)
    input_path.unlink(missing_ok=True)
    if counts is None:
        output_path.unlink(missing_ok=True)
        return JobOutcome.CANCELLED
    final = {k: v for k, v in counts.items() if not k.startswith("_")}
    with session(ctx.db_path) as conn, transaction(conn, immediate=True):
        ingest_verified(conn, vj_id, output_path)
        conn.execute("UPDATE verify_jobs SET status = 'done', done_urls = ?, status_counts_json = ?, output_path = ?, "
                     "finished_at = ? WHERE id = ?", (counts.get("_unique", total), json.dumps(final),
                                                      str(output_path), now(), vj_id))
        runs.set_run_status(conn, run["id"], "verified")
    ctx.publish({"type": "verify_progress", "verify_job_id": vj_id, "done_urls": counts.get("_unique", total),
                 "total_urls": total, "status_counts": final})
    return JobOutcome.DONE


def _after_stop_status(conn: sqlite3.Connection, run_id: str) -> str:
    done = conn.execute("SELECT 1 FROM verify_jobs WHERE run_id = ? AND status = 'done' LIMIT 1", (run_id,)).fetchone()
    return "verified" if done else "scraped"


def verify_kind(deps: Deps) -> JobKind:
    async def run(ctx: JobContext) -> JobOutcome:
        return await run_verify(ctx, deps)

    def on_failed(conn: sqlite3.Connection, job: JobRecord, message: str) -> None:
        conn.execute("UPDATE verify_jobs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?",
                     (message, now(), job.ref_id))
        runs.set_run_status(conn, job.run_id, "failed", f"Verification failed: {message}. Use Retry to run it again "
                                                         "with the same brand snapshot.")

    def on_cancelled(conn: sqlite3.Connection, job: JobRecord) -> None:
        conn.execute("UPDATE verify_jobs SET status = 'cancelled', finished_at = ? WHERE id = ?", (now(), job.ref_id))
        runs.set_run_status(conn, job.run_id, _after_stop_status(conn, job.run_id))

    return JobKind(run=run, on_failed=on_failed, on_cancelled=on_cancelled)
```

- [ ] **Step 4: Implement routes/verify.py**

```python
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .. import runs
from ..db import now, session, transaction
from ..errors import ApiError
from ..jobs import ActiveJobError, active_job
from ..verify import snapshot_rules

router = APIRouter()


class VerifyBody(BaseModel):
    brand_set: str


def _conflict(e: ActiveJobError) -> ApiError:
    return ApiError(409, f"{e} Wait for it to finish or cancel it first.",
                    active_job={"id": e.job_id, "kind": e.kind})


@router.post("/api/runs/{run_id}/verify")
def start_verify(request: Request, run_id: str, body: VerifyBody) -> dict:
    deps = request.app.state.deps
    runner = request.app.state.runner
    with session(deps.settings.db_path) as conn:
        try:
            with transaction(conn, immediate=True):
                runs.get_run(conn, run_id)
                active = active_job(conn, run_id)
                if active:
                    raise ActiveJobError(active.id, active.kind)
                counts = runs.query_counts(conn, run_id)
                if counts["pending"]:
                    raise ApiError(409, f"{counts['pending']} queries have not finished. Retry them before verifying.")
                if not counts["serp_rows"]:
                    raise ApiError(409, "This run has no search results to verify.")
                snapshot = snapshot_rules(deps.settings.verifier_config, body.brand_set)
                cur = conn.execute("INSERT INTO verify_jobs (run_id, brand_set, brand_rules_json, status, created_at) "
                                   "VALUES (?, ?, ?, 'queued', ?)", (run_id, body.brand_set, snapshot, now()))
                vj_id = cur.lastrowid
                job_id = runner.enqueue(conn, run_id, "verify", vj_id)
                runs.set_run_status(conn, run_id, "verifying")
        except ActiveJobError as e:
            raise _conflict(e) from None
    runner.wake()
    return {"verify_job_id": vj_id, "job_id": job_id}


def _verify_job(conn: Any, run_id: str, vj_id: int) -> Any:
    row = conn.execute("SELECT * FROM verify_jobs WHERE id = ? AND run_id = ?", (vj_id, run_id)).fetchone()
    if row is None:
        raise ApiError(404, f"No verification #{vj_id} for this run.")
    return row


@router.get("/api/runs/{run_id}/verify/{vj_id}/results")
def results(request: Request, run_id: str, vj_id: int, offset: int = 0, limit: int = 100, status: str = "",
            hide_duplicates: bool = False, q: str = "") -> dict:
    limit = max(1, min(limit, 500))
    where, args = "verify_job_id = ?", [vj_id]
    if status:
        where += " AND status = ?"
        args.append(status)
    if hide_duplicates:
        where += " AND is_duplicate = 0"
    if q.strip():
        where += " AND row_json LIKE ?"
        args.append(f"%{q.strip()}%")
    with session(request.app.state.deps.settings.db_path) as conn:
        _verify_job(conn, run_id, vj_id)
        total = conn.execute(f"SELECT COUNT(*) FROM verify_rows WHERE {where}", args).fetchone()[0]
        rows = conn.execute(f"SELECT seq, status, is_duplicate, row_json FROM verify_rows WHERE {where} "
                            "ORDER BY seq LIMIT ? OFFSET ?", [*args, limit, max(0, offset)]).fetchall()
    return {"total": total, "offset": offset, "limit": limit,
            "rows": [{"seq": r["seq"], "status": r["status"], "is_duplicate": bool(r["is_duplicate"]),
                      "row": json.loads(r["row_json"])} for r in rows]}


@router.get("/api/runs/{run_id}/verify/{vj_id}/verified.xlsx")
def verified_export(request: Request, run_id: str, vj_id: int) -> FileResponse:
    with session(request.app.state.deps.settings.db_path) as conn:
        vj = _verify_job(conn, run_id, vj_id)
    if vj["status"] != "done" or not vj["output_path"]:
        raise ApiError(409, "This verification has not finished, so there is no file yet.")
    path = Path(vj["output_path"])
    if not path.exists():
        raise ApiError(410, f"The verified file {path.name} is missing from data/exports. Re-run verification.")
    return FileResponse(path, filename=path.name,
                        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@router.post("/api/jobs/{job_id}/retry")
def retry_job(request: Request, job_id: int) -> dict:
    runner = request.app.state.runner
    with session(request.app.state.deps.settings.db_path) as conn:
        try:
            with transaction(conn, immediate=True):
                job = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
                if job is None:
                    raise ApiError(404, f"No job #{job_id}.")
                if job["kind"] != "verify":
                    raise ApiError(409, "Retry a search with 'Retry failed queries'.")
                if job["state"] not in ("failed", "cancelled"):
                    raise ApiError(409, f"Job #{job_id} is {job['state']}; only failed or cancelled jobs can be retried.")
                runner.requeue(conn, job_id)
                conn.execute("UPDATE verify_jobs SET status = 'queued', error = NULL WHERE id = ?", (job["ref_id"],))
                runs.set_run_status(conn, job["run_id"], "verifying")
        except ActiveJobError as e:
            raise _conflict(e) from None
    runner.wake()
    return {"job_id": job_id, "state": "queued"}
```

- [ ] **Step 5: Register in main.py**

In `create_app`: change the runner line to
```python
    runner = JobRunner(settings.db_path, bus, {"scrape": scrape_kind(deps), "verify": verify_kind(deps)})
```
and add `app.include_router(verify_routes.router)`, with imports `from .verify import verify_kind` and `from .routes import verify as verify_routes`.

- [ ] **Step 6: Run tests and lint**

Run: `uv run pytest -q && uv run ruff check . && uv run pyright`
Expected: all PASS. `test_verify_happy_path_with_real_pipeline_and_snapshot` exercises the real verifier against the local page server; if its status counts differ, print the verified sheet's `Status` and `Notes` columns to find why before changing expectations.

- [ ] **Step 7: Commit**

```bash
git add api
git commit -m "feat: verify job with immutable brand snapshot, off-loop execution and verified rows"
```

---

### Task 10: SSE endpoint

**Files:**
- Create: `api/pipeline_api/routes/events.py`
- Modify: `api/pipeline_api/main.py` (include router)
- Create: `api/tests/test_sse.py`

**Interfaces:**
- Produces: `event_stream(run_id, bus, snapshot: Callable[[], dict], is_disconnected: Callable[[], Awaitable[bool]], keepalive: float = 15.0) -> AsyncIterator[str]` and `GET /api/runs/{id}/events` (`text/event-stream`). First event `{"type": "snapshot", "run": run_detail}`, then live events; `: keepalive` comment lines when idle. Subscribes before building the snapshot so nothing between the two is lost.

- [ ] **Step 1: Write the failing test**

`api/tests/test_sse.py`:
```python
import asyncio
import json

from pipeline_api.events import EventBus
from pipeline_api.routes.events import event_stream


async def test_snapshot_first_then_live_events_then_keepalive():
    bus = EventBus()
    bus.bind(asyncio.get_running_loop())
    disconnected = False

    async def is_disconnected():
        return disconnected

    gen = event_stream("r1", bus, lambda: {"id": "r1", "status": "scraping"}, is_disconnected, keepalive=0.05)
    first = await gen.__anext__()
    assert first.startswith("data: ") and json.loads(first[6:])["type"] == "snapshot"
    bus.publish("r1", {"type": "query", "done": 1})
    assert json.loads((await gen.__anext__())[6:]) == {"type": "query", "done": 1}
    assert (await gen.__anext__()) == ": keepalive\n\n"
    disconnected = True
    await gen.aclose()
    assert "r1" not in bus._subs


async def test_event_published_while_snapshot_builds_is_not_lost():
    bus = EventBus()
    bus.bind(asyncio.get_running_loop())

    def snapshot():
        bus.publish("r1", {"type": "job", "state": "done"})  # lands between subscribe and snapshot
        return {"id": "r1"}

    async def never():
        return False

    gen = event_stream("r1", bus, snapshot, never)
    await gen.__anext__()
    assert json.loads((await gen.__anext__())[6:])["type"] == "job"
    await gen.aclose()
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest tests/test_sse.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Implement**

`api/pipeline_api/routes/events.py`:
```python
from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from .. import runs
from ..db import session
from ..events import EventBus

router = APIRouter()


def _sse(event: dict[str, Any]) -> str:
    return f"data: {json.dumps(event)}\n\n"


async def event_stream(run_id: str, bus: EventBus, snapshot: Callable[[], dict[str, Any]],
                       is_disconnected: Callable[[], Awaitable[bool]], keepalive: float = 15.0) -> AsyncIterator[str]:
    queue = bus.subscribe(run_id)  # before the snapshot, so nothing published in between is missed
    try:
        yield _sse({"type": "snapshot", "run": snapshot()})
        while not await is_disconnected():
            try:
                event = await asyncio.wait_for(queue.get(), keepalive)
            except TimeoutError:
                yield ": keepalive\n\n"
                continue
            yield _sse(event)
    finally:
        bus.unsubscribe(run_id, queue)


@router.get("/api/runs/{run_id}/events")
async def events(request: Request, run_id: str) -> StreamingResponse:
    db_path = request.app.state.deps.settings.db_path
    with session(db_path) as conn:
        runs.get_run(conn, run_id)  # 404 before opening a stream

    def snapshot() -> dict[str, Any]:
        with session(db_path) as conn:
            return runs.run_detail(conn, run_id)

    return StreamingResponse(event_stream(run_id, request.app.state.bus, snapshot, request.is_disconnected),
                             media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
```
In `main.py`: `app.include_router(events_routes.router)` with `from .routes import events as events_routes`.

- [ ] **Step 4: Run tests**

Run: `uv run pytest -q && uv run pyright`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api
git commit -m "feat: SSE progress stream with snapshot-first delivery"
```

---

### Task 11: Brands API

**Files:**
- Create: `api/pipeline_api/routes/brands.py`
- Modify: `api/pipeline_api/main.py` (include router)
- Create: `api/tests/test_brands_api.py`

**Interfaces:**
- Consumes: `urlverify.brands.list_sets/save_set/delete_set/try_rules/rule_to_dict/rule_from_dict`, `ConfigError`.
- Produces: `GET /api/brands` -> `{"sets": [{"name", "rules": [rule dict]}]}`; `PUT /api/brands/{name}` body `{"rules": [...]}` -> `{"name", "backup"}`; `DELETE /api/brands/{name}` -> `{"deleted", "backup"}`; `POST /api/brands/test` body `{"rules": [...]}` or `{"set": name}` plus `"text"` -> `try_rules` result. `ConfigError` -> 422 with its message.

- [ ] **Step 1: Write the failing tests**

`api/tests/test_brands_api.py`:
```python
from conftest import FakeSearch, make_client

ACME = {"name": "Acme", "pattern": "Acme", "require_context": ["luggage"], "exclude": ["Acme Corp"],
        "case_sensitive": True, "context_window": 40}


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
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest tests/test_brands_api.py -v`
Expected: FAIL (404s).

- [ ] **Step 3: Implement**

`api/pipeline_api/routes/brands.py`:
```python
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel
from urlverify import brands
from urlverify.config import ConfigError

from ..errors import ApiError

router = APIRouter()


class SaveBody(BaseModel):
    rules: list[dict[str, Any]]


class TestBody(BaseModel):
    text: str
    rules: list[dict[str, Any]] | None = None
    set: str | None = None


def _config(request: Request) -> Any:
    return request.app.state.deps.settings.verifier_config


def _rules(raw: list[dict[str, Any]]) -> list[Any]:
    try:
        return [brands.rule_from_dict(d) for d in raw]
    except ConfigError as e:
        raise ApiError(422, str(e)) from None


@router.get("/api/brands")
def list_brands(request: Request) -> dict:
    try:
        sets = brands.list_sets(_config(request))
    except ConfigError as e:
        raise ApiError(500, f"config.yaml could not be read: {e}") from None
    return {"sets": [{"name": n, "rules": [brands.rule_to_dict(r) for r in rules]} for n, rules in sets.items()]}


@router.put("/api/brands/{name}")
def save_brand(request: Request, name: str, body: SaveBody) -> dict:
    try:
        backup = brands.save_set(_config(request), name, _rules(body.rules))
    except ConfigError as e:
        raise ApiError(422, str(e)) from None
    return {"name": name, "backup": str(backup)}


@router.delete("/api/brands/{name}")
def delete_brand(request: Request, name: str) -> dict:
    try:
        backup = brands.delete_set(_config(request), name)
    except ConfigError as e:
        raise ApiError(422, str(e)) from None
    return {"deleted": name, "backup": str(backup)}


@router.post("/api/brands/test")
def test_brand(request: Request, body: TestBody) -> dict:
    if body.set is not None:
        sets = brands.list_sets(_config(request))
        if body.set not in sets:
            raise ApiError(404, f"No brand set named {body.set!r}.")
        rules = sets[body.set]
    else:
        rules = _rules(body.rules or [])
        try:
            brands.validate_set("test", rules)
        except ConfigError as e:
            raise ApiError(422, str(e)) from None
    return brands.try_rules(rules, body.text)
```
Add `app.include_router(brands_routes.router)` in `main.py`.

- [ ] **Step 4: Run tests and full API gate**

Run: `uv run pytest -q && uv run ruff check . && uv run ruff format --check . && uv run pyright`
Expected: all PASS, zero warnings.

- [ ] **Step 5: Commit**

```bash
git add api
git commit -m "feat: brand set API over urlverify.brands"
```

---

### Task 12: Web scaffold, E2E harness, layout, backend banner and runs list

**Files:**
- Create: `web/` via create-next-app, then `web/next.config.ts`, `web/app/globals.css` (edit), `web/app/layout.tsx`, `web/app/page.tsx`, `web/components/AppHeader.tsx`, `web/components/BackendBanner.tsx`, `web/components/NativeSelect.tsx`, `web/components/Field.tsx`, `web/components/StatusBadge.tsx`, `web/components/Clip.tsx`, `web/lib/types.ts`, `web/lib/api.ts`, `web/lib/format.ts`
- Create: `api/pipeline_api/fixture_search.py`, `api/tests/test_fixture_search.py`; Modify: `api/pipeline_api/main.py`
- Create: `e2e/package.json`, `e2e/playwright.config.ts`, `e2e/start-api.sh`, `e2e/pages-server.mjs`, `e2e/fixtures/search.json`, `e2e/fixtures/verifier-config.yaml`, `e2e/tests/helpers.ts`, `e2e/tests/backend-down.spec.ts`, `e2e/tests/runs-list.spec.ts`

**Interfaces:**
- Consumes: every API endpoint from Tasks 4-11.
- Produces (`lib/api.ts`): `api.health/options/plan/createRun/listRuns/getRun/serpRows/retryFailed/deleteRun/cancelJob/retryJob/startVerify/verifyRows/brands/saveBrand/deleteBrand/testBrand`, `ApiError(status, message, body)`, `errorMessage(e)`.
- Produces (`lib/format.ts`): `PROVIDER_LABEL`, `VERTICAL_LABEL`, `STATUS_ORDER`, `fmt(n)`, `period(run)`, `fmtDateTime(iso)`, `fmtElapsed(ms)`.
- Produces components: `NativeSelect` (props of `<select>`), `Field({id, label, hint?, children})`, `StatusBadge({status})`, `Clip({text, className?})`.
- Produces (`fixture_search.py`): `make_fixture_search(bs, path) -> SearchFn`. Fixture JSON: `{"delay_seconds": float, "queries": {"<substring>": [serpapi-like items]}, "default": [...]}`. A query containing a key gets that key's items; a query starting with `fail:` fails.
- Produces (e2e): servers on 8200 (pages), 8100 (API, fixture backend, temp data), 3100 (Next dev). `createRun(page, queries: string[])` and `shot(page, name, info)` helpers.

- [ ] **Step 1: Scaffold Next.js and shadcn/ui**

```bash
cd ~/Desktop/niks/repscore-pipeline
npx create-next-app@latest web --typescript --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-npm --yes
cd web
npx shadcn@latest init -d
npx shadcn@latest add button input textarea label card progress alert-dialog
```
Delete the create-next-app demo content from `app/page.tsx` and the `public/*.svg` files, and remove the Geist font imports from `app/layout.tsx` (replaced in Step 6).

- [ ] **Step 2: Fixture search backend (API)**

`api/tests/test_fixture_search.py`:
```python
import json

from fastapi.testclient import TestClient

from conftest import wait_until
from pipeline_api.fixture_search import make_fixture_search
from pipeline_api.main import create_app
from pipeline_api.monitor_bridge import load_bulk_search
from pipeline_api.settings import Settings, load_settings

ITEMS = {"queries": {"mokobara luggage": [{"title": "T", "link": "http://x.example/1", "snippet": "s", "date": ""}]},
         "default": []}


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
```

`api/pipeline_api/fixture_search.py`:
```python
"""A search_one stand-in for end-to-end tests: results come from a JSON file, never from a provider."""
from __future__ import annotations

import json
import threading
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .deps import SearchFn


def make_fixture_search(bs: Any, path: Path) -> SearchFn:
    data = json.loads(path.read_text())
    delay = float(data.get("delay_seconds", 0))

    def search_one(query: str, start: str, end: str, pages: int, vertical: str, provider: str = "serpapi",
                   stop: threading.Event | None = None) -> tuple[list[dict[str, Any]], str, int]:
        time.sleep(delay)
        if query.startswith("fail:"):
            return [], "fixture: simulated provider failure (after 3 attempts)", 3
        key = next((k for k in data["queries"] if k in query), None)
        items = data["queries"][key] if key else data.get("default", [])
        fetched_at = datetime.now(UTC).isoformat(timespec="seconds")
        return bs.map_results(items, query, vertical, fetched_at, start, end, provider), "", 1

    return search_one
```
In `main.py` replace `search_one=search_one or bs.search_one` in the `Deps(...)` call with `search_one=search_one or _default_search(settings, bs)` and add:
```python
def _default_search(settings: Settings, bs: Any) -> SearchFn:
    if settings.search_backend == "fixture":
        assert settings.search_fixture is not None  # Settings.check() guarantees it
        return make_fixture_search(bs, settings.search_fixture)
    return bs.search_one
```
with `from typing import Any` and `from .fixture_search import make_fixture_search`.

Run: `cd api && uv run pytest -q` - Expected: PASS.

- [ ] **Step 3: E2E harness**

`e2e/package.json`:
```json
{
  "name": "repscore-pipeline-e2e",
  "private": true,
  "type": "module",
  "scripts": { "test": "playwright test" },
  "devDependencies": { "@playwright/test": "^1.55.0", "@types/node": "^24.0.0", "typescript": "^5.9.0" }
}
```
Run: `cd e2e && npm install && npx playwright install chromium`

`e2e/playwright.config.ts`:
```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: { baseURL: "http://localhost:3100", trace: "retain-on-failure" },
  projects: [
    { name: "desktop-1280", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "desktop-1920", use: { ...devices["Desktop Chrome"], viewport: { width: 1920, height: 1080 } } },
  ],
  webServer: [
    { command: "node pages-server.mjs", url: "http://127.0.0.1:8200/health", reuseExistingServer: false },
    { command: "bash start-api.sh", url: "http://127.0.0.1:8100/api/health", reuseExistingServer: false, timeout: 90_000 },
    {
      command: "npm run dev -- --port 3100",
      cwd: "../web",
      url: "http://localhost:3100",
      env: { API_ORIGIN: "http://127.0.0.1:8100" },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
```

`e2e/start-api.sh`:
```bash
#!/usr/bin/env bash
# API for end-to-end tests: fresh temp data, fixture search backend, test verifier config, dummy keys.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$here/.tmp"
rm -rf "$tmp"
mkdir -p "$tmp/cache"
cp "$here/fixtures/verifier-config.yaml" "$tmp/config.yaml"
export PIPELINE_DATA_DIR="$tmp/data"
export URL_VERIFICATION_CONFIG="$tmp/config.yaml"
export URL_VERIFICATION_CACHE="$tmp/cache"
export PIPELINE_SEARCH_BACKEND=fixture
export PIPELINE_SEARCH_FIXTURE="$here/fixtures/search.json"
export SERPAPI_KEY=e2e-dummy DATAFORSEO_LOGIN=e2e DATAFORSEO_PASSWORD=e2e
cd "$here/../api"
exec uv run uvicorn pipeline_api.main:create_app --factory --host 127.0.0.1 --port 8100
```

`e2e/pages-server.mjs`:
```js
import http from "node:http";

const page = (title, paras) =>
  `<html><head><title>${title}</title></head><body><article><h1>${title}</h1>${paras
    .map((p) => `<p>${p}</p>`)
    .join("")}</article></body></html>`;
const filler =
  "Travel gear makers reported steady demand this season as more people booked trips across the country and abroad.";
const pages = {
  "/health": "ok",
  "/article-1": page("Mokobara expands its luggage range", [
    "Mokobara launched a new cabin trolley this week, adding to its growing luggage line.",
    filler,
    "Founders of Mokobara said the brand will open more stores next year.",
    filler,
  ]),
  "/article-2": page("Monsoon travel tips", [filler, filler, filler, filler]),
  "/article-3": page("Best cabin bags of the year", [
    filler,
    "Among the picks, Mokobara stood out for its build quality and its lifetime warranty on wheels.",
    filler,
    filler,
  ]),
};

http
  .createServer((req, res) => {
    const body = pages[(req.url ?? "/").split("?")[0]];
    if (!body) {
      res.writeHead(404, { "Content-Type": "text/html" });
      res.end("<html><body>Not found</body></html>");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(body);
  })
  .listen(8200, "127.0.0.1");
```

`e2e/fixtures/search.json`:
```json
{
  "delay_seconds": 0.3,
  "queries": {
    "mokobara luggage": [
      {"title": "Mokobara expands its luggage range", "link": "http://127.0.0.1:8200/article-1", "snippet": "Mokobara launched a new cabin trolley", "date": "May 2, 2026"},
      {"title": "Monsoon travel tips", "link": "http://127.0.0.1:8200/article-2", "snippet": "Travel gear makers reported steady demand", "date": ""},
      {"title": "Removed page", "link": "http://127.0.0.1:8200/gone", "snippet": "", "date": ""}
    ],
    "mokobara review": [
      {"title": "Mokobara expands its luggage range", "link": "http://127.0.0.1:8200/article-1?utm_source=feed", "snippet": "Mokobara launched", "date": ""},
      {"title": "Best cabin bags of the year", "link": "http://127.0.0.1:8200/article-3", "snippet": "Among the picks, Mokobara stood out", "date": ""}
    ]
  },
  "default": [
    {"title": "Default result", "link": "http://127.0.0.1:8200/article-2", "snippet": "", "date": ""}
  ]
}
```

`e2e/fixtures/verifier-config.yaml`: copy `api/tests/fixtures/verifier_config.yaml` and add under `brands:`:
```yaml
  mokobara:
    - name: Mokobara
      pattern: 'Mokobara|MOKOBARA|[#@]mokobara\w*'
```

`e2e/tests/helpers.ts`:
```ts
import { expect, type Page, type TestInfo } from "@playwright/test";

export async function createRun(page: Page, queries: string[]) {
  await page.goto("/runs/new");
  await page.getByLabel("Queries").fill(queries.join("\n"));
  await expect(page.getByTestId("plan-count")).toHaveText(String(queries.length));
  await page.getByRole("button", { name: "Run search" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Confirm and run" }).click();
  await expect(page).toHaveURL(/\/runs\/[0-9a-f]{12}$/);
}

export async function shot(page: Page, name: string, info: TestInfo) {
  await page.screenshot({ path: info.outputPath(`${name}-${info.project.name}.png`), fullPage: true });
}
```

- [ ] **Step 4: Write the failing E2E tests**

`e2e/tests/backend-down.spec.ts`:
```ts
import { expect, test } from "@playwright/test";

test("tells the user how to start the backend when the API is down", async ({ page }) => {
  await page.route("**/api/health", (route) => route.fulfill({ status: 502, body: "Bad Gateway" }));
  await page.goto("/");
  const alert = page.getByRole("alert").filter({ hasText: "Backend not reachable" });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("make dev");
});
```

`e2e/tests/runs-list.spec.ts`:
```ts
import { expect, test } from "@playwright/test";
import { shot } from "./helpers";

test("runs list shows navigation and the New run action", async ({ page }, info) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Runs", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "New run" })).toBeVisible();
  await expect(page.getByRole("navigation").getByRole("link", { name: "Brands" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0); // healthy backend: no setup banner
  await shot(page, "runs-list", info);
});
```

Run: `cd e2e && npx playwright test`
Expected: FAIL (no heading "Runs", no banner).

- [ ] **Step 5: Config, tokens, types, API client, formatting**

`web/next.config.ts`:
```ts
import type { NextConfig } from "next";

const API_ORIGIN = process.env.API_ORIGIN ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  compress: false, // gzip would buffer the SSE progress stream
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` }];
  },
};

export default nextConfig;
```

Append to `web/app/globals.css` (after the shadcn block, so these win):
```css
:root {
  --brand-red: #d41829;
  --brand-red-hover: #b81422;
  --brand-navy: #000c66;
  --brand-blue: #186ac9;
  --primary: #d41829;
  --primary-foreground: #ffffff;
  --ring: #186ac9;
}

@theme inline {
  --color-brand-red: var(--brand-red);
  --color-brand-red-hover: var(--brand-red-hover);
  --color-brand-navy: var(--brand-navy);
  --color-brand-blue: var(--brand-blue);
  --font-heading: Georgia, "Times New Roman", serif;
  --font-sans: Aptos, Calibri, Arial, sans-serif;
}

body {
  font-family: var(--font-sans);
}

h1,
h2,
h3 {
  font-family: var(--font-heading);
  color: var(--brand-navy);
}
```
In `components/ui/button.tsx`, make the default variant hover use the brand hover: replace the default variant's `hover:bg-primary/90` with `hover:bg-brand-red-hover`.

`web/lib/types.ts`:
```ts
export type Provider = "serpapi" | "dataforseo";
export type Vertical = "web" | "news" | "news_tab";
export type RunStatus = "scraping" | "scraped" | "verifying" | "verified" | "failed";
export type JobState = "queued" | "running" | "cancelling" | "done" | "failed" | "cancelled";
export type Cell = string | number | boolean | null;

export interface Options { providers: Provider[]; verticals: Vertical[]; max_pages: Record<Provider, number> }
export interface Health {
  ok: boolean;
  company_monitor: boolean;
  url_verification: boolean;
  verifier_config_error: string | null;
  keys: Record<Provider, string | null>;
  chromium: boolean;
}
export interface SearchInput { queries: string; provider: Provider; vertical: Vertical; pages: string; start: string; end: string }
export interface Plan { queries: string[]; count: number; pages: number; max_calls: number; cached_calls: number }
export interface QueryRow {
  id: number;
  position: number;
  text: string;
  state: "pending" | "done" | "failed";
  found: number | null;
  out_of_range: number | null;
  attempts: number | null;
  error: string | null;
}
export interface Job {
  id: number;
  kind: "scrape" | "verify";
  run_id: string;
  ref_id: number | null;
  state: JobState;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  resumed_at: string | null;
}
export interface BrandRule {
  name: string;
  pattern: string;
  require_context: string[];
  exclude: string[];
  case_sensitive: boolean;
  context_window: number;
}
export interface BrandSet { name: string; rules: BrandRule[] }
export interface VerifyJob {
  id: number;
  brand_set: string;
  brand_rules: BrandRule[];
  status: JobState;
  total_urls: number | null;
  done_urls: number;
  status_counts: Record<string, number>;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  has_output: boolean;
}
export interface RunCounts { queries: number; done: number; failed: number; pending: number; serp_rows: number }
export interface RunDetail {
  id: string;
  name: string;
  provider: Provider;
  vertical: Vertical;
  pages: number;
  start_date: string | null;
  end_date: string | null;
  status: RunStatus;
  max_calls: number;
  error: string | null;
  created_at: string;
  updated_at: string;
  counts: RunCounts;
  queries: QueryRow[];
  verify_jobs: VerifyJob[];
  active_job: Job | null;
  last_job: Job | null;
}
export interface RunListItem {
  id: string;
  name: string;
  provider: Provider;
  vertical: Vertical;
  start_date: string | null;
  end_date: string | null;
  status: RunStatus;
  updated_at: string;
  serp_rows: number;
  verified: number | null;
}
export interface Page<T> { total: number; offset: number; limit: number; rows: T[] }
export type SerpRow = Record<string, Cell>;
export interface VerifyRow { seq: number; status: string | null; is_duplicate: boolean; row: Record<string, Cell> }
export interface TryResult {
  hits: { brand: string; offset: number; snippet: string }[];
  excluded: { brand: string; offset: number; text: string; reason: string; snippet: string }[];
}
export type RunEvent =
  | { type: "snapshot"; run: RunDetail }
  | {
      type: "query";
      query_id: number;
      position: number;
      state: QueryRow["state"];
      found: number;
      out_of_range: number;
      attempts: number;
      error: string | null;
      done: number;
      failed: number;
      total: number;
      rows: number;
    }
  | { type: "verify_progress"; verify_job_id: number; done_urls: number; total_urls: number; status_counts: Record<string, number> }
  | { type: "job"; job_id: number; kind: Job["kind"]; state: JobState; error: string | null }
  | { type: "resync" };
```

`web/lib/api.ts`:
```ts
import type {
  BrandRule, BrandSet, Health, Options, Page, Plan, RunDetail, RunListItem, SearchInput, SerpRow, TryResult, VerifyRow,
} from "./types";

const DOWN = "Backend not reachable. Start it with `make dev` in the repscore-pipeline folder.";

export class ApiError extends Error {
  constructor(public status: number, message: string, public body: unknown) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
  } catch {
    throw new ApiError(0, DOWN, null);
  }
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!res.ok) {
    const fromBody = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : null;
    throw new ApiError(res.status, fromBody ?? (res.status >= 502 ? DOWN : `Request failed (${res.status}).`), body);
  }
  return body as T;
}

const post = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : "";
}

export const api = {
  health: () => request<Health>("/api/health"),
  options: () => request<Options>("/api/options"),
  plan: (input: SearchInput) => post<Plan>("/api/plan", input),
  createRun: (input: SearchInput & { confirmed_calls: number }) => post<{ id: string }>("/api/runs", input),
  listRuns: () => request<RunListItem[]>("/api/runs"),
  getRun: (id: string) => request<RunDetail>(`/api/runs/${id}`),
  serpRows: (id: string, p: { offset: number; limit: number; q: string }) =>
    request<Page<SerpRow>>(`/api/runs/${id}/rows${qs(p)}`),
  retryFailed: (id: string) => post<{ job_id: number }>(`/api/runs/${id}/retry-failed`),
  deleteRun: (id: string) => request<{ deleted: string }>(`/api/runs/${id}`, { method: "DELETE" }),
  cancelJob: (jobId: number) => post<{ state: string }>(`/api/jobs/${jobId}/cancel`),
  retryJob: (jobId: number) => post<{ state: string }>(`/api/jobs/${jobId}/retry`),
  startVerify: (id: string, brandSet: string) =>
    post<{ verify_job_id: number; job_id: number }>(`/api/runs/${id}/verify`, { brand_set: brandSet }),
  verifyRows: (id: string, vj: number, p: { offset: number; limit: number; status?: string; hide_duplicates?: boolean; q?: string }) =>
    request<Page<VerifyRow>>(`/api/runs/${id}/verify/${vj}/results${qs(p)}`),
  brands: () => request<{ sets: BrandSet[] }>("/api/brands"),
  saveBrand: (name: string, rules: BrandRule[]) =>
    request<{ name: string; backup: string }>(`/api/brands/${encodeURIComponent(name)}`, { method: "PUT", body: JSON.stringify({ rules }) }),
  deleteBrand: (name: string) =>
    request<{ deleted: string; backup: string }>(`/api/brands/${encodeURIComponent(name)}`, { method: "DELETE" }),
  testBrand: (body: { text: string; rules?: BrandRule[]; set?: string }) => post<TryResult>("/api/brands/test", body),
};

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
```

`web/lib/format.ts`:
```ts
export const PROVIDER_LABEL: Record<string, string> = { serpapi: "SerpAPI", dataforseo: "DataForSEO" };
export const VERTICAL_LABEL: Record<string, string> = { web: "Web", news: "News", news_tab: "News tab" };
export const STATUS_ORDER = [
  "Verified", "Title only", "Weak mention", "Boilerplate only", "Brand not found", "Page unreachable", "Unsupported platform",
] as const;

export const fmt = (n: number | null | undefined) => (n ?? 0).toLocaleString("en-IN");

export function period(r: { start_date: string | null; end_date: string | null }): string {
  return r.start_date && r.end_date ? `${r.start_date} to ${r.end_date}` : "Any date";
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (x: number) => String(x).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}
```

- [ ] **Step 6: Shared components, layout, banner, runs list**

`web/components/NativeSelect.tsx`:
```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-9 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
```

`web/components/Field.tsx`:
```tsx
import { Label } from "@/components/ui/label";

export function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-neutral-500">{hint}</p>}
    </div>
  );
}
```

`web/components/Clip.tsx`:
```tsx
import { cn } from "@/lib/utils";

/** One-line text that truncates, with the full value in the native tooltip. */
export function Clip({ text, className }: { text: string; className?: string }) {
  return (
    <span title={text} className={cn("block truncate", className)}>
      {text}
    </span>
  );
}
```

`web/components/StatusBadge.tsx`:
```tsx
import { cn } from "@/lib/utils";
import type { RunStatus } from "@/lib/types";

const STYLES: Record<RunStatus, string> = {
  scraping: "bg-blue-50 text-blue-800 ring-blue-200",
  scraped: "bg-neutral-100 text-neutral-800 ring-neutral-200",
  verifying: "bg-blue-50 text-blue-800 ring-blue-200",
  verified: "bg-green-50 text-green-800 ring-green-200",
  failed: "bg-red-50 text-red-800 ring-red-200",
};
const LABELS: Record<RunStatus, string> = {
  scraping: "Searching",
  scraped: "Searched",
  verifying: "Verifying",
  verified: "Verified",
  failed: "Failed",
};

export function StatusBadge({ status }: { status: RunStatus }) {
  return (
    <span data-testid="run-status" className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", STYLES[status])}>
      {LABELS[status]}
    </span>
  );
}
```

`web/components/AppHeader.tsx`:
```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Runs" },
  { href: "/brands", label: "Brands" },
];

export function AppHeader() {
  const path = usePathname();
  return (
    <header className="border-b border-neutral-200 bg-white">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-8 px-6">
        <Link href="/" className="font-heading text-lg text-brand-navy">
          RepScore Pipeline
        </Link>
        <nav className="flex gap-6 text-sm">
          {NAV.map((n) => {
            const active = n.href === "/" ? path === "/" || path.startsWith("/runs") : path.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={active ? "font-semibold text-brand-red" : "text-neutral-600 hover:text-neutral-900"}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
```

`web/components/BackendBanner.tsx`:
```tsx
"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Health } from "@/lib/types";

export function BackendBanner() {
  const [health, setHealth] = useState<Health | null>(null);
  const [down, setDown] = useState(false);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const h = await api.health();
        if (alive) {
          setHealth(h);
          setDown(false);
        }
      } catch {
        if (alive) setDown(true);
      }
    };
    void check();
    const t = setInterval(check, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (down) {
    return (
      <Banner tone="error" title="Backend not reachable">
        The API at 127.0.0.1:8000 is not responding. Start it with <code>make dev</code> in the repscore-pipeline folder.
      </Banner>
    );
  }
  if (!health) return null;
  const problems: string[] = [];
  if (health.verifier_config_error) problems.push(`Verifier config: ${health.verifier_config_error}`);
  if (!health.chromium) problems.push("Chromium for the verifier is not installed. Run `uv run playwright install chromium` in url-verification.");
  for (const [provider, message] of Object.entries(health.keys)) {
    if (message) problems.push(`${provider === "serpapi" ? "SerpAPI" : "DataForSEO"}: ${message}`);
  }
  if (!problems.length) return null;
  return (
    <Banner tone="warning" title="Setup needs attention">
      <ul className="list-disc pl-5">
        {problems.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </Banner>
  );
}

function Banner({ tone, title, children }: { tone: "error" | "warning"; title: string; children: React.ReactNode }) {
  return (
    <div role="alert" className={tone === "error" ? "border-b border-red-200 bg-red-50" : "border-b border-amber-200 bg-amber-50"}>
      <div className="mx-auto max-w-[1440px] px-6 py-3 text-sm">
        <p className="font-semibold">{title}</p>
        <div className="mt-1 text-neutral-700">{children}</div>
      </div>
    </div>
  );
}
```

`web/app/layout.tsx`:
```tsx
import type { Metadata } from "next";
import "./globals.css";
import { AppHeader } from "@/components/AppHeader";
import { BackendBanner } from "@/components/BackendBanner";

export const metadata: Metadata = {
  title: "RepScore Pipeline",
  description: "Search Google through SerpAPI or DataForSEO, then verify every result URL.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-neutral-900 antialiased">
        <AppHeader />
        <BackendBanner />
        <main className="mx-auto max-w-[1440px] px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
```

`web/app/page.tsx`:
```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Clip } from "@/components/Clip";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
import { PROVIDER_LABEL, VERTICAL_LABEL, fmt, fmtDateTime, period } from "@/lib/format";
import type { RunListItem } from "@/lib/types";

export default function RunsPage() {
  const [runs, setRuns] = useState<RunListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listRuns().then(setRuns).catch((e) => setError(errorMessage(e)));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl">Runs</h1>
        <Button asChild>
          <Link href="/runs/new">New run</Link>
        </Button>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {runs && runs.length === 0 && (
        <p className="rounded-md border border-dashed p-8 text-center text-neutral-600">No runs yet. Start one with New run.</p>
      )}
      {runs && runs.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[960px] table-fixed text-sm">
            <colgroup>
              <col />
              <col className="w-52" />
              <col className="w-28" />
              <col className="w-24" />
              <col className="w-28" />
              <col className="w-28" />
              <col className="w-24" />
              <col className="w-44" />
            </colgroup>
            <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Period</th>
                <th className="px-3 py-2">Engine</th>
                <th className="px-3 py-2">Vertical</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Results</th>
                <th className="px-3 py-2 text-right">Verified</th>
                <th className="px-3 py-2">Updated</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-t hover:bg-neutral-50">
                  <td className="px-3 py-2">
                    <Link href={`/runs/${r.id}`} className="block truncate text-brand-blue hover:underline" title={r.name}>
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2"><Clip text={period(r)} /></td>
                  <td className="px-3 py-2">{PROVIDER_LABEL[r.provider]}</td>
                  <td className="px-3 py-2">{VERTICAL_LABEL[r.vertical]}</td>
                  <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(r.serp_rows)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.verified === null ? "" : fmt(r.verified)}</td>
                  <td className="px-3 py-2"><Clip text={fmtDateTime(r.updated_at)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Run E2E and lint**

Run: `cd e2e && npx playwright test && cd ../web && npm run lint && npx tsc --noEmit`
Expected: both E2E specs PASS on both projects; lint and tsc clean. Open the screenshots in `e2e/test-results/` and check alignment of header, nav and table at both widths.

- [ ] **Step 8: Commit**

```bash
git add web e2e api
git commit -m "feat: next.js shell, backend banner, runs list and e2e harness"
```

---

### Task 13: New run page with request preview and confirmation

**Files:**
- Create: `web/app/runs/new/page.tsx`, `web/components/SearchForm.tsx`, `web/components/PlanPreview.tsx`, `web/lib/usePlan.ts`
- Create: `e2e/tests/new-run.spec.ts`

**Interfaces:**
- Consumes: `api.options`, `api.plan`, `api.createRun`, `NativeSelect`, `Field`, `fmt`, `PROVIDER_LABEL`.
- Produces: `usePlan(input: SearchInput) -> { plan: Plan | null; error: string | null; loading: boolean }` (debounced 400 ms, ignores stale responses). Test ids: `plan-count`, `plan-pages`, `plan-max`, `plan-cached`, `parsed-queries`.

- [ ] **Step 1: Write the failing E2E test**

`e2e/tests/new-run.spec.ts`:
```ts
import { expect, test } from "@playwright/test";
import { shot } from "./helpers";

test("previews parsed queries and billable pages before spending", async ({ page }, info) => {
  await page.goto("/runs/new");
  await expect(page.getByRole("heading", { name: "New run", level: 1 })).toBeVisible();
  await page.getByLabel("Queries").fill('"Mokobara, luggage" OR Mokobara\nmokobara review');
  await expect(page.getByTestId("plan-count")).toHaveText("3"); // the comma split is visible, not silent
  await page.getByText("Show parsed queries").click();
  await expect(page.getByTestId("parsed-queries").getByRole("listitem")).toHaveCount(3);
  await expect(page.getByTestId("plan-max")).toHaveText("3");
  await expect(page.getByTestId("plan-cached")).toHaveText("0");
  await expect(page.getByText("Maximum billable SERP pages")).toBeVisible();
  await expect(page.locator("main")).not.toContainText("$");

  await page.getByLabel("Pages per query").fill("5");
  await expect(page.getByTestId("plan-max")).toHaveText("15");
  await page.getByLabel("Vertical").selectOption("news");
  await expect(page.getByTestId("plan-pages")).toHaveText("1");
  await expect(page.getByTestId("plan-max")).toHaveText("3");
  await shot(page, "new-run", info);

  await page.getByRole("button", { name: "Run search" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("up to 3 billable SERP page requests");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();

  await page.getByLabel("Start date").fill("2026-09-01");
  await page.getByLabel("End date").fill("2026-08-01");
  await expect(page.getByRole("alert").filter({ hasText: "after end date" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run search" })).toBeDisabled();
  await page.getByLabel("End date").fill("");
  await expect(page.getByRole("alert").filter({ hasText: "together" })).toBeVisible();
});
```

Run: `cd e2e && npx playwright test tests/new-run.spec.ts` - Expected: FAIL (404 page).

- [ ] **Step 2: Implement usePlan**

`web/lib/usePlan.ts`:
```ts
"use client";

import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "./api";
import type { Plan, SearchInput } from "./types";

export function usePlan(input: SearchInput) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const empty = !input.queries.trim();

  useEffect(() => {
    const mine = ++seq.current; // any later edit makes this request stale
    if (empty) return;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const p = await api.plan(input);
        if (mine === seq.current) {
          setPlan(p);
          setError(null);
        }
      } catch (e) {
        if (mine === seq.current) {
          setPlan(null);
          setError(errorMessage(e));
        }
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [input, empty]);

  return empty ? { plan: null, error: null, loading: false } : { plan, error, loading };
}
```

- [ ] **Step 3: Implement PlanPreview and SearchForm**

`web/components/PlanPreview.tsx`:
```tsx
import { Card } from "@/components/ui/card";
import { fmt } from "@/lib/format";
import type { Plan, Provider } from "@/lib/types";

export function PlanPreview({ plan, error, loading, provider }: { plan: Plan | null; error: string | null; loading: boolean; provider: Provider }) {
  return (
    <Card className="gap-3 p-5">
      <h2 className="text-base">Before you run</h2>
      {error ? (
        <p role="alert" className="text-sm text-red-700">{error}</p>
      ) : !plan ? (
        <p className="text-sm text-neutral-500">Paste queries to see how many billable pages this search can use.</p>
      ) : (
        <>
          <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-sm tabular-nums">
            <dt>Queries</dt>
            <dd data-testid="plan-count" className="text-right">{plan.count}</dd>
            <dt>Pages per query</dt>
            <dd data-testid="plan-pages" className="text-right">{plan.pages}</dd>
            <dt className="font-semibold">Maximum billable SERP pages</dt>
            <dd data-testid="plan-max" className="text-right font-semibold">{fmt(plan.max_calls)}</dd>
            <dt>Already cached (free)</dt>
            <dd data-testid="plan-cached" className="text-right">{fmt(plan.cached_calls)}</dd>
          </dl>
          <p className="text-xs text-neutral-500">
            An upper bound: a query stops early when results run out.
            {provider === "dataforseo" && " DataForSEO fetches all of a query's pages in one request but bills each page."}
          </p>
          <details className="text-sm">
            <summary className="cursor-pointer text-brand-blue">Show parsed queries</summary>
            <ol data-testid="parsed-queries" className="mt-2 max-h-48 list-decimal space-y-1 overflow-auto pl-6 font-mono text-xs">
              {plan.queries.map((q, i) => (
                <li key={i} className="break-all">{q}</li>
              ))}
            </ol>
          </details>
        </>
      )}
      <p aria-live="polite" className="h-4 text-xs text-neutral-500">{loading ? "Updating..." : ""}</p>
    </Card>
  );
}
```

`web/components/SearchForm.tsx`:
```tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Field } from "@/components/Field";
import { NativeSelect } from "@/components/NativeSelect";
import { PlanPreview } from "@/components/PlanPreview";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api";
import { PROVIDER_LABEL, VERTICAL_LABEL, fmt } from "@/lib/format";
import type { Options, Provider, SearchInput, Vertical } from "@/lib/types";
import { usePlan } from "@/lib/usePlan";

const FALLBACK: Options = { providers: ["serpapi", "dataforseo"], verticals: ["web", "news", "news_tab"], max_pages: { serpapi: 50, dataforseo: 20 } };

export function SearchForm() {
  const router = useRouter();
  const [options, setOptions] = useState<Options>(FALLBACK);
  const [form, setForm] = useState<SearchInput>({ queries: "", provider: "serpapi", vertical: "web", pages: "1", start: "", end: "" });
  const { plan, error, loading } = usePlan(form);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    api.options().then(setOptions).catch(() => undefined); // the banner reports a down backend
  }, []);

  const set = <K extends keyof SearchInput>(key: K, value: SearchInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const canRun = !!plan && !error && !loading && !submitting;

  async function submit() {
    if (!plan) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { id } = await api.createRun({ ...form, confirmed_calls: plan.max_calls });
      router.push(`/runs/${id}`);
    } catch (e) {
      setSubmitError(errorMessage(e));
      setSubmitting(false);
      setConfirmOpen(false);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="space-y-6">
        <Field id="queries" label="Queries" hint="One query per line. Boolean operators and quotes are fine. A comma also splits queries, so check the parsed list.">
          <Textarea id="queries" rows={14} value={form.queries} onChange={(e) => set("queries", e.target.value)} className="font-mono text-sm" />
        </Field>
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-5">
          <Field id="provider" label="Engine">
            <NativeSelect id="provider" value={form.provider} onChange={(e) => set("provider", e.target.value as Provider)}>
              {options.providers.map((p) => (
                <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="vertical" label="Vertical">
            <NativeSelect id="vertical" value={form.vertical} onChange={(e) => set("vertical", e.target.value as Vertical)}>
              {options.verticals.map((v) => (
                <option key={v} value={v}>{VERTICAL_LABEL[v]}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="pages" label="Pages per query" hint={`Up to ${options.max_pages[form.provider]} on ${PROVIDER_LABEL[form.provider]}`}>
            <Input id="pages" type="number" min={1} max={options.max_pages[form.provider]} value={form.pages} onChange={(e) => set("pages", e.target.value)} />
          </Field>
          <Field id="start" label="Start date">
            <Input id="start" type="date" value={form.start} onChange={(e) => set("start", e.target.value)} />
          </Field>
          <Field id="end" label="End date">
            <Input id="end" type="date" value={form.end} onChange={(e) => set("end", e.target.value)} />
          </Field>
        </div>
      </section>
      <aside className="space-y-4">
        <PlanPreview plan={plan} error={error} loading={loading} provider={form.provider} />
        <Button className="w-full" disabled={!canRun} onClick={() => setConfirmOpen(true)}>Run search</Button>
        {submitError && <p role="alert" className="text-sm text-red-700">{submitError}</p>}
      </aside>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start this search?</AlertDialogTitle>
            <AlertDialogDescription>
              This can make up to {fmt(plan?.max_calls)} billable SERP page requests on {PROVIDER_LABEL[form.provider]} ({fmt(plan?.cached_calls)} already cached and free). Queries stop early when results run out, so the real number is usually lower.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={submitting}
              onClick={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              Confirm and run
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

`web/app/runs/new/page.tsx`:
```tsx
import { SearchForm } from "@/components/SearchForm";

export default function NewRunPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl">New run</h1>
      <SearchForm />
    </div>
  );
}
```

- [ ] **Step 4: Run E2E and lint**

Run: `cd e2e && npx playwright test tests/new-run.spec.ts && cd ../web && npm run lint && npx tsc --noEmit`
Expected: PASS. Check the screenshots: the preview card must not jump in height when "Updating..." toggles.

- [ ] **Step 5: Commit**

```bash
git add web e2e
git commit -m "feat: new run form with parsed query preview and billable page confirmation"
```

---

### Task 14: Run page - live search progress, results and run actions

**Files:**
- Create: `web/app/runs/[id]/page.tsx`, `web/lib/useRun.ts`, `web/lib/steps.ts`, `web/components/Stepper.tsx`, `web/components/Elapsed.tsx`, `web/components/Pager.tsx`, `web/components/RunHeader.tsx`, `web/components/SearchStep.tsx`, `web/components/QueryTable.tsx`, `web/components/SerpResultsTable.tsx`, `web/components/RunNotices.tsx`
- Create: `e2e/tests/run-search.spec.ts`

**Interfaces:**
- Consumes: `api.getRun/serpRows/retryFailed/cancelJob/retryJob/deleteRun`, SSE `/api/runs/{id}/events`, `StatusBadge`, `Clip`, format helpers.
- Produces: `useRun(id) -> { run: RunDetail | null; error: string | null; refetch: () => Promise<void> }`, `applyEvent(prev, ev)`, `stepStates(run) -> {label, state}[]`, `Stepper({steps})`, `Elapsed({since, until?})`, `Pager({total, offset, limit, onChange})`. Test ids: `run-header`, `search-progress`, `query-row-<position>`, `serp-total`, `serp-row`.

- [ ] **Step 1: Write the failing E2E test**

`e2e/tests/run-search.spec.ts`:
```ts
import { expect, test } from "@playwright/test";
import { createRun, shot } from "./helpers";

test("search runs live, lists results, exports, retries and deletes", async ({ page }, info) => {
  const first = `mokobara luggage ${info.project.name}`;
  await createRun(page, [first, "mokobara review", "fail: broken query"]);
  await expect(page.getByRole("heading", { name: first, level: 1 })).toBeVisible();
  const headerBox = await page.getByTestId("run-header").boundingBox();
  const progressBox = await page.getByTestId("search-progress").boundingBox();

  const progress = page.getByTestId("search-progress");
  await expect(progress).toContainText("Search finished");
  await expect(progress).toContainText("3 of 3 queries");
  await expect(progress).toContainText("1 failed");
  await expect(page.getByTestId("query-row-2")).toContainText("Failed");
  await expect(page.getByTestId("serp-total")).toHaveText("5");
  await expect(page.getByTestId("serp-row")).toHaveCount(5);

  // no layout shift between the first render and the finished state
  expect((await page.getByTestId("run-header").boundingBox())?.height).toBe(headerBox?.height);
  expect((await page.getByTestId("search-progress").boundingBox())?.height).toBe(progressBox?.height);

  await page.getByLabel("Search results").fill("article-3");
  await expect(page.getByTestId("serp-total")).toHaveText("1");
  await page.getByLabel("Search results").fill("");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download SERP xlsx" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/_serp\.xlsx$/);
  await shot(page, "run-search", info);

  await page.getByRole("button", { name: "Retry failed queries" }).click();
  await expect(progress).toContainText("Search finished");
  await expect(page.getByTestId("query-row-2")).toContainText("Failed");

  await page.getByRole("button", { name: "Delete run" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL("http://localhost:3100/");
  await expect(page.getByRole("link", { name: first })).toHaveCount(0);
});
```

Run: `cd e2e && npx playwright test tests/run-search.spec.ts` - Expected: FAIL.

- [ ] **Step 2: Implement hooks and small components**

`web/lib/useRun.ts`:
```ts
"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "./api";
import type { RunDetail, RunEvent } from "./types";

export function applyEvent(prev: RunDetail | null, ev: RunEvent): RunDetail | null {
  if (ev.type === "snapshot") return ev.run;
  if (!prev) return prev;
  if (ev.type === "query") {
    const queries = prev.queries.map((q) =>
      q.id === ev.query_id ? { ...q, state: ev.state, found: ev.found, out_of_range: ev.out_of_range, attempts: ev.attempts, error: ev.error } : q,
    );
    return {
      ...prev,
      queries,
      counts: { queries: ev.total, done: ev.done, failed: ev.failed, pending: ev.total - ev.done - ev.failed, serp_rows: ev.rows },
    };
  }
  if (ev.type === "verify_progress") {
    return {
      ...prev,
      verify_jobs: prev.verify_jobs.map((v) =>
        v.id === ev.verify_job_id
          ? { ...v, status: v.status === "queued" ? "running" : v.status, done_urls: ev.done_urls, total_urls: ev.total_urls, status_counts: ev.status_counts }
          : v,
      ),
    };
  }
  return prev;
}

export function useRun(id: string) {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      setRun(await api.getRun(id));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id]);

  useEffect(() => {
    const es = new EventSource(`/api/runs/${id}/events`);
    es.onmessage = (m) => {
      const ev = JSON.parse(m.data) as RunEvent;
      setRun((prev) => applyEvent(prev, ev));
      if (ev.type === "job" || ev.type === "resync") void refetch();
    };
    // EventSource reconnects by itself and the server sends a fresh snapshot; refetch covers a 404 or a long outage.
    es.onerror = () => void refetch();
    return () => es.close();
  }, [id, refetch]);

  return { run, error, refetch };
}
```

`web/lib/steps.ts`:
```ts
import type { StepState } from "@/components/Stepper";
import type { RunDetail } from "./types";

export function searchDone(run: RunDetail): boolean {
  return run.active_job?.kind !== "scrape" && run.counts.pending === 0;
}

export function stepStates(run: RunDetail): { label: string; state: StepState }[] {
  const verifyActive = run.active_job?.kind === "verify";
  const verifyDone = run.verify_jobs.some((v) => v.status === "done") && !verifyActive;
  return [
    { label: "Search", state: searchDone(run) ? "done" : "current" },
    { label: "Verify", state: !searchDone(run) ? "locked" : verifyDone ? "done" : "current" },
    { label: "Done", state: verifyDone ? "current" : "locked" },
  ];
}
```

`web/components/Stepper.tsx`:
```tsx
import { cn } from "@/lib/utils";

export type StepState = "done" | "current" | "locked";

export function Stepper({ steps }: { steps: { label: string; state: StepState }[] }) {
  return (
    <ol className="flex items-center gap-3" aria-label="Run progress">
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-center gap-3" aria-current={s.state === "current" ? "step" : undefined}>
          <span
            className={cn(
              "flex size-7 items-center justify-center rounded-full text-xs font-semibold",
              s.state === "done" && "bg-brand-navy text-white",
              s.state === "current" && "bg-brand-red text-white",
              s.state === "locked" && "bg-neutral-100 text-neutral-400",
            )}
          >
            {s.state === "done" ? "✓" : i + 1}
          </span>
          <span className={cn("text-sm", s.state === "locked" ? "text-neutral-400" : "text-neutral-900", s.state === "current" && "font-semibold")}>
            {s.label}
          </span>
          {i < steps.length - 1 && <span aria-hidden className="h-px w-12 bg-neutral-200" />}
        </li>
      ))}
    </ol>
  );
}
```

`web/components/Elapsed.tsx`:
```tsx
"use client";

import { useEffect, useState } from "react";
import { fmtElapsed } from "@/lib/format";

export function Elapsed({ since, until }: { since: string; until?: string | null }) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (until) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  const end = until ? new Date(until).getTime() : nowMs;
  return <span className="tabular-nums">{fmtElapsed(end - new Date(since).getTime())}</span>;
}
```

`web/components/Pager.tsx`:
```tsx
import { Button } from "@/components/ui/button";
import { fmt } from "@/lib/format";

export function Pager({ total, offset, limit, onChange }: { total: number; offset: number; limit: number; onChange: (offset: number) => void }) {
  const from = total ? offset + 1 : 0;
  const to = Math.min(offset + limit, total);
  return (
    <div className="flex items-center justify-between text-sm tabular-nums">
      <span className="text-neutral-600">
        {fmt(from)}-{fmt(to)} of {fmt(total)}
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>Previous</Button>
        <Button variant="outline" size="sm" disabled={to >= total} onClick={() => onChange(offset + limit)}>Next</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Implement header, notices, tables and the search step**

`web/components/RunHeader.tsx`:
```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { RunDetail } from "@/lib/types";

export function RunHeader({ run }: { run: RunDetail }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    try {
      await api.deleteRun(run.id);
      router.push("/");
    } catch (e) {
      setError(errorMessage(e));
      setOpen(false);
    }
  }

  return (
    <div data-testid="run-header" className="flex items-start justify-between gap-6">
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <h1 className="truncate text-2xl" title={run.name}>{run.name}</h1>
          <StatusBadge status={run.status} />
        </div>
        <p className="mt-1 text-sm text-neutral-600">Created {fmtDateTime(run.created_at)}</p>
        <p className="mt-1 min-h-5 text-sm text-red-700">{error && <span role="alert">{error}</span>}</p>
      </div>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button variant="outline" disabled={!!run.active_job}>Delete run</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this run?</AlertDialogTitle>
            <AlertDialogDescription>Its queries, results, verifications and exported files are removed. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void remove();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```
Note: the `min-h-5` error line is always rendered so the header height never changes (the layout-shift assertion depends on it); the `alert` role exists only while there is an error.

`web/components/RunNotices.tsx`:
```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { RunDetail } from "@/lib/types";

export function RunNotices({ run, refetch }: { run: RunDetail; refetch: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const job = run.last_job;

  async function retry() {
    if (!job) return;
    setBusy(true);
    setError(null);
    try {
      if (job.kind === "scrape") await api.retryFailed(run.id);
      else await api.retryJob(job.id);
      await refetch();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {job?.resumed_at && (
        <p className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-900">
          Resumed after a restart at {fmtDateTime(job.resumed_at)}. Finished work was kept; only unfinished work ran again.
        </p>
      )}
      {run.status === "failed" && (
        <div role="alert" className="flex items-start justify-between gap-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm">
          <div>
            <p className="font-semibold text-red-900">{job?.kind === "verify" ? "Verification failed" : "Search failed"}</p>
            <p className="mt-1 text-red-800">{run.error}</p>
            {error && <p className="mt-1 text-red-800">{error}</p>}
          </div>
          <Button variant="outline" disabled={busy || !!run.active_job} onClick={retry}>Retry</Button>
        </div>
      )}
    </>
  );
}
```

`web/components/QueryTable.tsx`:
```tsx
import { Clip } from "@/components/Clip";
import { cn } from "@/lib/utils";
import type { QueryRow } from "@/lib/types";

const STATE: Record<QueryRow["state"], { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "text-neutral-500" },
  done: { label: "Done", cls: "text-green-700" },
  failed: { label: "Failed", cls: "text-red-700" },
};

export function QueryTable({ queries }: { queries: QueryRow[] }) {
  return (
    <div className="max-h-80 overflow-auto rounded-md border">
      <table className="w-full table-fixed text-sm">
        <colgroup>
          <col className="w-12" />
          <col />
          <col className="w-24" />
          <col className="w-20" />
          <col className="w-28" />
          <col className="w-24" />
          <col className="w-[30%]" />
        </colgroup>
        <thead className="sticky top-0 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
          <tr>
            <th className="px-3 py-2">#</th>
            <th className="px-3 py-2">Query</th>
            <th className="px-3 py-2">State</th>
            <th className="px-3 py-2 text-right">Found</th>
            <th className="px-3 py-2 text-right">Out of range</th>
            <th className="px-3 py-2 text-right">Attempts</th>
            <th className="px-3 py-2">Error</th>
          </tr>
        </thead>
        <tbody>
          {queries.map((q) => (
            <tr key={q.id} data-testid={`query-row-${q.position}`} className="border-t">
              <td className="px-3 py-2 tabular-nums text-neutral-500">{q.position + 1}</td>
              <td className="px-3 py-2"><Clip text={q.text} className="font-mono text-xs" /></td>
              <td className={cn("px-3 py-2", STATE[q.state].cls)}>{STATE[q.state].label}</td>
              <td className="px-3 py-2 text-right tabular-nums">{q.found ?? ""}</td>
              <td className="px-3 py-2 text-right tabular-nums">{q.out_of_range ?? ""}</td>
              <td className="px-3 py-2 text-right tabular-nums">{q.attempts ?? ""}</td>
              <td className="px-3 py-2"><Clip text={q.error ?? ""} className="text-red-700" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

`web/components/SerpResultsTable.tsx`:
```tsx
"use client";

import { useEffect, useState } from "react";
import { Clip } from "@/components/Clip";
import { Pager } from "@/components/Pager";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api";
import { fmt } from "@/lib/format";
import type { Page, SerpRow } from "@/lib/types";

const LIMIT = 50;
const text = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export function SerpResultsTable({ runId, version }: { runId: string; version: number }) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<Page<SerpRow> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(input);
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [input]);

  useEffect(() => {
    let alive = true;
    api
      .serpRows(runId, { offset, limit: LIMIT, q: query })
      .then((p) => {
        if (alive) {
          setPage(p);
          setError(null);
        }
      })
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [runId, offset, query, version]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-base">
          Results <span data-testid="serp-total" className="tabular-nums text-neutral-500">{page ? fmt(page.total) : ""}</span>
        </h3>
        <Input aria-label="Search results" placeholder="Filter by any text" value={input} onChange={(e) => setInput(e.target.value)} className="max-w-xs" />
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[960px] table-fixed text-sm">
          <colgroup>
            <col className="w-[18%]" />
            <col className="w-16" />
            <col className="w-28" />
            <col className="w-40" />
            <col className="w-[28%]" />
            <col />
          </colgroup>
          <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-2">Query</th>
              <th className="px-3 py-2">Rank</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Domain</th>
              <th className="px-3 py-2">Title</th>
              <th className="px-3 py-2">Snippet</th>
            </tr>
          </thead>
          <tbody>
            {page?.rows.map((r, i) => (
              <tr key={offset + i} data-testid="serp-row" className="border-t">
                <td className="px-3 py-2"><Clip text={text(r.Query)} /></td>
                <td className="px-3 py-2 tabular-nums">{text(r.Rank)}</td>
                <td className="px-3 py-2"><Clip text={text(r.Published || r.Date)} /></td>
                <td className="px-3 py-2"><Clip text={text(r.Domain)} /></td>
                <td className="px-3 py-2">
                  <a href={text(r.Link)} target="_blank" rel="noreferrer" title={text(r.Title)} className="block truncate text-brand-blue hover:underline">
                    {text(r.Title) || text(r.Link)}
                  </a>
                </td>
                <td className="px-3 py-2"><Clip text={text(r.Snippet)} /></td>
              </tr>
            ))}
            {page && page.rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-neutral-500">No results match.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {page && <Pager total={page.total} offset={offset} limit={LIMIT} onChange={setOffset} />}
    </div>
  );
}
```

`web/components/SearchStep.tsx`:
```tsx
"use client";

import { useState } from "react";
import { Elapsed } from "@/components/Elapsed";
import { QueryTable } from "@/components/QueryTable";
import { SerpResultsTable } from "@/components/SerpResultsTable";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { api, errorMessage } from "@/lib/api";
import { PROVIDER_LABEL, VERTICAL_LABEL, fmt, period } from "@/lib/format";
import type { RunDetail } from "@/lib/types";

export function SearchStep({ run, refetch }: { run: RunDetail; refetch: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const active = run.active_job?.kind === "scrape" ? run.active_job : null;
  const c = run.counts;
  const finished = c.done + c.failed;
  const scrapeJob = active ?? (run.last_job?.kind === "scrape" ? run.last_job : null);

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await refetch();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const label = active
    ? active.state === "queued" ? "Waiting for another job to finish" : active.state === "cancelling" ? "Cancelling" : "Searching"
    : c.pending ? "Stopped with unfinished queries" : "Search finished";

  return (
    <section aria-labelledby="search-heading" className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 id="search-heading" className="text-xl">1. Search</h2>
        <div className="flex gap-2">
          {active && (
            <Button variant="outline" disabled={active.state !== "running"} onClick={() => act(() => api.cancelJob(active.id))}>Cancel</Button>
          )}
          {!run.active_job && (c.failed > 0 || c.pending > 0) && (
            <Button variant="outline" onClick={() => act(() => api.retryFailed(run.id))}>Retry failed queries</Button>
          )}
          {!active && c.serp_rows > 0 && (
            <Button asChild variant="outline">
              <a href={`/api/runs/${run.id}/serp.xlsx`} download>Download SERP xlsx</a>
            </Button>
          )}
        </div>
      </div>
      <p className="text-sm text-neutral-600">
        {PROVIDER_LABEL[run.provider]} · {VERTICAL_LABEL[run.vertical]} · {run.pages} pages per query · {period(run)} · up to {fmt(run.max_calls)} billable pages
      </p>
      <div data-testid="search-progress" className="space-y-3 rounded-md border p-4">
        <div className="flex items-baseline justify-between gap-4 text-sm tabular-nums">
          <span className="font-medium">{label}</span>
          <span>
            {fmt(finished)} of {fmt(c.queries)} queries · {fmt(c.serp_rows)} results{c.failed ? ` · ${fmt(c.failed)} failed` : ""}
          </span>
        </div>
        <Progress value={c.queries ? (finished / c.queries) * 100 : 0} />
        <p className="h-5 text-xs text-neutral-500">
          {scrapeJob?.started_at ? <>Elapsed <Elapsed since={scrapeJob.started_at} until={active ? null : scrapeJob.finished_at} /></> : ""}
        </p>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <QueryTable queries={run.queries} />
      {c.serp_rows > 0 && <SerpResultsTable runId={run.id} version={c.serp_rows} />}
    </section>
  );
}
```
(Add the shadcn progress component if Step 1 of Task 12 did not: `npx shadcn@latest add progress`.)

`web/app/runs/[id]/page.tsx`:
```tsx
"use client";

import { use } from "react";
import { RunHeader } from "@/components/RunHeader";
import { RunNotices } from "@/components/RunNotices";
import { SearchStep } from "@/components/SearchStep";
import { Stepper } from "@/components/Stepper";
import { stepStates } from "@/lib/steps";
import { useRun } from "@/lib/useRun";

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { run, error, refetch } = useRun(id);
  if (error && !run) return <p role="alert" className="text-sm text-red-700">{error}</p>;
  if (!run) return <p className="text-sm text-neutral-500">Loading run...</p>;
  return (
    <div className="space-y-8">
      <RunHeader run={run} />
      <Stepper steps={stepStates(run)} />
      <RunNotices run={run} refetch={refetch} />
      <SearchStep run={run} refetch={refetch} />
    </div>
  );
}
```

- [ ] **Step 4: Run E2E and lint**

Run: `cd e2e && npx playwright test tests/run-search.spec.ts && cd ../web && npm run lint && npx tsc --noEmit`
Expected: PASS on both projects. Review the screenshots at both widths: table columns aligned, no clipped buttons, stepper centred on its row.

- [ ] **Step 5: Commit**

```bash
git add web e2e
git commit -m "feat: run page with live search progress, results table and run actions"
```

---

### Task 15: Run page - verify and done steps

**Files:**
- Create: `web/components/BrandRules.tsx`, `web/components/StatusChips.tsx`, `web/components/VerifyResultsTable.tsx`, `web/components/VerifyStep.tsx`, `web/components/DoneStep.tsx`
- Modify: `web/app/runs/[id]/page.tsx`
- Create: `e2e/tests/run-verify.spec.ts`

**Interfaces:**
- Consumes: `api.brands/startVerify/verifyRows/cancelJob`, `searchDone(run)`, `Elapsed`, `Pager`, `Clip`, `STATUS_ORDER`.
- Produces: `BrandRules({rules})`, `StatusChips({counts, selected?, onSelect?})`, `VerifyResultsTable({runId, verifyJobId, status, onStatusChange})`. Test ids: `verify-progress`, `status-chips`, `chip-<Status>`, `verify-total`, `verify-row`, `snapshot-note`.

- [ ] **Step 1: Write the failing E2E test**

`e2e/tests/run-verify.spec.ts`:
```ts
import { expect, test } from "@playwright/test";
import { createRun, shot } from "./helpers";

test("verifies results with a chosen brand set and exports", async ({ page }, info) => {
  await createRun(page, [`mokobara luggage v-${info.project.name}`, "mokobara review"]);
  await expect(page.getByTestId("search-progress")).toContainText("Search finished");

  const start = page.getByRole("button", { name: "Start verification" });
  await expect(start).toBeDisabled();
  await page.getByLabel("Brand set").selectOption("mokobara");
  await expect(page.getByText("Mokobara|MOKOBARA|[#@]mokobara\\w*")).toBeVisible(); // the rules are shown before starting
  await start.click();

  const progress = page.getByTestId("verify-progress");
  await expect(progress).toContainText("Verification finished", { timeout: 60_000 });
  await expect(progress).toContainText("4 of 4 URLs");
  await expect(page.getByTestId("snapshot-note")).toContainText('Brand set "mokobara"');
  await expect(page.getByTestId("chip-Verified")).toContainText("1");
  await expect(page.getByTestId("chip-Page unreachable")).toContainText("1");

  await expect(page.getByTestId("verify-total")).toHaveText("5");
  await page.getByTestId("chip-Verified").click();
  await expect(page.getByTestId("verify-total")).toHaveText("2");
  await page.getByLabel("Hide duplicates").check();
  await expect(page.getByTestId("verify-total")).toHaveText("1");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download verified xlsx" }).first().click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/_verified_\d+\.xlsx$/);
  await expect(page.getByRole("heading", { name: "3. Done" })).toBeVisible();
  await shot(page, "run-verified", info);
});
```

Run: `cd e2e && npx playwright test tests/run-verify.spec.ts` - Expected: FAIL.

- [ ] **Step 2: Implement BrandRules and StatusChips**

`web/components/BrandRules.tsx`:
```tsx
import type { BrandRule } from "@/lib/types";

export function BrandRules({ rules }: { rules: BrandRule[] }) {
  return (
    <ul className="space-y-2 text-sm">
      {rules.map((r, i) => (
        <li key={i} className="rounded-md border p-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-semibold">{r.name}</span>
            <code className="break-all text-xs text-neutral-700">{r.pattern}</code>
            {r.case_sensitive && <span className="text-xs text-neutral-500">case sensitive</span>}
          </div>
          {r.require_context.length > 0 && (
            <p className="mt-1 text-xs text-neutral-600">
              Counts only with one of these within {r.context_window} characters: <span className="break-all font-mono">{r.require_context.join(", ")}</span>
            </p>
          )}
          {r.exclude.length > 0 && (
            <p className="mt-1 text-xs text-neutral-600">
              Excludes: <span className="break-all font-mono">{r.exclude.join(", ")}</span>
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
```

`web/components/StatusChips.tsx`:
```tsx
import { STATUS_ORDER, fmt } from "@/lib/format";
import { cn } from "@/lib/utils";

export function StatusChips({ counts, selected, onSelect }: { counts: Record<string, number>; selected?: string; onSelect?: (status: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2" data-testid="status-chips">
      {STATUS_ORDER.map((s) => {
        const n = counts[s] ?? 0;
        const active = selected === s;
        const cls = cn(
          "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm",
          active ? "border-brand-navy bg-brand-navy text-white" : "border-neutral-300 bg-white text-neutral-800",
          n === 0 && !active && "text-neutral-400",
        );
        const inner = (
          <>
            <span>{s}</span>
            <span className="font-semibold tabular-nums">{fmt(n)}</span>
          </>
        );
        return onSelect ? (
          <button key={s} type="button" aria-pressed={active} className={cls} data-testid={`chip-${s}`} onClick={() => onSelect(active ? "" : s)}>
            {inner}
          </button>
        ) : (
          <span key={s} className={cls} data-testid={`chip-${s}`}>
            {inner}
          </span>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Implement the results table, verify step and done step**

`web/components/VerifyResultsTable.tsx`:
```tsx
"use client";

import { useEffect, useState } from "react";
import { Clip } from "@/components/Clip";
import { Pager } from "@/components/Pager";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api";
import { fmt } from "@/lib/format";
import type { Page, VerifyRow } from "@/lib/types";

const LIMIT = 50;
const text = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export function VerifyResultsTable({ runId, verifyJobId, status }: { runId: string; verifyJobId: number; status: string }) {
  const [hideDuplicates, setHideDuplicates] = useState(false);
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<Page<VerifyRow> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(input);
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [input]);

  useEffect(() => {
    let alive = true;
    api
      .verifyRows(runId, verifyJobId, { offset, limit: LIMIT, status, hide_duplicates: hideDuplicates, q: query })
      .then((p) => {
        if (alive) {
          setPage(p);
          setError(null);
        }
      })
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [runId, verifyJobId, offset, status, hideDuplicates, query]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h3 className="text-base">
          Verified rows <span data-testid="verify-total" className="tabular-nums text-neutral-500">{page ? fmt(page.total) : ""}</span>
        </h3>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-[#000c66]"
              checked={hideDuplicates}
              onChange={(e) => {
                setHideDuplicates(e.target.checked);
                setOffset(0);
              }}
            />
            Hide duplicates
          </label>
          <Input aria-label="Search verified rows" placeholder="Filter by any text" value={input} onChange={(e) => setInput(e.target.value)} className="w-64" />
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[960px] table-fixed text-sm">
          <colgroup>
            <col className="w-[28%]" />
            <col className="w-40" />
            <col />
            <col className="w-48" />
          </colgroup>
          <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-2">Link</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Hit sentence</th>
              <th className="px-3 py-2">Brands found</th>
            </tr>
          </thead>
          <tbody>
            {page?.rows.map((r) => (
              <tr key={r.seq} data-testid="verify-row" className={r.is_duplicate ? "border-t bg-red-50/40" : "border-t"}>
                <td className="px-3 py-2">
                  <a href={text(r.row.Link)} target="_blank" rel="noreferrer" title={text(r.row.Link)} className="block truncate text-brand-blue hover:underline">
                    {text(r.row.Link)}
                  </a>
                </td>
                <td className="px-3 py-2"><Clip text={text(r.status) + (r.is_duplicate ? " (duplicate)" : "")} /></td>
                <td className="px-3 py-2"><Clip text={text(r.row["Hit Sentence"])} /></td>
                <td className="px-3 py-2"><Clip text={text(r.row["Brands Found"])} /></td>
              </tr>
            ))}
            {page && page.rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-neutral-500">No rows match.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {page && <Pager total={page.total} offset={offset} limit={LIMIT} onChange={setOffset} />}
    </div>
  );
}
```

`web/components/VerifyStep.tsx`:
```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BrandRules } from "@/components/BrandRules";
import { Elapsed } from "@/components/Elapsed";
import { Field } from "@/components/Field";
import { NativeSelect } from "@/components/NativeSelect";
import { StatusChips } from "@/components/StatusChips";
import { VerifyResultsTable } from "@/components/VerifyResultsTable";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { api, errorMessage } from "@/lib/api";
import { fmt, fmtDateTime } from "@/lib/format";
import { searchDone } from "@/lib/steps";
import type { BrandSet, RunDetail, VerifyJob } from "@/lib/types";

export function VerifyStep({ run, refetch }: { run: RunDetail; refetch: () => Promise<void> }) {
  const [sets, setSets] = useState<BrandSet[] | null>(null);
  const [selected, setSelected] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.brands().then((r) => setSets(r.sets)).catch((e) => setError(errorMessage(e)));
  }, []);

  if (!searchDone(run)) {
    return (
      <section aria-labelledby="verify-heading" className="space-y-2">
        <h2 id="verify-heading" className="text-xl text-neutral-400">2. Verify</h2>
        <p className="text-sm text-neutral-500">Available once the search has finished.</p>
      </section>
    );
  }

  const selectedSet = sets?.find((s) => s.name === selected);
  const latest = run.verify_jobs[0];

  async function start() {
    setStarting(true);
    setError(null);
    try {
      await api.startVerify(run.id, selected);
      await refetch();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setStarting(false);
    }
  }

  return (
    <section aria-labelledby="verify-heading" className="space-y-6">
      <h2 id="verify-heading" className="text-xl">2. Verify</h2>
      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-3">
          <Field id="brand-set" label="Brand set" hint="Every URL is checked against exactly these rules. They are copied when verification starts.">
            <NativeSelect id="brand-set" value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">Choose a brand set</option>
              {sets?.map((s) => (
                <option key={s.name} value={s.name}>{s.name}</option>
              ))}
            </NativeSelect>
          </Field>
          <Link href="/brands" className="block text-sm text-brand-blue hover:underline">Edit brands</Link>
          <Button disabled={!selected || !!run.active_job || starting} onClick={start}>Start verification</Button>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        </div>
        <div>
          {selectedSet ? (
            <BrandRules rules={selectedSet.rules} />
          ) : (
            <p className="text-sm text-neutral-500">Pick a brand set to see exactly what will be matched.</p>
          )}
        </div>
      </div>
      {latest && <VerifyJobPanel run={run} job={latest} liveSets={sets} refetch={refetch} />}
      {run.verify_jobs.length > 1 && <EarlierVerifications run={run} jobs={run.verify_jobs.slice(1)} />}
    </section>
  );
}

function VerifyJobPanel({ run, job, liveSets, refetch }: { run: RunDetail; job: VerifyJob; liveSets: BrandSet[] | null; refetch: () => Promise<void> }) {
  const [status, setStatus] = useState("");
  const active = run.active_job?.kind === "verify" && run.active_job.ref_id === job.id ? run.active_job : null;
  const live = liveSets?.find((s) => s.name === job.brand_set);
  const changed = liveSets !== null && JSON.stringify(live?.rules ?? null) !== JSON.stringify(job.brand_rules);
  const label = active
    ? active.state === "queued" ? "Waiting for another job to finish" : active.state === "cancelling" ? "Cancelling" : "Verifying"
    : job.status === "done" ? "Verification finished" : job.status === "cancelled" ? "Verification cancelled" : job.status === "failed" ? "Verification failed" : "Queued";

  return (
    <div className="space-y-4 rounded-md border p-4">
      <div data-testid="snapshot-note" className="text-sm text-neutral-700">
        Brand set &quot;{job.brand_set}&quot;, rules copied when this verification started.
        {changed && <span className="ml-1 text-amber-800">The live set has changed or been deleted since; these results use the copy.</span>}
        <details className="mt-2">
          <summary className="cursor-pointer text-brand-blue">Show the rules used</summary>
          <div className="mt-2"><BrandRules rules={job.brand_rules} /></div>
        </details>
      </div>
      <div data-testid="verify-progress" className="space-y-3">
        <div className="flex items-baseline justify-between gap-4 text-sm tabular-nums">
          <span className="font-medium">{label}</span>
          <span>{fmt(job.done_urls)} of {job.total_urls === null ? "..." : fmt(job.total_urls)} URLs</span>
        </div>
        <Progress value={job.total_urls ? (job.done_urls / job.total_urls) * 100 : 0} />
        <div className="flex h-9 items-center justify-between text-xs text-neutral-500">
          <span>
            {job.started_at ? <>Elapsed <Elapsed since={job.started_at} until={active ? null : job.finished_at} /></> : ""}
            {job.finished_at && !active ? ` · finished ${fmtDateTime(job.finished_at)}` : ""}
          </span>
          {active && (
            <Button variant="outline" size="sm" disabled={active.state !== "running"} onClick={() => api.cancelJob(active.id).then(refetch)}>Cancel</Button>
          )}
        </div>
      </div>
      <StatusChips counts={job.status_counts} selected={job.status === "done" ? status : undefined} onSelect={job.status === "done" ? setStatus : undefined} />
      {job.status === "done" && (
        <>
          <div className="flex justify-end">
            <Button asChild variant="outline">
              <a href={`/api/runs/${run.id}/verify/${job.id}/verified.xlsx`} download>Download verified xlsx</a>
            </Button>
          </div>
          <VerifyResultsTable runId={run.id} verifyJobId={job.id} status={status} />
        </>
      )}
    </div>
  );
}

function EarlierVerifications({ run, jobs }: { run: RunDetail; jobs: VerifyJob[] }) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-brand-blue">Earlier verifications ({jobs.length})</summary>
      <ul className="mt-2 space-y-1">
        {jobs.map((j) => (
          <li key={j.id} className="flex items-center gap-3">
            <span className="w-40 truncate">{j.brand_set}</span>
            <span className="w-24">{j.status}</span>
            <span className="tabular-nums">{fmt(j.status_counts["Verified"] ?? 0)} verified</span>
            {j.has_output && (
              <a className="text-brand-blue hover:underline" href={`/api/runs/${run.id}/verify/${j.id}/verified.xlsx`} download>Download</a>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
```

`web/components/DoneStep.tsx`:
```tsx
import { Button } from "@/components/ui/button";
import { fmt } from "@/lib/format";
import type { RunDetail } from "@/lib/types";

export function DoneStep({ run }: { run: RunDetail }) {
  const done = run.active_job?.kind === "verify" ? undefined : run.verify_jobs.find((v) => v.status === "done");
  if (!done) return null;
  return (
    <section aria-labelledby="done-heading" className="space-y-4">
      <h2 id="done-heading" className="text-xl">3. Done</h2>
      <dl className="grid max-w-xl grid-cols-[1fr_auto] gap-y-2 text-sm tabular-nums">
        <dt>Queries</dt><dd className="text-right">{fmt(run.counts.queries)}</dd>
        <dt>Search results</dt><dd className="text-right">{fmt(run.counts.serp_rows)}</dd>
        <dt>Unique URLs verified</dt><dd className="text-right">{fmt(done.total_urls)}</dd>
        <dt className="font-semibold">Verified</dt><dd className="text-right font-semibold">{fmt(done.status_counts["Verified"] ?? 0)}</dd>
        <dt>Brand set</dt><dd className="text-right">{done.brand_set}</dd>
      </dl>
      <div className="flex gap-3">
        <Button asChild variant="outline"><a href={`/api/runs/${run.id}/serp.xlsx`} download>Download SERP xlsx</a></Button>
        <Button asChild variant="outline"><a href={`/api/runs/${run.id}/verify/${done.id}/verified.xlsx`} download>Download verified xlsx</a></Button>
      </div>
    </section>
  );
}
```

In `web/app/runs/[id]/page.tsx`, add the imports and render the new steps after `<SearchStep ... />`:
```tsx
import { DoneStep } from "@/components/DoneStep";
import { VerifyStep } from "@/components/VerifyStep";
```
```tsx
      <VerifyStep run={run} refetch={refetch} />
      <DoneStep run={run} />
```

- [ ] **Step 4: Run all E2E tests and lint**

Run: `cd e2e && npx playwright test && cd ../web && npm run lint && npx tsc --noEmit`
Expected: all specs PASS on both projects. `run-search.spec.ts` still passes (its "Download SERP xlsx" link is now also rendered in the Done step only after verification, so `.click()` there stays unambiguous). If the verifier classifies article-3 differently than "Weak mention", that is fine: the test only pins Verified and Page unreachable counts.

- [ ] **Step 5: Commit**

```bash
git add web e2e
git commit -m "feat: verify step with brand snapshot display, live status counts and verified rows"
```

---

### Task 16: Brand editor page

**Files:**
- Create: `web/app/brands/page.tsx`, `web/components/BrandEditor.tsx`, `web/lib/brandDraft.ts`
- Create: `e2e/tests/brands.spec.ts`

**Interfaces:**
- Consumes: `api.brands/saveBrand/deleteBrand/testBrand`.
- Produces: `DraftRule` type and `toDraft(rule) / fromDraft(draft) / emptyDraft()` in `lib/brandDraft.ts`. Inputs labelled `Set name`, `Rule N name`, `Rule N pattern`, `Rule N case sensitive`, `Rule N context window`, `Rule N context words`, `Rule N exclusions`, `Sample text`. Test ids: `try-hits`, `try-excluded`.

- [ ] **Step 1: Write the failing E2E test**

`e2e/tests/brands.spec.ts`:
```ts
import { expect, test } from "@playwright/test";
import { shot } from "./helpers";

test("create, try, validate, save and delete a brand set", async ({ page }, info) => {
  const name = `acme-${info.project.name}`;
  await page.goto("/brands");
  await expect(page.getByRole("heading", { name: "Brand sets", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "New set" }).click();
  await page.getByLabel("Set name").fill(name);
  await page.getByLabel("Rule 1 name").fill("Acme");
  await page.getByLabel("Rule 1 pattern").fill("Acme");
  await page.getByLabel("Rule 1 context window").fill("20");
  await page.getByLabel("Rule 1 context words").fill("luggage");
  await page.getByLabel("Rule 1 exclusions").fill("Acme Corp");

  await page.getByLabel("Sample text").fill(
    "Acme luggage is sturdy. Our friends at Acme Corp make anvils for cartoon coyotes everywhere. Then Acme rocks.",
  );
  await page.getByRole("button", { name: "Try rules" }).click();
  await expect(page.getByTestId("try-hits").getByRole("listitem")).toHaveCount(1);
  await expect(page.getByTestId("try-excluded")).toContainText("excluded by");
  await expect(page.getByTestId("try-excluded")).toContainText("no context word");

  await page.getByLabel("Rule 1 pattern").fill("Ac(me");
  await page.getByRole("button", { name: "Save set" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "rule 1 ('Acme')" })).toContainText("pattern");

  await page.getByLabel("Rule 1 pattern").fill("Acme");
  await page.getByRole("button", { name: "Save set" }).click();
  await expect(page.getByRole("status")).toContainText("Saved");
  await shot(page, "brands", info);

  await page.reload();
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.getByLabel("Rule 1 exclusions")).toHaveValue("Acme Corp");

  await page.getByRole("button", { name: "Delete set" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
});
```

Run: `cd e2e && npx playwright test tests/brands.spec.ts` - Expected: FAIL.

- [ ] **Step 2: Implement draft helpers**

`web/lib/brandDraft.ts`:
```ts
import type { BrandRule } from "./types";

export interface DraftRule {
  name: string;
  pattern: string;
  case_sensitive: boolean;
  context_window: string;
  require_context: string; // one per line
  exclude: string; // one per line
}

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

export const emptyDraft = (): DraftRule => ({ name: "", pattern: "", case_sensitive: false, context_window: "80", require_context: "", exclude: "" });

export function toDraft(r: BrandRule): DraftRule {
  return {
    name: r.name,
    pattern: r.pattern,
    case_sensitive: r.case_sensitive,
    context_window: String(r.context_window),
    require_context: r.require_context.join("\n"),
    exclude: r.exclude.join("\n"),
  };
}

export function fromDraft(d: DraftRule): BrandRule {
  const n = Number.parseInt(d.context_window, 10);
  return {
    name: d.name.trim(),
    pattern: d.pattern,
    case_sensitive: d.case_sensitive,
    context_window: Number.isFinite(n) ? n : 0, // 0 is rejected by the API with a message naming the rule
    require_context: lines(d.require_context),
    exclude: lines(d.exclude),
  };
}
```

- [ ] **Step 3: Implement the editor and page**

`web/components/BrandEditor.tsx`:
```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api";
import { type DraftRule, emptyDraft, fromDraft, toDraft } from "@/lib/brandDraft";
import type { BrandSet, TryResult } from "@/lib/types";
import { cn } from "@/lib/utils";

export function BrandEditor() {
  const [sets, setSets] = useState<BrandSet[]>([]);
  const [current, setCurrent] = useState<string | null>(null); // null = new set
  const [name, setName] = useState("");
  const [rules, setRules] = useState<DraftRule[]>([emptyDraft()]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [sample, setSample] = useState("");
  const [tried, setTried] = useState<TryResult | null>(null);
  const [tryError, setTryError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setSets((await api.brands()).sets);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function open(set: BrandSet | null) {
    setCurrent(set?.name ?? null);
    setName(set?.name ?? "");
    setRules(set ? set.rules.map(toDraft) : [emptyDraft()]);
    setError(null);
    setSaved(null);
    setTried(null);
  }

  const update = (i: number, patch: Partial<DraftRule>) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function save() {
    setError(null);
    setSaved(null);
    try {
      const res = await api.saveBrand(name.trim(), rules.map(fromDraft));
      await load();
      setCurrent(res.name);
      setSaved(`Saved. The previous config.yaml was backed up to ${res.backup.split("/").pop()}.`);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function remove() {
    if (!current) return;
    try {
      await api.deleteBrand(current);
      setDeleteOpen(false);
      await load();
      open(null);
    } catch (e) {
      setDeleteOpen(false);
      setError(errorMessage(e));
    }
  }

  async function tryRules() {
    setTryError(null);
    try {
      setTried(await api.testBrand({ text: sample, rules: rules.map(fromDraft) }));
    } catch (e) {
      setTried(null);
      setTryError(errorMessage(e));
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="space-y-2">
        <Button variant="outline" className="w-full" onClick={() => open(null)}>New set</Button>
        <ul className="space-y-1">
          {sets.map((s) => (
            <li key={s.name}>
              <button
                type="button"
                onClick={() => open(s)}
                className={cn("w-full truncate rounded-md px-3 py-2 text-left text-sm", current === s.name ? "bg-brand-navy text-white" : "hover:bg-neutral-100")}
              >
                {s.name}
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <section className="space-y-6">
        <div className="max-w-sm space-y-1.5">
          <Label htmlFor="set-name">Set name</Label>
          <Input id="set-name" value={name} disabled={current !== null} onChange={(e) => setName(e.target.value)} placeholder="lowercase, e.g. safari" />
        </div>
        <ol className="space-y-4">
          {rules.map((r, i) => (
            <li key={i} className="space-y-3 rounded-md border p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base">Rule {i + 1}</h3>
                {rules.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}>Remove rule</Button>
                )}
              </div>
              <div className="grid gap-3 md:grid-cols-[1fr_2fr]">
                <div className="space-y-1.5">
                  <Label>Name</Label>
                  <Input aria-label={`Rule ${i + 1} name`} value={r.name} onChange={(e) => update(i, { name: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Pattern (regular expression)</Label>
                  <Input aria-label={`Rule ${i + 1} pattern`} value={r.pattern} onChange={(e) => update(i, { pattern: e.target.value })} className="font-mono" />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-6">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" aria-label={`Rule ${i + 1} case sensitive`} className="size-4 accent-[#000c66]" checked={r.case_sensitive} onChange={(e) => update(i, { case_sensitive: e.target.checked })} />
                  Case sensitive
                </label>
                <label className="flex items-center gap-2 text-sm">
                  Context window
                  <Input aria-label={`Rule ${i + 1} context window`} type="number" min={1} value={r.context_window} onChange={(e) => update(i, { context_window: e.target.value })} className="w-24" />
                  characters
                </label>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Context words (one regex per line; a hit counts only if one is nearby)</Label>
                  <Textarea aria-label={`Rule ${i + 1} context words`} rows={3} value={r.require_context} onChange={(e) => update(i, { require_context: e.target.value })} className="font-mono text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label>Exclusions (one regex per line; matches inside these never count)</Label>
                  <Textarea aria-label={`Rule ${i + 1} exclusions`} rows={3} value={r.exclude} onChange={(e) => update(i, { exclude: e.target.value })} className="font-mono text-xs" />
                </div>
              </div>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={() => setRules((rs) => [...rs, emptyDraft()])}>Add rule</Button>
          <Button onClick={save} disabled={!name.trim()}>Save set</Button>
          {current && (
            <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
              <AlertDialogTrigger asChild>
                <Button variant="outline">Delete set</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete brand set &quot;{current}&quot;?</AlertDialogTitle>
                  <AlertDialogDescription>
                    It is removed from config.yaml (a backup is kept). Finished verifications keep the copy of the rules they used.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(e) => {
                      e.preventDefault();
                      void remove();
                    }}
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <p role="status" className="min-h-5 text-sm text-green-800">{saved ?? ""}</p>

        <div className="space-y-3 rounded-md border p-4">
          <h3 className="text-base">Try these rules</h3>
          <Label htmlFor="sample">Sample text</Label>
          <Textarea id="sample" rows={4} value={sample} onChange={(e) => setSample(e.target.value)} placeholder="Paste a sentence or paragraph from a real page." />
          <Button variant="outline" disabled={!sample.trim()} onClick={tryRules}>Try rules</Button>
          {tryError && <p role="alert" className="text-sm text-red-700">{tryError}</p>}
          {tried && (
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-sm font-semibold">Counted ({tried.hits.length})</p>
                <ul data-testid="try-hits" className="mt-1 space-y-1 text-sm">
                  {tried.hits.map((h) => (
                    <li key={`${h.brand}-${h.offset}`}><span className="font-medium">{h.brand}</span>: {h.snippet}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-sm font-semibold">Not counted ({tried.excluded.length})</p>
                <ul data-testid="try-excluded" className="mt-1 space-y-1 text-sm">
                  {tried.excluded.map((x) => (
                    <li key={`${x.brand}-${x.offset}`}>&quot;{x.text}&quot; - {x.reason}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
```

`web/app/brands/page.tsx`:
```tsx
import { BrandEditor } from "@/components/BrandEditor";

export default function BrandsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl">Brand sets</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Stored in url-verification&apos;s config.yaml, shared with the verify_urls.py command line. Each save keeps a backup.
        </p>
      </div>
      <BrandEditor />
    </div>
  );
}
```

- [ ] **Step 4: Run all E2E tests and lint**

Run: `cd e2e && npx playwright test && cd ../web && npm run lint && npx tsc --noEmit`
Expected: all PASS on both projects.

- [ ] **Step 5: Commit**

```bash
git add web e2e
git commit -m "feat: brand editor with try-out box, regex validation and backups"
```

---

### Task 17: Visual review, README, full gate and live smoke run

**Files:**
- Create: `README.md`
- Modify: any file with visual defects found in review

- [ ] **Step 1: Full gate**

Run: `make check`
Expected: lint, types, API tests, Company Monitor tests, url-verification tests and all Playwright specs pass with zero warnings. Run `make check` three more times; any test that fails once is flaky and must be fixed at its cause.

- [ ] **Step 2: Pixel review**

Open every screenshot in `e2e/test-results/` (runs list, new run, run search, run verified, brands) at 1280 and 1920. For each, check: aligned table columns and headers, no truncated button labels, consistent 24px page gutters, headings in Georgia navy, exactly one red primary button in view (dialog actions excepted), no horizontal page scroll, stepper items evenly spaced. Fix every defect, rerun the affected spec, and look again.

- [ ] **Step 3: README**

`README.md`:
````markdown
# RepScore Pipeline

One local web app for the SERP search -> URL verification workflow: paste queries, run them on SerpAPI or
DataForSEO, verify every result URL against a chosen brand set, download the verified xlsx.

## What it uses

- **Company Monitor** (`~/Desktop/Eminence/CompanyMonitor`): `bulk_search.py` for searching, and its `.env` for
  `SERPAPI_KEY`, `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`. Provider responses are cached for 30 days in its `.cache/`.
- **url-verification** (`~/Desktop/niks/url-verification`): the `urlverify` package, its `config.yaml` brand sets
  and its `cache/` of fetched pages. The command line `verify_urls.py` keeps working and shares both.

Override the locations with `COMPANY_MONITOR_DIR`, `URL_VERIFICATION_DIR`, `URL_VERIFICATION_CONFIG`,
`URL_VERIFICATION_CACHE`, `PIPELINE_DATA_DIR`.

## Setup

```bash
make install
cd ~/Desktop/niks/url-verification && uv run playwright install chromium
```

## Run

```bash
make dev     # API on 127.0.0.1:8000 with auto-reload, web on http://localhost:3000
make start   # same without auto-reload, production web build
```

Jobs keep running if you close the browser tab. If the API stops mid-job, the next start resumes it: finished
queries are not run again, provider responses already cached are free, and fetched pages are reused.

## Data

`data/app.db` (runs, queries, results, verifications), `data/exports/<run id>/` (xlsx files),
`data/logs/api.log` (JSON lines). Deleting a run in the UI removes its rows and files.

## Brand sets

The Brands page edits `config.yaml` in url-verification and writes `config.yaml.bak-<timestamp>` before every save.
A verification copies the chosen set's rules when it starts and uses only that copy, so editing a set never changes
a running or finished verification.

## Checks

```bash
make check   # ruff, pyright, pytest, eslint, tsc, both sibling test suites, Playwright
```
````

- [ ] **Step 4: Live smoke run (needs the user's go-ahead)**

This spends real credits: 2 queries x 1 page on SerpAPI (2 searches) and on DataForSEO (about $0.004 at Live rates). Ask the user for explicit permission first. With permission: `make start`, create one run per provider with two real brand queries and 1 page, confirm results appear, verify against a real brand set, and download both files. Check the run list shows both runs. Report what happened, including any provider error text.

- [ ] **Step 5: Commit and finish**

```bash
git add README.md web e2e api
git commit -m "docs: README; fix issues found in visual review"
```
Then use superpowers:finishing-a-development-branch for all three repos' feature branches (`feat/v1`, `feat/pipeline-search-one`, `feat/pipeline-hooks`).
