"use client";

import { use } from "react";
import { RunHeader } from "@/components/RunHeader";
import { RunNotices } from "@/components/RunNotices";
import { SearchStep } from "@/components/SearchStep";
import { Stepper } from "@/components/Stepper";
import { stepStates } from "@/lib/steps";
import { useRun } from "@/lib/useRun";

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { run, error, refetch } = useRun(id);
  if (error && !run) return <p role="alert" className="text-sm text-red-700">{error}</p>;
  if (!run) return <p className="text-sm text-neutral-500">Loading run...</p>;
  return (
    <div className="space-y-8">
      <RunHeader run={run} />
      <Stepper steps={stepStates(run)} />
      <RunNotices run={run} refetch={refetch} />
      <SearchStep run={run} refetch={refetch} />
    </div>
  );
}
