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

The backend (`api/`) is FastAPI on Python 3.12 (pinned in `api/.python-version`, managed with `uv`). The
frontend (`web/`) is Next.js 16 with shadcn's `base-nova` style, built on Base UI (not Radix).

## Setup

```bash
make install
cd api && uv run playwright install chromium
```

The second command installs the exact Chromium headless-shell build the pinned Playwright version expects -
`make install` alone does not give `/api/health` a working browser, since it only installs the e2e harness's
own Playwright browsers, not the API's.

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

"New set" opens the brand configuration form: brand names and aliases, hashtags, social handles, whether the brand name
is a common word, words that confirm or exclude a mention, people associated with the brand, and test sentences. No regex
is involved. Sets made with the form show a "Form" badge and reopen in the form. Hand-written sets from before the form
are read-only (delete only) and keep working for verification. The form answers live under `profiles:` in
url-verification's `config.yaml`.

## Checks

```bash
make check   # ruff, pyright, pytest, eslint, tsc, both sibling test suites, Playwright
```

`make check` stops at the first failing target (lint, then test, then e2e), so a lint failure hides whatever
would have happened in test or e2e.

`make test` runs three suites: the API's own pytest, Company Monitor's `unittest` suite, and url-verification's
pytest. Company Monitor's `tests/test_rbp_tagging.py` has 2 known, out-of-scope failures
(`LoadKeywordsBundledFileTests.test_loads_more_than_250_unique_keywords` and
`ProcessWorkbookTests.test_defaults_to_get_keywords_when_none_passed`) caused by a data issue in that repo,
tracked separately - not caused by or fixed in this repo.

## E2E harness

`cd e2e && npx playwright test` starts three servers for the duration of the run: a fixture page server on
8200 (fake provider/brand pages the specs verify against), the API with a fixture backend on 8100, and the
Next dev server on 3100. Both browser projects (`desktop-1280`, `desktop-1920`) share one API and database for
the whole run, so specs must not assume an empty runs list, and any run name that must be unique includes
`info.project.name`. Screenshots land in `e2e/test-results/`.
