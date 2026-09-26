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
