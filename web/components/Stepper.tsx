"use client";

import Link from "next/link";
import type { StepKey } from "@/lib/steps";
import { useStepNavigation } from "@/lib/useStepNavigation";
import { cn } from "@/lib/utils";

export type StepState = "done" | "current" | "locked" | "available";

export function Stepper({ steps, runId }: { steps: { key: StepKey; label: string; state: StepState }[]; runId: string }) {
  const navigate = useStepNavigation();
  return (
    <ol className="flex items-center gap-3" aria-label="Run progress">
      {steps.map((s, i) => {
        const href = `/runs/${runId}/${s.key}`;
        return (
          <li key={s.key} className="flex items-center gap-3">
            {s.state === "locked" ? (
              <span data-testid={`step-${s.key}`} aria-disabled="true" className="flex items-center gap-3">
                <StepBadge state={s.state} index={i} />
                <span className="text-sm text-neutral-400">{s.label}</span>
              </span>
            ) : (
              <Link
                href={href}
                data-testid={`step-${s.key}`}
                aria-current={s.state === "current" ? "step" : undefined}
                className="flex items-center gap-3"
                onClick={(e) => {
                  e.preventDefault();
                  navigate(href);
                }}
              >
                <StepBadge state={s.state} index={i} />
                <span className={cn("text-sm text-neutral-900", s.state === "current" && "font-semibold")}>{s.label}</span>
              </Link>
            )}
            {i < steps.length - 1 && <span aria-hidden className="h-px w-12 bg-neutral-200" />}
          </li>
        );
      })}
    </ol>
  );
}

function StepBadge({ state, index }: { state: StepState; index: number }) {
  return (
    <span
      className={cn(
        "flex size-7 items-center justify-center rounded-full text-xs font-semibold",
        state === "done" && "bg-brand-navy text-white",
        state === "current" && "bg-brand-red text-white",
        state === "locked" && "bg-neutral-100 text-neutral-400",
        state === "available" && "border border-neutral-300 bg-white text-neutral-700",
      )}
    >
      {state === "done" ? "✓" : index + 1}
    </span>
  );
}
