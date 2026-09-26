"use client";

import { useEffect, useState } from "react";
import { Clip } from "@/components/Clip";
import { Pager } from "@/components/Pager";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api";
import { fmt } from "@/lib/format";
import type { Page, SerpRow } from "@/lib/types";

const LIMIT = 50;
const text = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export function SerpResultsTable({ runId, version }: { runId: string; version: number }) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<Page<SerpRow> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(input);
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [input]);

  useEffect(() => {
    let alive = true;
    api
      .serpRows(runId, { offset, limit: LIMIT, q: query })
      .then((p) => {
        if (alive) {
          setPage(p);
          setError(null);
        }
      })
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [runId, offset, query, version]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-base">
          Results <span data-testid="serp-total" className="tabular-nums text-neutral-500">{page ? fmt(page.total) : ""}</span>
        </h3>
        <Input aria-label="Search results" placeholder="Filter by any text" value={input} onChange={(e) => setInput(e.target.value)} className="max-w-xs" />
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[960px] table-fixed text-sm">
          <colgroup>
            <col className="w-[18%]" />
            <col className="w-16" />
            <col className="w-28" />
            <col className="w-40" />
            <col className="w-[28%]" />
            <col />
          </colgroup>
          <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-2">Query</th>
              <th className="px-3 py-2">Rank</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Domain</th>
              <th className="px-3 py-2">Title</th>
              <th className="px-3 py-2">Snippet</th>
            </tr>
          </thead>
          <tbody>
            {page?.rows.map((r, i) => (
              <tr key={offset + i} data-testid="serp-row" className="border-t">
                <td className="px-3 py-2"><Clip text={text(r.Query)} /></td>
                <td className="px-3 py-2 tabular-nums">{text(r.Rank)}</td>
                <td className="px-3 py-2"><Clip text={text(r.Published || r.Date)} /></td>
                <td className="px-3 py-2"><Clip text={text(r.Domain)} /></td>
                <td className="px-3 py-2">
                  <a href={text(r.Link)} target="_blank" rel="noreferrer" title={text(r.Title)} className="block truncate text-brand-blue hover:underline">
                    {text(r.Title) || text(r.Link)}
                  </a>
                </td>
                <td className="px-3 py-2"><Clip text={text(r.Snippet)} /></td>
              </tr>
            ))}
            {page && page.rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-neutral-500">No results match.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {page && <Pager total={page.total} offset={offset} limit={LIMIT} onChange={setOffset} />}
    </div>
  );
}
