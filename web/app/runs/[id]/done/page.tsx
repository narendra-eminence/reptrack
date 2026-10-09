"use client";

import { DoneStep } from "@/components/DoneStep";
import { LockedPanel } from "@/components/LockedPanel";
import { useRunContext } from "@/lib/RunContext";
import { landingStep, stepAvailability } from "@/lib/steps";

export default function DonePage() {
  const { run } = useRunContext();
  if (!stepAvailability(run).done) {
    return <LockedPanel message="Available once a cleaning has finished." runId={run.id} fallbackStep={landingStep(run)} />;
  }
  return <DoneStep run={run} />;
}
