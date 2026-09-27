"use client";

import Link from "next/link";
import type { MouseEvent } from "react";
import { stepHref, type StepKey } from "@/lib/steps";
import { useStepNavigation } from "@/lib/useStepNavigation";
import { cn } from "@/lib/utils";

export type StepState = "done" | "current" | "locked" | "available";

export function Stepper({
  steps,
  runId,
  getStepQuery,
}: {
  steps: { key: StepKey; label: string; state: StepState }[];
  runId: string;
  getStepQuery: (step: StepKey) => string;
}) {
  const navigate = useStepNavigation();
  return (
    <ol className="flex items-center gap-3" aria-label="Run progress">
      {steps.map((s, i) => {
        const href = stepHref(runId, s.key, getStepQuery(s.key));
        return (
          <li key={s.key} className="flex items-center gap-3">
            {s.state === "locked" ? (
              <span data-testid={`step-${s.key}`} aria-disabled="true" className="flex items-center gap-3">
                <StepBadge state={s.state} index={i} testId={`step-${s.key}-badge`} />
                <StepLabel label={s.label} current={false} muted testId={`step-${s.key}-label`} />
              </span>
            ) : (
              <Link
                href={href}
                data-testid={`step-${s.key}`}
                aria-current={s.state === "current" ? "step" : undefined}
                className="flex items-center gap-3"
                onClick={(e: MouseEvent<HTMLAnchorElement>) => {
                  // Let a modified or non-primary click behave like a normal link (open in a new tab, etc.)
                  // instead of hijacking it into our own animated navigation.
                  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                  e.preventDefault();
                  navigate(href);
                }}
              >
                <StepBadge state={s.state} index={i} testId={`step-${s.key}-badge`} />
                <StepLabel label={s.label} current={s.state === "current"} testId={`step-${s.key}-label`} />
              </Link>
            )}
            {i < steps.length - 1 && <span aria-hidden data-testid={`step-connector-${i}`} className="h-px w-12 bg-neutral-200" />}
          </li>
        );
      })}
    </ol>
  );
}

// The current step's label is font-semibold; a bold copy of the same text is a little wider than the regular
// weight, which shifted the whole stepper by ~2px as the current step moved. An invisible bold copy stacked in
// the same grid cell reserves that width on every step, so nothing shifts regardless of which one is current.
function StepLabel({ label, current, muted = false, testId }: { label: string; current: boolean; muted?: boolean; testId: string }) {
  return (
    <span className="grid" data-testid={testId}>
      {/* Reserves the current step's bold width (and only its width) so nothing shifts as it moves - must match
          the visible label's exact typography (text-sm), or it reserves the wrong box and misaligns both axes. */}
      <span aria-hidden className="invisible col-start-1 row-start-1 whitespace-nowrap text-sm font-semibold">{label}</span>
      <span
        className={cn(
          "col-start-1 row-start-1 whitespace-nowrap text-sm",
          muted ? "text-neutral-400" : "text-neutral-900",
          current && "font-semibold",
        )}
      >
        {label}
      </span>
    </span>
  );
}

function StepBadge({ state, index, testId }: { state: StepState; index: number; testId: string }) {
  return (
    <span
      data-testid={testId}
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
