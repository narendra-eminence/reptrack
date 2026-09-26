# RepScore Pipeline - Design (v1, simple workflow)

Status: approved in brainstorming, pending written-spec review
Date: 26 September 2026
Owner: Narendra

## 1. Purpose

One local web app that replaces running two tools by hand:

1. Company Monitor's **Bulk Search** page (paste queries, pick engine and options, get SERP results, export xlsx).
2. The **url-verification** CLI (take that xlsx, fetch every URL, score brand mentions, write the verified xlsx).

In the app: paste queries, choose engine and options, run the search, see results, pick a brand set, run verification, download the verified xlsx. No file handling between the two steps.

This deliberately narrows `~/Downloads/files 2/design.md` and `plan.md`. Brand profile intake, Claude prompt packs, paste-back query validation, staleness tracking and the handoff zip are out of scope for v1 (section 11). The one lesson from design.md that v1 keeps is its central one: **the brand used for verification is chosen explicitly per run, shown before the run starts, and recorded with the result**, so a sheet is never verified against a stale brand list (the 22 September 2026 Safari-verified-as-VIP failure).

## 2. Decisions taken

| Question | Decision |
|---|---|
| Scope | Simple workflow: scrape -> verify -> download. Plus run history and resume after crash. |
| Hosting | Local Mac, single user, no login. API bound to localhost only. |
| Brand selection | Dropdown of brand sets from url-verification `config.yaml`, plus an in-app brand editor that saves back to that file. |
| Code reuse | Import both existing repos in place as local Python path packages. One copy of the scrape and verify logic. Company Monitor and the verifier CLI keep working unchanged. |
| Architecture | Next.js frontend + one FastAPI backend with an in-process job runner and SQLite (approach A). |
| Not in v1 | Uploading an existing xlsx to verify; the verifier's four-sheet diagnostic report. |

## 3. What is reused

**Company Monitor** (`~/Desktop/Eminence/CompanyMonitor`)

- `bulk_search.parse_queries` for splitting pasted text into queries.
- `bulk_search.plan` for the cost preview (max calls, cached calls, key presence).
- `bulk_search.pages_for`, `max_pages_for`, `check_credentials`, `PROVIDERS`, `EXPORT_COLUMNS`.
- The per-query fetch path (`_run_one_query`), including its retries (3 attempts, 2s/4s backoff), per-domain throttling, and the 30-day disk cache in `net.py` (`CompanyMonitor/.cache`). Both SerpAPI (`monitor._serp_get`) and DataForSEO (`dataforseo_serp.fetch` via `net.polite_post`) go through that cache.
- Verticals: `web` (engine=google), `news` (engine=google_news, one call, no pagination), `news_tab` (google&tbm=nws). Page ceilings per provider as enforced today (SerpAPI 50, DataForSEO 20).
- Keys `SERPAPI_KEY`, `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`, read from `CompanyMonitor/.env`.

**url-verification** (`~/Desktop/niks/url-verification`)

- `urlverify.pipeline.run(input_path, output_path, cfg, brand, cache_dir, ...)` unchanged in behavior. Output xlsx is exactly what the CLI writes today (same columns, duplicate shading, `Duplicate Of Row`).
- `urlverify.config.load_config`, `resolve_brand`.
- Its `config.yaml` (brand sets, fetch settings) and `cache/` directory, so the CLI and the app share brand sets and fetched pages.
- Playwright Chromium as already installed for the verifier.

## 4. Changes to the existing repos

Each change is small, keeps existing behavior, and lands with tests in its own repo. Both existing test suites must pass afterwards.

**Company Monitor: `bulk_search.search_one`**

```python
def search_one(query, start, end, pages, vertical, provider=DEFAULT_PROVIDER,
               stop=None) -> tuple[list[dict], str | None, int]:
    """Run one query with the same retries, cache and throttling as run().
    Returns (rows, error, attempts). Rows use the store row shape that
    export_rows() flattens. Does NOT touch the bulk search store."""
```

