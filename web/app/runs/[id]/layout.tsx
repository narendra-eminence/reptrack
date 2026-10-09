"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { use, useCallback, useEffect, useRef, type ReactNode } from "react";
import { RunHeader } from "@/components/RunHeader";
import { RunNotices } from "@/components/RunNotices";
import { Stepper } from "@/components/Stepper";
import { RunProvider } from "@/lib/RunContext";
import { settleRoute } from "@/lib/routeTransition";
import { currentStepFromPath, stepStates, type StepKey } from "@/lib/steps";
import { useRun } from "@/lib/useRun";

// This layout stays mounted across /runs/[id] and every step route (search, verify, clean, done): the
// SSE connection and the run fetch live here so switching steps never reconnects or refetches.
export default function RunLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { run, error, refetch } = useRun(id);
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Resolves the pending view-transition promise once the new step has actually rendered (see routeTransition.ts).
  useEffect(() => {
    settleRoute();
  }, [pathname]);

  // Remembers each OTHER step's own query string (filter, page, status chip, ...) for this run, so sliding away
  // to it and back via the stepper or a Continue button restores it - never persisted beyond this session, and
  // never holds table data, only the small strings already sitting in the URL. Refs are only written from an
  // effect (never during render), per the "no ref access during render" rule.
  const stepQueryRef = useRef<Record<StepKey, string>>({ search: "", verify: "", clean: "", done: "" });
  const currentStep = currentStepFromPath(pathname);
  const searchParamsString = searchParams.toString();
  useEffect(() => {
    if (currentStep) stepQueryRef.current[currentStep] = searchParamsString;
  }, [currentStep, searchParamsString]);
  // The current step's own query must come straight from the live URL, not the ref: the ref is only updated by
  // the effect above *after* this render commits, so reading it during render for the step you're already on is
  // one render stale - e.g. right after a fresh /search?q=x load, clicking Search's own stepper link would push
  // the bare /search and silently drop the filter.
  const getStepQuery = useCallback(
    (step: StepKey) => (step === currentStep ? searchParamsString : stepQueryRef.current[step]),
    [currentStep, searchParamsString],
  );

  if (error && !run) return <p role="alert" className="text-sm text-red-700">{error}</p>;
  if (!run) return <p className="text-sm text-neutral-500">Loading run...</p>;

  return (
    <div className="space-y-8">
      <RunHeader run={run} />
      <Stepper steps={stepStates(run, currentStep)} runId={run.id} getStepQuery={getStepQuery} />
      <RunNotices run={run} refetch={refetch} />
      <div style={{ viewTransitionName: "step-panel" }}>
        <RunProvider value={{ run, refetch, getStepQuery }}>{children}</RunProvider>
      </div>
    </div>
  );
}
