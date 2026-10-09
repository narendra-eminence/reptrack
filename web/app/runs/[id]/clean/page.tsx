"use client";

import { CleanStep } from "@/components/CleanStep";
import { LockedPanel } from "@/components/LockedPanel";
import { useRunContext } from "@/lib/RunContext";
import { landingStep, stepAvailability } from "@/lib/steps";

export default function CleanPage() {
  const { run, refetch } = useRunContext();
  if (!stepAvailability(run).clean) {
    return <LockedPanel message="Available once a verification has finished." runId={run.id} fallbackStep={landingStep(run)} />;
  }
  return <CleanStep run={run} refetch={refetch} />;
}
