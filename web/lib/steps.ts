import type { StepState } from "@/components/Stepper";
import type { RunDetail } from "./types";

export function searchDone(run: RunDetail): boolean {
  return run.active_job?.kind !== "scrape" && run.counts.pending === 0;
}

/** No scrape job is active and there is at least one result to verify - matches the API's own ruling that
 * verification is allowed on partial results after a cancelled search, not only once every query has finished. */
export function verifyAvailable(run: RunDetail): boolean {
  return run.active_job?.kind !== "scrape" && run.counts.serp_rows > 0;
}

export function stepStates(run: RunDetail): { label: string; state: StepState }[] {
  const verifyActive = run.active_job?.kind === "verify";
  const verifyDone = run.verify_jobs.some((v) => v.status === "done") && !verifyActive;
  return [
    { label: "Search", state: searchDone(run) ? "done" : "current" },
    { label: "Verify", state: !verifyAvailable(run) ? "locked" : verifyDone ? "done" : "current" },
    { label: "Done", state: verifyDone ? "current" : "locked" },
  ];
}
