import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { fmt } from "@/lib/format";
import { doneAvailable } from "@/lib/steps";
import { cn } from "@/lib/utils";
import type { RunDetail } from "@/lib/types";

export function DoneStep({ run }: { run: RunDetail }) {
  // stepAvailability(run).done (same rule as doneAvailable) guards this route, so a done job always exists here.
  if (!doneAvailable(run)) return null;
  const done = run.verify_jobs.find((v) => v.status === "done")!;
  const reverifying = run.active_job?.kind === "verify";
  if (reverifying) {
    return (
      <section aria-labelledby="done-heading" className="space-y-4">
        <div className="flex min-h-8 items-center justify-between">
          <h2 id="done-heading" className="text-xl">3. Done</h2>
        </div>
        <p className="text-sm text-neutral-600">
          A new verification is running.{" "}
          <Link href={`/runs/${run.id}/verify`} className="text-brand-blue hover:underline">View progress</Link>
        </p>
      </section>
    );
  }
  return (
    <section aria-labelledby="done-heading" className="space-y-4">
      <div className="flex min-h-8 items-center justify-between">
        <h2 id="done-heading" className="text-xl">3. Done</h2>
      </div>
      <dl className="grid max-w-xl grid-cols-[1fr_auto] gap-y-2 text-sm tabular-nums">
        <dt>Queries</dt><dd className="text-right">{fmt(run.counts.queries)}</dd>
        <dt>Search results</dt><dd className="text-right">{fmt(run.counts.serp_rows)}</dd>
        <dt>Unique URLs verified</dt><dd className="text-right">{fmt(done.total_urls)}</dd>
        <dt className="font-semibold">Verified</dt><dd className="text-right font-semibold">{fmt(done.status_counts["Verified"] ?? 0)}</dd>
        <dt>Brand set</dt><dd className="text-right">{done.brand_set}</dd>
      </dl>
      <div className="flex gap-3">
        <a href={`/api/runs/${run.id}/serp.xlsx`} download className={cn(buttonVariants({ variant: "outline" }))}>Download SERP xlsx</a>
        <a href={`/api/runs/${run.id}/verify/${done.id}/verified.xlsx`} download className={cn(buttonVariants({ variant: "outline" }))}>Download verified xlsx</a>
      </div>
    </section>
  );
}
