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

// This layout stays mounted across /runs/[id], /runs/[id]/search, /runs/[id]/verify and /runs/[id]/done: the
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

  // Remembers each step's own query string (filter, page, status chip, ...) for this run, so sliding away to
  // another step and back via the stepper or a Continue button restores it - never persisted beyond this
  // session, and never holds table data, only the small strings already sitting in the URL. Refs are only
  // written from an effect (never during render), per the "no ref access during render" rule.
  const stepQueryRef = useRef<Record<StepKey, string>>({ search: "", verify: "", done: "" });
  const currentStep = currentStepFromPath(pathname);
  const searchParamsString = searchParams.toString();
  useEffect(() => {
    if (currentStep) stepQueryRef.current[currentStep] = searchParamsString;
  }, [currentStep, searchParamsString]);
  const getStepQuery = useCallback((step: StepKey) => stepQueryRef.current[step], []);

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
