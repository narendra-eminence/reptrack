import { buttonVariants } from "@/components/ui/button";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { RunDetail } from "@/lib/types";

export function DoneStep({ run }: { run: RunDetail }) {
  const done = run.active_job?.kind === "verify" ? undefined : run.verify_jobs.find((v) => v.status === "done");
  if (!done) return null;
  return (
    <section aria-labelledby="done-heading" className="space-y-4">
      <h2 id="done-heading" className="text-xl">3. Done</h2>
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
