import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { STEP_LABEL, type StepKey } from "@/lib/steps";
import { cn } from "@/lib/utils";

export function LockedPanel({ message, runId, fallbackStep }: { message: string; runId: string; fallbackStep: StepKey }) {
  return (
    <section data-testid="locked-step" className="space-y-4 rounded-md border border-dashed p-10 text-center">
      <p className="text-sm text-neutral-600">{message}</p>
      <Link href={`/runs/${runId}/${fallbackStep}`} className={cn(buttonVariants({ variant: "outline" }))}>
        Back to {STEP_LABEL[fallbackStep]}
      </Link>
    </section>
  );
}
