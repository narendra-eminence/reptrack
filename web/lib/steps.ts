import type { StepState } from "@/components/Stepper";
import type { RunDetail } from "./types";

export type StepKey = "search" | "verify" | "done";

export const STEP_ORDER: StepKey[] = ["search", "verify", "done"];
export const STEP_LABEL: Record<StepKey, string> = { search: "Search", verify: "Verify", done: "Done" };

export function searchDone(run: RunDetail): boolean {
  return run.active_job?.kind !== "scrape" && run.counts.pending === 0;
}

/** Verify is viewable once there is at least one persisted SERP result - including partially completed or
 * cancelled searches, and while a scrape is still running (Start verification itself stays disabled while any
 * job is active; that is a separate rule from whether the step can be viewed at all). */
export function verifyAvailable(run: RunDetail): boolean {
  return run.counts.serp_rows > 0;
}

/** Done unlocks only once a verify job has actually finished. A failed or cancelled verification does not
 * unlock it, and it stays unlocked afterwards even while a later re-verify is running. */
export function doneAvailable(run: RunDetail): boolean {
  return run.verify_jobs.some((v) => v.status === "done");
}

/** Single source of truth for which step routes can be viewed, from persisted run state only - never from the
 * current URL. Used by the redirect, the stepper and the locked-panel fallback. */
export function stepAvailability(run: RunDetail): Record<StepKey, boolean> {
  return { search: true, verify: verifyAvailable(run), done: doneAvailable(run) };
}

/** Where `/runs/[id]` redirects to. */
export function landingStep(run: RunDetail): StepKey {
  if (doneAvailable(run)) return "done";
  if (verifyAvailable(run)) return "verify";
  return "search";
}

function verifyDone(run: RunDetail): boolean {
  return doneAvailable(run) && run.active_job?.kind !== "verify";
}

/** Whether a step is fully done (shown with a checkmark in the stepper), independent of availability/current. */
export function stepCompletion(run: RunDetail): Record<StepKey, boolean> {
  return { search: searchDone(run), verify: verifyDone(run), done: false };
}

export function stepStates(run: RunDetail, current: StepKey | null): { key: StepKey; label: string; state: StepState }[] {
  const avail = stepAvailability(run);
  const done = stepCompletion(run);
  return STEP_ORDER.map((key) => {
    let state: StepState;
    if (!avail[key]) state = "locked";
    else if (key === current) state = "current";
    else if (done[key]) state = "done";
    else state = "available";
    return { key, label: STEP_LABEL[key], state };
  });
}

export function stepHref(runId: string, step: StepKey, query = ""): string {
  return query ? `/runs/${runId}/${step}?${query}` : `/runs/${runId}/${step}`;
}

export function currentStepFromPath(pathname: string): StepKey | null {
  const m = pathname.match(/\/runs\/[^/]+\/(search|verify|done)(?:\/|\?|$)/);
  return (m?.[1] as StepKey | undefined) ?? null;
}