A public wrapper over `_run_one_query`. `run()` is unchanged. This is needed because `run()` writes to the single global store (`.runs/bulk_search.json`) and its events carry counts, not rows, so the app cannot keep per-run rows through it. `export_rows` is reused to flatten rows into `EXPORT_COLUMNS`.

**url-verification: progress callback with status**

`pipeline.run` already takes `progress: Callable[[], None]`. Add a separate keyword `on_result: Callable[[str], None] | None = None`, called with the finished record's status after each unique URL. `progress` is unchanged, so the CLI keeps working. The app uses `on_result` for live per-status counts.

**url-verification: `urlverify/brands.py`**

- `list_sets(config_path) -> dict[str, list[BrandRule]]`
- `save_set(config_path, name, rules)` and `delete_set(config_path, name)`
- Uses ruamel.yaml round-trip mode so comments and ordering in `config.yaml` are preserved. Every pattern, `require_context` and `exclude` regex is compiled before writing; an invalid regex rejects the save with the rule and field named.
- Writes atomically (temp file + `os.replace`).
- `test_match(rules, text) -> list[Match]` for the editor's test box, built on the existing matcher so the test box and a real run agree.

## 5. Architecture

```
Browser
  |
Next.js (web/, App Router)  --- REST + SSE --->  FastAPI (api/, localhost:8000)
                                                   |-- SQLite (data/app.db, WAL)
                                                   |-- Job runner (asyncio, one job at a time)
                                                   |     |-- scrape: bulk_search.search_one on a thread pool
                                                   |     |-- verify: urlverify.pipeline.run
                                                   |-- data/exports/ (SERP and verified xlsx)
```

### 5.1 Repository layout

New repo `~/Desktop/niks/repscore-pipeline/`:

```
repscore-pipeline/
  web/                  Next.js, TypeScript, Tailwind, shadcn/ui
    app/                routes: /, /runs/[id], /brands
    components/
    lib/api.ts          typed client for the FastAPI endpoints
  api/                  Python 3.12, uv
    pyproject.toml      path deps on CompanyMonitor and url-verification
    app/
      main.py           FastAPI app, routes
      settings.py       paths to the two repos, their .env, config.yaml, cache dirs
      db.py             connection, WAL, numbered SQL migrations applied at startup
      jobs.py           runner, queue, cancel, resume on startup, event broadcaster
      scrape.py         scrape job using bulk_search
      verify.py         verify job using urlverify
      brands.py         thin routes over urlverify.brands
      export.py         SERP xlsx writer
    migrations/001_init.sql
    tests/
  e2e/                  Playwright tests driving the real UI
  data/                 app.db, exports (gitignored)
  docs/
  Makefile              `make check`: ruff, pyright, pytest, eslint, tsc, playwright
```

### 5.2 Configuration

`api/app/settings.py` reads paths from environment with defaults:

- `COMPANY_MONITOR_DIR` = `~/Desktop/Eminence/CompanyMonitor`
- `URL_VERIFICATION_DIR` = `~/Desktop/niks/url-verification`
- Keys loaded from `COMPANY_MONITOR_DIR/.env` at startup. Keys never reach the browser, never appear in logs or exports.
- Verifier config: `URL_VERIFICATION_DIR/config.yaml`; cache: `URL_VERIFICATION_DIR/cache`.

Startup fails loudly, naming the missing path or key, if either repo or config is absent. A missing provider key does not stop startup; it blocks that provider in the UI with a message.

### 5.3 Data model

