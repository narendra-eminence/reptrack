"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { QueryTable } from "@/components/QueryTable";
import { ResultsTable } from "@/components/ResultsTable";
import { StatusBadge } from "@/components/StatusBadge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { api, errorMessage } from "@/lib/api";
import { downloadSerpXlsx } from "@/lib/exportXlsx";
import { fmt, fmtDateTime, period, regionLabel, verticalLabel } from "@/lib/format";
import { useRunner } from "@/lib/useRunner";
import type { Me, RunDetail } from "@/lib/types";

/** Same window as the server's claim_next_query: a query claimed longer ago than this belongs to a dead step. */
const STALE_MS = 330_000;

function activeElsewhere(run: RunDetail): boolean {
  const now = new Date(run.now).getTime();
  return run.queries.some((q) => q.state === "running" && q.started_at !== null && now - new Date(q.started_at).getTime() < STALE_MS);
}

export function RunView({ runId, me }: { runId: string; me: Me }) {
  const router = useRouter();
  const [run, setRun] = useState<RunDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const loading = useRef(false);
  const again = useRef(false);

  // At most one load in flight; a request made while one is running is folded into a single follow-up load.
  const refresh = useCallback(async () => {
    if (loading.current) {
      again.current = true;
      return;
    }
    loading.current = true;
    try {
      do {
        again.current = false;
        setRun(await api.getRun(runId));
        setLoadError(null);
      } while (again.current);
    } catch (e) {
      setLoadError(errorMessage(e));
    } finally {
      loading.current = false;
    }
  }, [runId]);

  const runner = useRunner(runId, refresh);
  const autoStarted = useRef(false);

  useEffect(() => {
    let live = true;
    api
      .getRun(runId)
      .then((r) => live && setRun(r))
      .catch((e) => live && setLoadError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [runId]);

  // Another tab (yours or a colleague's) is searching this run when one of its queries was claimed recently.
  const othersDriving = !!run && !runner.driving && run.status === "running" && activeElsewhere(run);

  // Opening a run that still has work, and that no other tab is searching, picks it up in this tab.
  useEffect(() => {
    if (!run || autoStarted.current) return;
    autoStarted.current = true;
    if ((run.status === "pending" || run.status === "running") && run.pending_count + run.running_count > 0 && !activeElsewhere(run)) {
      void runner.start();
    }
  }, [run, runner]);

  // When the tab that was searching goes away (closed, reloaded, crashed) with queries left and the run not stopped,
  // this tab carries on. Two tabs searching at once is safe anyway: the server never hands out a query twice.
  const watched = useRef(false);
  useEffect(() => {
    if (othersDriving) {
      watched.current = true;
      return;
    }
    if (!watched.current || !run) return;
    watched.current = false;
    if (run.status === "running" && run.pending_count + run.running_count > 0 && !runner.driving) void runner.start();
  }, [othersDriving, run, runner]);

  // While another tab searches, show its progress here too.
  useEffect(() => {
    if (!othersDriving) return;
    const t = setInterval(() => void refresh(), 4000);
    return () => clearInterval(t);
  }, [othersDriving, refresh]);

  async function act(fn: () => Promise<unknown>, thenStart = false) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      await refresh();
      if (thenStart) void runner.start();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function exportXlsx() {
    if (!run) return;
    setActionError(null);
    setExporting("Preparing...");
    try {
      await downloadSerpXlsx(run, (done, total) => setExporting(`Preparing ${fmt(done)} of ${fmt(total)} rows...`));
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setExporting(null);
    }
  }

  if (loadError && !run) return <p role="alert" className="text-sm text-red-700">{loadError}</p>;
  if (!run) return <p className="text-sm text-neutral-500">Loading...</p>;

  const finished = run.done_count + run.failed_count;
  const left = run.pending_count + run.running_count;
  const label = runner.driving
    ? "Searching in this tab"
    : othersDriving
      ? "Searching in another tab or window"
      : run.status === "cancelled"
        ? "Stopped"
        : run.status === "done"
          ? run.failed_count ? "Finished with failed queries" : "Finished"
          : run.status === "running"
            ? "Paused"
            : "Waiting to start";
  const canDelete = me.role === "admin" || run.created_by === me.id;
  const hint = runner.driving
    ? "Keep this tab open while it searches. Closing it pauses the search; every finished query is already saved."
    : othersDriving
      ? "Progress updates every few seconds."
      : run.status === "cancelled" || (run.status !== "done" && left > 0)
        ? "Paused. Resume continues with the queries not yet searched; finished ones are kept."
        : "";

  return (
    <section aria-labelledby="run-heading" className="space-y-4">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 id="run-heading" className="truncate text-2xl" title={run.name}>{run.name}</h1>
            <StatusBadge status={run.status} />
          </div>
          <p className="mt-1 text-sm text-neutral-600">
            SerpAPI · {regionLabel(run.region)} · {verticalLabel(run.vertical)} · {run.pages} {run.pages === 1 ? "page" : "pages"} per query · {period(run)} · started by {run.created_by_email || "a deleted user"} on {fmtDateTime(run.created_at)}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          {runner.driving && (
            <Button variant="outline" disabled={busy} onClick={() => act(async () => { runner.stop(); await api.cancel(run.id); })}>Stop</Button>
          )}
          {!runner.driving && !othersDriving && run.status !== "done" && left > 0 && (
            <Button variant="outline" disabled={busy} onClick={() => act(() => api.resume(run.id, false), true)}>Resume</Button>
          )}
          {!runner.driving && !othersDriving && run.failed_count > 0 && (
            <Button variant="outline" disabled={busy} onClick={() => act(() => api.resume(run.id, true), true)}>Retry failed queries</Button>
          )}
          {run.row_count > 0 && (
            <Button variant="outline" disabled={!!exporting} onClick={exportXlsx}>{exporting ?? "Download SERP xlsx"}</Button>
          )}
          {canDelete && !runner.driving && (
            <Button variant="outline" disabled={busy} onClick={() => setDeleteOpen(true)}>Delete run</Button>
          )}
        </div>
      </div>
      <div data-testid="search-progress" className="space-y-3 rounded-md border p-4">
        <div className="flex items-baseline justify-between gap-4 text-sm tabular-nums">
          <span className="font-medium">{label}</span>
          <span>
            {fmt(finished)} of {fmt(run.query_count)} queries · {fmt(run.row_count)} results · {fmt(run.calls_used)} billed pages of up to {fmt(run.max_calls)}
            {run.failed_count ? ` · ${fmt(run.failed_count)} failed` : ""}
          </span>
        </div>
        <Progress value={run.query_count ? (finished / run.query_count) * 100 : 0} />
        {hint && <p className="text-xs text-neutral-500">{hint}</p>}
      </div>
      {(runner.error || actionError) && <p role="alert" className="text-sm text-red-700">{runner.error ?? actionError}</p>}
      <QueryTable queries={run.queries} />
      <ResultsTable runId={run.id} version={run.row_count} />
      <AlertDialog open={deleteOpen} onOpenChange={(o) => { if (!busy) setDeleteOpen(o); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this run?</AlertDialogTitle>
            <AlertDialogDescription>Its queries and {fmt(run.row_count)} results are removed for everyone. Cached SerpAPI pages stay, so searching the same queries again within 30 days is free. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                setBusy(true);
                api.deleteRun(run.id).then(() => router.push("/")).catch((err) => { setActionError(errorMessage(err)); setBusy(false); setDeleteOpen(false); });
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
