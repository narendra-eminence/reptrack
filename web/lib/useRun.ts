"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "./api";
import type { RunDetail, RunEvent } from "./types";

export function applyEvent(prev: RunDetail | null, ev: RunEvent): RunDetail | null {
  if (ev.type === "snapshot") return ev.run;
  if (!prev) return prev;
  if (ev.type === "query") {
    const queries = prev.queries.map((q) =>
      q.id === ev.query_id ? { ...q, state: ev.state, found: ev.found, out_of_range: ev.out_of_range, attempts: ev.attempts, error: ev.error } : q,
    );
    return {
      ...prev,
      queries,
      counts: { queries: ev.total, done: ev.done, failed: ev.failed, pending: ev.total - ev.done - ev.failed, serp_rows: ev.rows },
    };
  }
  if (ev.type === "verify_progress") {
    return {
      ...prev,
      verify_jobs: prev.verify_jobs.map((v) =>
        v.id === ev.verify_job_id
          ? { ...v, status: v.status === "queued" ? "running" : v.status, done_urls: ev.done_urls, total_urls: ev.total_urls, status_counts: ev.status_counts }
          : v,
      ),
    };
  }
  return prev;
}

export function useRun(id: string) {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      setRun(await api.getRun(id));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id]);

  useEffect(() => {
    const es = new EventSource(`/api/runs/${id}/events`);
    es.onmessage = (m) => {
      const ev = JSON.parse(m.data) as RunEvent;
      setRun((prev) => applyEvent(prev, ev));
      if (ev.type === "job" || ev.type === "resync") void refetch();
    };
    // EventSource reconnects by itself and the server sends a fresh snapshot; refetch covers a 404 or a long outage.
    es.onerror = () => void refetch();
    return () => es.close();
  }, [id, refetch]);

  return { run, error, refetch };
}
