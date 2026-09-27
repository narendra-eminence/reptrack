"use client";

import { LockedPanel } from "@/components/LockedPanel";
import { VerifyStep } from "@/components/VerifyStep";
import { useRunContext } from "@/lib/RunContext";
import { landingStep, stepAvailability } from "@/lib/steps";

export default function VerifyPage() {
  const { run, refetch } = useRunContext();
  if (!stepAvailability(run).verify) {
    return <LockedPanel message="Available once the search has results." runId={run.id} fallbackStep={landingStep(run)} />;
  }
  return <VerifyStep run={run} refetch={refetch} />;
}
