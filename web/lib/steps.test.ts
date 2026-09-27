import { describe, expect, it } from "vitest";
import { doneAvailable, landingStep, stepAvailability, stepCompletion, verifyAvailable } from "./steps";
import type { RunDetail, VerifyJob } from "./types";

// Playwright's fixture backend can't easily produce a failed or cancelled verify job (it completes almost
// instantly), so the "a failed/cancelled verification does not unlock Done" rule is covered here instead of in
// e2e, per the brief's own fallback for pure functions that are hard to exercise end to end.

function makeRun(overrides: Partial<RunDetail> = {}): RunDetail {
  return {
    id: "abc123456789",
    name: "test run",
    provider: "serpapi",
    vertical: "web",
    pages: 1,
    start_date: null,
    end_date: null,
    status: "scraped",
    max_calls: 10,
    error: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    counts: { queries: 1, done: 1, failed: 0, pending: 0, serp_rows: 0 },
    queries: [],
    verify_jobs: [],
    active_job: null,
    last_job: null,
    last_scrape_job: null,
    ...overrides,
  };
}

function makeVerifyJob(overrides: Partial<VerifyJob> = {}): VerifyJob {
  return {
    id: 1,
    brand_set: "acme",
    brand_rules: [],
    status: "done",
    total_urls: 1,
    done_urls: 1,
    status_counts: {},
    error: null,
    started_at: null,
    finished_at: null,
    has_output: true,
    ...overrides,
  };
}

describe("verifyAvailable", () => {
  it("is false with no persisted SERP rows", () => {
    expect(verifyAvailable(makeRun({ counts: { queries: 1, done: 0, failed: 1, pending: 0, serp_rows: 0 } }))).toBe(false);
  });

  it("is true once there is at least one persisted row, even mid-scrape", () => {
    const run = makeRun({
      counts: { queries: 3, done: 1, failed: 0, pending: 2, serp_rows: 4 },
      active_job: { id: 1, kind: "scrape", run_id: "abc123456789", ref_id: null, state: "running", error: null, created_at: "", started_at: "", finished_at: null, resumed_at: null },
    });
    expect(verifyAvailable(run)).toBe(true);
  });
});

describe("doneAvailable", () => {
  it("is false when there are no verify jobs", () => {
    expect(doneAvailable(makeRun())).toBe(false);
  });

  it("is false when the only verify job failed", () => {
    expect(doneAvailable(makeRun({ verify_jobs: [makeVerifyJob({ status: "failed" })] }))).toBe(false);
  });

  it("is false when the only verify job was cancelled", () => {
    expect(doneAvailable(makeRun({ verify_jobs: [makeVerifyJob({ status: "cancelled" })] }))).toBe(false);
  });

  it("is true once any verify job has finished, even alongside a failed one", () => {
    const run = makeRun({ verify_jobs: [makeVerifyJob({ id: 2, status: "failed" }), makeVerifyJob({ id: 1, status: "done" })] });
    expect(doneAvailable(run)).toBe(true);
  });

  it("stays true while a later re-verify is running", () => {
    const run = makeRun({
      verify_jobs: [makeVerifyJob({ id: 2, status: "running" }), makeVerifyJob({ id: 1, status: "done" })],
      active_job: { id: 2, kind: "verify", run_id: "abc123456789", ref_id: 2, state: "running", error: null, created_at: "", started_at: "", finished_at: null, resumed_at: null },
    });
    expect(doneAvailable(run)).toBe(true);
  });
});

