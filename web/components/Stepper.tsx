import { cn } from "@/lib/utils";

export type StepState = "done" | "current" | "locked";

export function Stepper({ steps }: { steps: { label: string; state: StepState }[] }) {
  return (
    <ol className="flex items-center gap-3" aria-label="Run progress">
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-center gap-3" aria-current={s.state === "current" ? "step" : undefined}>
          <span
            className={cn(
              "flex size-7 items-center justify-center rounded-full text-xs font-semibold",
              s.state === "done" && "bg-brand-navy text-white",
              s.state === "current" && "bg-brand-red text-white",
              s.state === "locked" && "bg-neutral-100 text-neutral-400",
            )}
          >
            {s.state === "done" ? "✓" : i + 1}
          </span>
          <span className={cn("text-sm", s.state === "locked" ? "text-neutral-400" : "text-neutral-900", s.state === "current" && "font-semibold")}>
            {s.label}
          </span>
          {i < steps.length - 1 && <span aria-hidden className="h-px w-12 bg-neutral-200" />}
        </li>
      ))}
    </ol>
  );
}
