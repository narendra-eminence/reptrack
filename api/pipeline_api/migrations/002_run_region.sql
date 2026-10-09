-- Search market a run is pinned to: a bulk_search.REGIONS key ("in", "us"). NULL is a run created before regions
-- existed; it keeps the legacy behaviour (SerpAPI unpinned, DataForSEO on its India default) so a retry or a
-- resume after restart searches exactly as the run started.
ALTER TABLE runs ADD COLUMN region TEXT;
