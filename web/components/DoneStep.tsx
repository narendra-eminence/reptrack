import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { fmt } from "@/lib/format";
import { doneAvailable } from "@/lib/steps";
import { cn } from "@/lib/utils";
import type { RunDetail } from "@/lib/types";

export function DoneStep({ run }: { run: RunDetail }) {
  // stepAvailability(run).done (same rule as doneAvailable) guards this route, so a finished cleaning always exists.
  if (!doneAvailable(run)) return null;
  const cleaned = run.clean_jobs.find((c) => c.status === "done")!;
  const verified = run.verify_jobs.find((v) => v.id === cleaned.verify_job_id);
  const kind = run.active_job?.kind;
  if (kind === "verify" || kind === "clean") {
    const step = kind === "verify" ? "verify" : "clean";
    return (
      <section aria-labelledby="done-heading" className="space-y-4">
        <div className="flex min-h-8 items-center justify-between">
          <h2 id="done-heading" className="text-xl">4. Done</h2>
        </div>
        <p className="text-sm text-neutral-600">
          A new {kind === "verify" ? "verification" : "cleaning"} is running.{" "}
          <Link href={`/runs/${run.id}/${step}`} className="text-brand-blue hover:underline">View progress</Link>
        </p>
      </section>
    );
  }
  return (
    <section aria-labelledby="done-heading" className="space-y-4">
      <div className="flex min-h-8 items-center justify-between">
        <h2 id="done-heading" className="text-xl">4. Done</h2>
      </div>
      <dl className="grid max-w-xl grid-cols-[1fr_auto] gap-y-2 text-sm tabular-nums">
        <dt>Queries</dt><dd className="text-right">{fmt(run.counts.queries)}</dd>
        <dt>Search results</dt><dd className="text-right">{fmt(run.counts.serp_rows)}</dd>
        <dt>Unique URLs verified</dt><dd className="text-right">{fmt(verified?.total_urls)}</dd>
        <dt>Verified</dt><dd className="text-right">{fmt(verified?.status_counts["Verified"] ?? 0)}</dd>
        <dt className="font-semibold">Clean Data rows</dt><dd className="text-right font-semibold">{fmt(cleaned.summary.clean_data)}</dd>
        <dt>Brand set</dt><dd className="text-right">{cleaned.brand_set}</dd>
      </dl>
      <div className="flex flex-wrap gap-3">
        <a href={`/api/runs/${run.id}/serp.xlsx`} download className={cn(buttonVariants({ variant: "outline" }))}>Download SERP xlsx</a>
        <a href={`/api/runs/${run.id}/verify/${cleaned.verify_job_id}/verified.xlsx`} download className={cn(buttonVariants({ variant: "outline" }))}>Download verified xlsx</a>
        <a href={`/api/runs/${run.id}/clean/${cleaned.id}/cleaned.xlsx`} download className={cn(buttonVariants({ variant: "outline" }))}>Download cleaned xlsx</a>
      </div>
    </section>
  );
}