```sql
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,              -- defaults to first query or "Run <date>"
  provider TEXT NOT NULL,          -- serpapi | dataforseo
  vertical TEXT NOT NULL,          -- web | news | news_tab
  pages INTEGER NOT NULL,
  start_date TEXT,                 -- ISO, inclusive
  end_date TEXT,
  status TEXT NOT NULL,            -- draft | scraping | scraped | verifying | verified | failed
  max_calls INTEGER,               -- ceiling quoted and confirmed
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE queries (
  id INTEGER PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  text TEXT NOT NULL,
  state TEXT NOT NULL,             -- pending | done | failed
  found INTEGER,
  out_of_range INTEGER,
  attempts INTEGER,
  error TEXT,
  UNIQUE (run_id, position)
);

CREATE TABLE serp_rows (
  id INTEGER PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  query_id INTEGER NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,            -- order within the query
  row_json TEXT NOT NULL           -- bulk_search store row, flattened by export_rows at export
);
CREATE INDEX serp_rows_run ON serp_rows(run_id, query_id, seq);

CREATE TABLE verify_jobs (
  id INTEGER PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  brand_set TEXT NOT NULL,
  brand_rules_json TEXT NOT NULL,  -- snapshot of the set's rules when the job started
  status TEXT NOT NULL,            -- queued | running | done | failed | cancelled
  total_urls INTEGER,
  done_urls INTEGER NOT NULL DEFAULT 0,
  status_counts_json TEXT NOT NULL DEFAULT '{}',
  output_path TEXT,
  error TEXT,
  started_at TEXT,
  finished_at TEXT
);

CREATE TABLE jobs (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,              -- scrape | verify
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  ref_id INTEGER,                  -- verify_jobs.id for verify
  state TEXT NOT NULL,             -- queued | running | cancelling | done | failed | cancelled
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
```

A query and its rows are written in one transaction when the query finishes, so a query is either fully stored with `state = done` or still `pending`.

### 5.4 HTTP API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Paths found, keys present per provider, Chromium available |
| GET | `/api/options` | Providers, verticals, page ceilings per provider |
| POST | `/api/plan` | Body: queries text, provider, vertical, pages, dates. Returns parsed query count, max_calls, cached calls, key status. Wraps `bulk_search.plan`. |
| GET | `/api/runs` | Run list with counts |
| POST | `/api/runs` | Create run and start scrape. Requires `confirmed_calls == max_calls`, mirroring the monitor's spend guard. |
| GET | `/api/runs/{id}` | Run detail, queries, verify jobs |
| GET | `/api/runs/{id}/rows` | SERP rows, paginated, with text search |
| GET | `/api/runs/{id}/serp.xlsx` | SERP export |
| POST | `/api/runs/{id}/retry-failed` | Re-queue failed queries |
| POST | `/api/runs/{id}/verify` | Body: brand_set. Starts verification. |
| GET | `/api/runs/{id}/verify/{job}/results` | Verified rows (URL, Status, Hit Sentence, Brands Found), paginated |
| GET | `/api/runs/{id}/verify/{job}/verified.xlsx` | Verified export |
| POST | `/api/jobs/{id}/cancel` | Cancel |
| DELETE | `/api/runs/{id}` | Delete run, its rows and export files |
| GET | `/api/runs/{id}/events` | SSE: snapshot from DB, then live events |
| GET | `/api/brands` | Brand sets with rules |
| PUT | `/api/brands/{name}` | Create or replace a set |
| DELETE | `/api/brands/{name}` | Delete a set |
| POST | `/api/brands/test` | Body: rules or set name, sample text. Returns matches and exclusions. |

Next.js calls the API through a rewrite (`/api/*` -> `http://127.0.0.1:8000/api/*`) so the browser talks to one origin.

## 6. Jobs

### 6.1 Runner

