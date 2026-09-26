"use client";

import { useState } from "react";
import { Elapsed } from "@/components/Elapsed";
import { QueryTable } from "@/components/QueryTable";
import { SerpResultsTable } from "@/components/SerpResultsTable";
import { Button, buttonVariants } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { api, errorMessage } from "@/lib/api";
import { PROVIDER_LABEL, VERTICAL_LABEL, fmt, period } from "@/lib/format";
import type { RunDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

export function SearchStep({ run, refetch }: { run: RunDetail; refetch: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const active = run.active_job?.kind === "scrape" ? run.active_job : null;
  const c = run.counts;
  const finished = c.done + c.failed;
  const scrapeJob = active ?? run.last_scrape_job;

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await refetch();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const label = active
    ? active.state === "queued" ? "Waiting for another job to finish" : active.state === "cancelling" ? "Cancelling" : "Searching"
    : c.pending ? "Stopped with unfinished queries" : "Search finished";

  return (
    <section aria-labelledby="search-heading" className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 id="search-heading" className="text-xl">1. Search</h2>
        <div className="flex gap-2">
          {active && (
            <Button variant="outline" disabled={active.state !== "running"} onClick={() => act(() => api.cancelJob(active.id))}>Cancel</Button>
          )}
          {!run.active_job && (c.failed > 0 || c.pending > 0) && (
            <Button variant="outline" onClick={() => act(() => api.retryFailed(run.id))}>Retry failed queries</Button>
          )}
          {!active && c.serp_rows > 0 && (
            <a href={`/api/runs/${run.id}/serp.xlsx`} download className={cn(buttonVariants({ variant: "outline" }))}>
              Download SERP xlsx
            </a>
          )}
        </div>
      </div>
      <p className="text-sm text-neutral-600">
        {PROVIDER_LABEL[run.provider]} · {VERTICAL_LABEL[run.vertical]} · {run.pages} {run.pages === 1 ? "page" : "pages"} per query · {period(run)} · up to {fmt(run.max_calls)} billable pages
      </p>
      <div
        data-testid="search-progress"
        data-scrape-job-id={scrapeJob?.id ?? ""}
        data-active={active ? "true" : "false"}
        className="space-y-3 rounded-md border p-4"
      >
        <div className="flex items-baseline justify-between gap-4 text-sm tabular-nums">
          <span className="font-medium">{label}</span>
          <span>
            {fmt(finished)} of {fmt(c.queries)} queries · {fmt(c.serp_rows)} results{c.failed ? ` · ${fmt(c.failed)} failed` : ""}
          </span>
        </div>
        <Progress value={c.queries ? (finished / c.queries) * 100 : 0} />
        <p className="h-5 text-xs text-neutral-500">
          {scrapeJob?.started_at ? <>Elapsed <Elapsed since={scrapeJob.started_at} until={active ? null : scrapeJob.finished_at} /></> : ""}
        </p>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <QueryTable queries={run.queries} />
      {c.serp_rows > 0 && <SerpResultsTable runId={run.id} version={c.serp_rows} />}
    </section>
  );
}
