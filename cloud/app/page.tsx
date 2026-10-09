"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Clip } from "@/components/Clip";
import { StatusBadge } from "@/components/StatusBadge";
import { buttonVariants } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
import { fmt, fmtDateTime, period, regionLabel, verticalLabel } from "@/lib/format";
import type { RunListItem } from "@/lib/types";

export default function RunsPage() {
  const [runs, setRuns] = useState<RunListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listRuns().then(setRuns).catch((e) => setError(errorMessage(e)));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl">Runs</h1>
        <Link href="/runs/new" className={buttonVariants()}>New search</Link>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {!runs && !error && <p className="text-sm text-neutral-500">Loading...</p>}
      {runs && runs.length === 0 && (
        <p className="rounded-md border border-dashed p-8 text-center text-neutral-600">No searches yet. Start one with New search.</p>
      )}
      {runs && runs.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[1100px] table-fixed text-sm">
            <colgroup>
              <col />
              <col className="w-48" />
              <col className="w-40" />
              <col className="w-28" />
              <col className="w-20" />
              <col className="w-20" />
              <col className="w-48" />
              <col className="w-40" />
            </colgroup>
            <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Period</th>
                <th className="px-3 py-2">Search</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Queries</th>
                <th className="px-3 py-2 text-right">Results</th>
                <th className="px-3 py-2">Started by</th>
                <th className="px-3 py-2">Started</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} data-testid="run-row" className="border-t hover:bg-neutral-50">
                  <td className="px-3 py-2">
                    <Link href={`/runs/${r.id}`} className="block truncate text-brand-blue hover:underline" title={r.name}>{r.name}</Link>
                  </td>
                  <td className="px-3 py-2"><Clip text={period(r)} /></td>
                  <td className="px-3 py-2"><Clip text={`${verticalLabel(r.vertical)} · ${regionLabel(r.region)}`} /></td>
                  <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(r.query_count)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(r.row_count)}</td>
                  <td className="px-3 py-2"><Clip text={r.created_by_email} /></td>
                  <td className="px-3 py-2"><Clip text={fmtDateTime(r.created_at)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