- Started in FastAPI's lifespan. One job runs at a time; others wait in `queued`. This keeps two jobs from competing for provider quota or Chromium.
- **Scrape job:** loads the run's `pending` queries, submits them to a thread pool of `bulk_search.MAX_WORKERS` (already bounded by `net.MAX_IN_FLIGHT["serpapi.com"]`), and calls `search_one` for each. As each query completes, its rows and `state` are committed in one transaction and an event is published. When all queries are `done` or `failed`, the run moves to `scraped`.
- **Verify job:** writes the run's SERP rows to a temporary xlsx in `EXPORT_COLUMNS` order (the verifier's input format today), resolves the brand set from `config.yaml` and snapshots its rules into `verify_jobs.brand_rules_json`, then awaits `urlverify.pipeline.run` with the shared cache dir and the `on_result` callback. Output goes to `data/exports/<run>/<name>_verified.xlsx`. Status counts come from `pipeline.run`'s return value; the run moves to `verified`.
- **Events:** an in-memory broadcaster per run. The SSE endpoint first sends a snapshot built from the database (run status, query states, verify progress), then streams live events. A reconnecting page therefore always shows correct state.
- **Cancel:** sets `cancelling`. Scrape: stops submitting queries, sets the `stop` event so queries in retry backoff stop, lets in-flight calls finish and stores them (they are paid for). Verify: cancels the pipeline task; the URL cache keeps what was fetched.

### 6.2 Resume after crash

On startup:

- Any `jobs` row in `running` or `cancelling` goes back to `queued` (cancelling ones are marked `cancelled`).
- A scrape job re-runs only the run's `pending` queries. Completed provider calls come from the 30-day cache in `CompanyMonitor/.cache` at no cost, for both SerpAPI and DataForSEO. Only a call that was in flight at the moment of the crash can be billed twice.
- A verify job re-runs `pipeline.run`. Its URL cache skips every URL already fetched successfully, so the restart costs only extraction and matching time.
- The run page shows "Resumed after restart" with the time.

### 6.3 Errors

- A query that still fails after the monitor's 3 attempts is stored `failed` with its error. The run still reaches `scraped`; the UI shows the failure count and a **Retry failed queries** button.
- Missing provider key: plan and start return an error naming the key and the `.env` file; the UI disables that provider.
- Missing or invalid brand set: start verification is blocked with the reason.
- An exception in a job marks the job `failed` and the run `failed` with the message; the UI shows it with a **Retry** button that resumes from stored state.
- Every error message says what failed and what to do next.
- Structured logs (JSON lines) to `data/logs/api.log`, with run and job IDs on every line. Keys are never logged.

## 7. UI

Tailwind + shadcn/ui with Eminence tokens: red `#D41829` (primary action, active step; hover `#B81422`), navy `#000C66` (headings), blue `#186AC9` (links). Headings Georgia, body Aptos/Calibri/Arial. One red primary button per screen.

**Runs list (`/`)**
- Table: name, date range, engine, vertical, status, SERP rows, verified count, last updated. Row opens the run.
- Red **New run** button.

**Run page (`/runs/[id]`, also used for a new run)**

Stepper with three steps: Search, Verify, Done. Completed steps stay visible, collapsed and read-only.