describe("stepAvailability", () => {
  it("locks verify and done for a fresh run with only failing queries (zero SERP rows)", () => {
    const run = makeRun({ counts: { queries: 1, done: 0, failed: 1, pending: 0, serp_rows: 0 } });
    expect(stepAvailability(run)).toEqual({ search: true, verify: false, done: false });
  });

  it("unlocks verify but not done once results exist with no finished verification", () => {
    const run = makeRun({ counts: { queries: 2, done: 2, failed: 0, pending: 0, serp_rows: 5 } });
    expect(stepAvailability(run)).toEqual({ search: true, verify: true, done: false });
  });

  it("does not unlock done for a failed verification", () => {
    const run = makeRun({
      counts: { queries: 2, done: 2, failed: 0, pending: 0, serp_rows: 5 },
      verify_jobs: [makeVerifyJob({ status: "failed" })],
    });
    expect(stepAvailability(run)).toEqual({ search: true, verify: true, done: false });
  });

  it("does not unlock done for a cancelled verification", () => {
    const run = makeRun({
      counts: { queries: 2, done: 2, failed: 0, pending: 0, serp_rows: 5 },
      verify_jobs: [makeVerifyJob({ status: "cancelled" })],
    });
    expect(stepAvailability(run)).toEqual({ search: true, verify: true, done: false });
  });

  it("unlocks all three once a verification has finished", () => {
    const run = makeRun({
      counts: { queries: 2, done: 2, failed: 0, pending: 0, serp_rows: 5 },
      verify_jobs: [makeVerifyJob({ status: "done" })],
    });
    expect(stepAvailability(run)).toEqual({ search: true, verify: true, done: true });
  });
});

describe("landingStep", () => {
  it("lands on search for a fresh run with only failing queries", () => {
    expect(landingStep(makeRun({ counts: { queries: 1, done: 0, failed: 1, pending: 0, serp_rows: 0 } }))).toBe("search");
  });

  it("lands on verify once results exist with no finished verification", () => {
    expect(landingStep(makeRun({ counts: { queries: 2, done: 2, failed: 0, pending: 0, serp_rows: 5 } }))).toBe("verify");
  });

  it("stays on verify when the only verify job failed", () => {
    const run = makeRun({
      counts: { queries: 2, done: 2, failed: 0, pending: 0, serp_rows: 5 },
      verify_jobs: [makeVerifyJob({ status: "failed" })],
    });
    expect(landingStep(run)).toBe("verify");
  });

  it("lands on done once a verification has finished", () => {
    const run = makeRun({
      counts: { queries: 2, done: 2, failed: 0, pending: 0, serp_rows: 5 },
      verify_jobs: [makeVerifyJob({ status: "done" })],
    });
    expect(landingStep(run)).toBe("done");
  });
});

describe("stepCompletion", () => {
  it("search is not done while a scrape is active", () => {
    const run = makeRun({
      counts: { queries: 2, done: 1, failed: 0, pending: 1, serp_rows: 3 },
      active_job: { id: 1, kind: "scrape", run_id: "abc123456789", ref_id: null, state: "running", error: null, created_at: "", started_at: "", finished_at: null, resumed_at: null },
    });
    expect(stepCompletion(run).search).toBe(false);
  });

  it("search is done once nothing is pending and no scrape is active", () => {
    const run = makeRun({ counts: { queries: 2, done: 2, failed: 0, pending: 0, serp_rows: 5 } });
    expect(stepCompletion(run).search).toBe(true);
  });

  it("verify is not done for a failed verification", () => {
    const run = makeRun({ verify_jobs: [makeVerifyJob({ status: "failed" })] });
    expect(stepCompletion(run).verify).toBe(false);
  });

  it("verify is done once a verification has finished and none is currently running", () => {
    const run = makeRun({ verify_jobs: [makeVerifyJob({ status: "done" })] });
    expect(stepCompletion(run).verify).toBe(true);
  });

  it("verify is not shown as done while a re-verify is in flight", () => {
    const run = makeRun({
      verify_jobs: [makeVerifyJob({ id: 2, status: "running" }), makeVerifyJob({ id: 1, status: "done" })],
      active_job: { id: 2, kind: "verify", run_id: "abc123456789", ref_id: 2, state: "running", error: null, created_at: "", started_at: "", finished_at: null, resumed_at: null },
    });
    expect(stepCompletion(run).verify).toBe(false);
  });
});
