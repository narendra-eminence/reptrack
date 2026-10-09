"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { RunDetail } from "@/lib/types";

export function RunNotices({ run, refetch }: { run: RunDetail; refetch: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const job = run.last_job;

  async function retry() {
    if (!job) return;
    setBusy(true);
    setError(null);
    try {
      if (job.kind === "scrape") await api.retryFailed(run.id);
      else await api.retryJob(job.id);
      await refetch();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {job?.resumed_at && (
        <p className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-900">
          Resumed after a restart at {fmtDateTime(job.resumed_at)}. Finished work was kept; only unfinished work ran again.
        </p>
      )}
      {run.status === "failed" && (
        <div role="alert" className="flex items-start justify-between gap-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm">
          <div>
            <p className="font-semibold text-red-900">{job?.kind === "verify" ? "Verification failed" : job?.kind === "clean" ? "Cleaning failed" : "Search failed"}</p>
            <p className="mt-1 text-red-800">{run.error}</p>
            {error && <p className="mt-1 text-red-800">{error}</p>}
          </div>
          <Button variant="outline" disabled={busy || !!run.active_job} onClick={retry}>Retry</Button>
        </div>
      )}
    </>
  );
}