1. **Search**
   - Queries textarea (one per line, boolean allowed), live parsed count.
   - Options: engine, vertical, start and end date, pages per query (clamped to the engine's ceiling; news is fixed at one call).
   - Cost preview from `/api/plan`, debounced: max calls, already cached, key status.
   - **Run search** opens a confirm dialog with the ceiling. Confirming creates the run and starts the job.
   - Live: progress bar (queries done / total), elapsed, rows so far, a per-query table (query, found, out of range, attempts, error) updating in place.
   - After: results table (Query, Rank, Date, Domain, Title, Snippet, Link) with text search and pagination; **Download SERP xlsx**; **Retry failed queries** when relevant.
2. **Verify**
   - Brand set dropdown (required). The selected set's rules are listed next to it (name, pattern, context words, exclusions) so the brand is visible before starting. **Edit brands** link.
   - **Start verification**. Live: unique URLs done / total, a running count per status (Verified, Title only, Weak mention, Boilerplate only, Brand not found, Page unreachable, Unsupported platform), elapsed.
   - After: status chips, results table (Link, Status, Hit Sentence, Brands Found) with a status filter, **Download verified xlsx**. Can re-verify with a different brand set; each verify job is kept and listed.
3. **Done**
   - Summary counts and both downloads.

**Brand editor (`/brands`)**
- List of sets. Add, edit, delete.
- Rule fields: name, pattern (regex), case sensitive, context words (`require_context`), exclusions (`exclude`), context window.
- Test box: paste text, see which rules match, which hits were excluded and why.
- Save validates every regex and names the failing rule and field.

**UI quality bar**
- No layout shift as progress numbers update (tabular numerals, fixed-width counters).
- Table headers and column widths stay stable during live updates. Long titles and snippets truncate with a tooltip; wide tables scroll inside their container.
- Checked by screenshot at 1280px and 1920px widths.

## 8. Running locally

- `cd api && uv sync && uv run uvicorn app.main:app --port 8000`
- `cd web && npm install && npm run dev` (port 3000)
- `make dev` starts both; `make start` runs both without auto-reload.
- `README.md` covers setup, the two sibling repos it depends on, and where data and exports live.

## 9. Testing

- **API unit tests (pytest):** plan wrapper; run creation spend guard; scrape job with `search_one` stubbed from recorded responses (success, zero results, failure after retries); query-and-rows transaction; SSE snapshot content; cancel; verify job with `pipeline.run` against the local HTTP server fixture style the verifier already uses; export column order equals `bulk_search.EXPORT_COLUMNS`.
- **Resume test:** start a scrape against a stub that blocks mid-run, kill the runner, restart, confirm no query is executed twice and the final row count equals an uninterrupted run. Same for verify: restart re-uses cached URLs (zero fetches for already-fetched URLs).
- **Brand editor tests (url-verification repo):** save preserves comments and order in a copy of `config.yaml`; invalid regex rejected with rule and field named; `test_match` agrees with a real pipeline match on the same text.
- **`search_one` tests (Company Monitor repo):** same rows as `run()` for the same query using recorded responses; does not touch the store.
- **E2E (Playwright):** against the real Next.js UI and FastAPI with the provider boundary stubbed and verification pointed at a local HTTP server: new run, paste queries, confirm, watch progress, results table visible, SERP download opens, pick brand set, verify, status chips visible, verified download opens, run appears in the list. Assertions on rendered visibility, plus screenshots at each step at 1280px and 1920px.
- **Live smoke run:** 2 queries x 1 page on each provider, verified against a real brand set. Run manually, not in the automated suite.
- **Quality gate:** one `check` command runs ruff, pyright, pytest, eslint, tsc and Playwright with zero warnings. Both existing repos' suites (`CompanyMonitor/tests`, `url-verification/tests`) pass after the refactors. Any flaky test is fixed, not retried.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Importing `monitor.py` pulls in heavy or side-effecting imports | Check at build start; if import has side effects, isolate them behind the `search_one` module boundary. |
| Changes in Company Monitor or url-verification break the app | Path dependencies mean changes flow in immediately; the app's test suite exercises both boundaries (`search_one`, `pipeline.run`) and runs in `check`. |
| uvicorn `--reload` restarts during development interrupt jobs | Resume makes this a short catch-up; production-style start (`make start`) runs without reload. |
| Brand editor corrupts `config.yaml` | Round-trip YAML, validation before write, atomic replace, and a timestamped backup `config.yaml.bak-<ts>` before each save. |
| Large runs (tens of thousands of rows) slow the results table | Server-side pagination and search; rows stored per run with an index. |
| Verifier Chromium not installed | `/api/health` reports it and the Verify step shows the install command. |

## 11. Out of scope for v1

- Uploading an existing xlsx to verify without scraping.
- The verifier's four-sheet diagnostic report and flat monitoring sheet.
- Everything else in design.md: brand profile intake and document extraction, Claude prompt pack and paste-back validation, staleness tracking, balance checks and actual-spend reconciliation, handoff zip.
- Other Company Monitor features (GDELT, X, news RSS, Reviews, RBP, Analysis, Chrome extensions).
- Multi-user access, login, deployment beyond this Mac.
