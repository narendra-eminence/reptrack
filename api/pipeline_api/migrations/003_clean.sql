-- One cleaning of one finished verification. details_json is a copy of the brand set's cleaning details (kept with
-- the set in url-verification's config.yaml) taken when the cleaning is started, so editing them later never changes
-- a queued, running or finished cleaning.
CREATE TABLE clean_jobs (
  id INTEGER PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  verify_job_id INTEGER NOT NULL REFERENCES verify_jobs(id) ON DELETE CASCADE,
  brand_set TEXT NOT NULL,
  details_json TEXT NOT NULL,
  status TEXT NOT NULL,           -- queued | running | done | failed | cancelled
  summary_json TEXT NOT NULL DEFAULT '{}',
  output_path TEXT,
  error TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX clean_jobs_run ON clean_jobs(run_id, id);
