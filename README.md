# RepScore Pipeline

One local web app for the SERP search -> URL verification -> cleaning workflow: paste queries, run them on SerpAPI or
DataForSEO, verify every result URL against a chosen brand set, then clean the verified rows into the RepScore
workbook (source buckets, exclusions, duplicates) and download it.

## What it uses

- **Company Monitor** (`~/Desktop/Eminence/CompanyMonitor`): `bulk_search.py` for searching, and its `.env` for
  `SERPAPI_KEY`, `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`. Provider responses are cached for 30 days in its `.cache/`.
- **url-verification** (`~/Desktop/niks/url-verification`): the `urlverify` package, its `config.yaml` brand sets
  and its `cache/` of fetched pages. The command line `verify_urls.py` keeps working and shares both.

- **Master media list** (`reference/RepScore_Master_Media_List.xlsx`): decides Major / Regional / Other Media. Drop in
  a newer copy of the file to update bucketing; it is re-read when it changes, no restart needed.

Override the locations with `COMPANY_MONITOR_DIR`, `URL_VERIFICATION_DIR`, `URL_VERIFICATION_CONFIG`,
`URL_VERIFICATION_CACHE`, `PIPELINE_DATA_DIR`, `MASTER_MEDIA_LIST`.

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

## Region

Each run is pinned to a search region, India (default) or United States, picked on the New run form. SerpAPI gets
`gl`/`hl` (`in`/`en` or `us`/`en`) and DataForSEO gets `location_name`/`language_code` (`India`/`en` or
`United States`/`en`); the list lives in Company Monitor's `bulk_search.REGIONS`. The region is stored on the run, so
a retry or a resume after restart searches the same market, and it is added to export file names (`..._US_serp.xlsx`).
The API's `region` field is optional: omitting it keeps the old behaviour (SerpAPI unpinned, DataForSEO India), and
runs created before regions existed show "Provider default". A SerpAPI region changes the request, so the first run of
a query in a region is not served from the cache of an earlier unpinned run.

## Clean

The Clean step turns a finished verification into the RepScore cleaning workbook, with scripted rules only; nothing
is tagged and no AI is involved. The rules are a port of the `repscore-data-processing` skill's `rules.py` and
`media_bucket.py` (in `api/pipeline_api/clean/`); keep the two in step when a rule changes.

In order, first match wins:

1. Same link twice (tracking and display-language parameters, `www.` and `http/https` ignored) -> the first is kept,
   the copies go to the bucket's duplicate sheet.
2. Export date outside the run's period -> `Out of Range`. Undated rows are kept and never given a guessed date.
3. The brand's own websites and accounts -> `Brand Communication`; a competitor's -> `Competitor Owned`, shown at the
   bottom of `Other Media` and kept out of `Clean Data`.
4. X, YouTube, Facebook, Instagram, Reddit, LinkedIn -> their own sheet; TikTok, Threads, Bluesky, Quora, Pinterest ->
   `Other Sources`. Profile pages (an account, not a post) and LinkedIn job listings -> `Low Quality`.
5. E-commerce, directories, review platforms, job boards, app stores, blogs, academic and institutional sites ->
   `Low Quality`; content-farm doorway pages -> `Spam`. Each row says why in `Exclusion Type`.
6. Everything else -> the master media list's Major / Regional / Other Media. Unknown domains go to Other Media and
   are listed on `NEW Domains` for the list's owner.
7. Title and snippet that the verification's own brand rules do not match -> `Low Quality`, `No brand mention`.
8. Same title or snippet in the same group (media, or one platform) -> the highest-tier copy is kept; Core-level
   Major Media is never removed this way.

Which verification is cleaned: the run's latest finished one, with that verification's copy of the brand rules. The
verifier's own status per row is carried as `Script Status` and does not move rows; `Verification Status` stays
`Pending`. Left for the reviewed phases: passing mentions, wrong entities the brand rules cannot tell apart,
publication names for NEW domains, tagging, sentiment and scoring.

**Cleaning details** are part of each brand set and live with it in url-verification's `config.yaml`, under
`cleaning:` keyed by set name: own websites, own social handles, competitor websites, competitor handles. On the
Brands page a form set shows them as a section of the form and saves them with `Save set`; a hand-written set, whose
rules stay read-only, shows them with their own Save. Every save keeps a `config.yaml` backup, and deleting a set
deletes its details. A pasted profile link is reduced to its handle, a website to its host. A form set without saved
details starts from its form's social handles. A cleaning copies the details when it starts, like verification copies
the brand rules. Verification never reads them.

The workbook (`<brand set>_RepScore_clean_<period>_<region>_<id>.xlsx`) holds, in order: Cleaning Summary, Clean
Data, the ten bucket sheets, Brand Communication, Low Quality, Spam, Unclassified, Verification Removed (empty until
a later phase fills it), Out of Range, the duplicate sheets that have rows, Source Bucket (the domain map), NEW
Domains, Query Yield, and Raw Data (the SERP export as scraped, plus each row's Cleaning Outcome).

## Data

`data/app.db` (runs, queries, results, verifications, cleanings), `data/exports/<run id>/` (xlsx
files),
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
