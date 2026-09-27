"use client";

import { usePathname } from "next/navigation";
import { use, useEffect, type ReactNode } from "react";
import { RunHeader } from "@/components/RunHeader";
import { RunNotices } from "@/components/RunNotices";
import { Stepper } from "@/components/Stepper";
import { RunProvider } from "@/lib/RunContext";
import { settleRoute } from "@/lib/routeTransition";
import { currentStepFromPath, stepStates } from "@/lib/steps";
import { useRun } from "@/lib/useRun";

// This layout stays mounted across /runs/[id], /runs/[id]/search, /runs/[id]/verify and /runs/[id]/done: the
// SSE connection and the run fetch live here so switching steps never reconnects or refetches.
export default function RunLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { run, error, refetch } = useRun(id);
  const pathname = usePathname();

  // Resolves the pending view-transition promise once the new step has actually rendered (see routeTransition.ts).
  useEffect(() => {
    settleRoute();
  }, [pathname]);

  if (error && !run) return <p role="alert" className="text-sm text-red-700">{error}</p>;
  if (!run) return <p className="text-sm text-neutral-500">Loading run...</p>;

  const current = currentStepFromPath(pathname);

  return (
    <div className="space-y-8">
      <RunHeader run={run} />
      <Stepper steps={stepStates(run, current)} runId={run.id} />
      <RunNotices run={run} refetch={refetch} />
      <div style={{ viewTransitionName: "step-panel" }}>
        <RunProvider value={{ run, refetch }}>{children}</RunProvider>
      </div>
    </div>
  );
}
