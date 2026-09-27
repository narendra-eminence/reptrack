"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const urlPage = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const offset = (urlPage - 1) * LIMIT;

  // The text box stays local for snappy typing; it is written to the URL (debounced) rather than being read
  // from it on every keystroke, but is kept in sync when the URL changes from outside (back/forward, reload).
  // Adjusted during render (React's pattern for state derived from a prop), not in an effect, so there is no
  // extra commit showing the stale value first - except while the box is focused, where a resync would clobber
  // a keystroke typed while an earlier value's debounced URL write is still catching up.
  const [isFocused, setIsFocused] = useState(false);
  const [input, setInput] = useState(query);
  const [prevQuery, setPrevQuery] = useState(query);
  if (prevQuery !== query) {
    setPrevQuery(query);
    if (!isFocused) setInput(query);
  }

  const [page, setPage] = useState<Page<SerpRow> | null>(null);
  const [error, setError] = useState<string | null>(null);

  function updateParams(next: { q?: string; page?: number }) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.q !== undefined) {
      if (next.q) params.set("q", next.q);
      else params.delete("q");
    }
    if (next.page !== undefined) {
      if (next.page > 1) params.set("page", String(next.page));
      else params.delete("page");
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  useEffect(() => {
    const t = setTimeout(() => {
      if (input !== query) updateParams({ q: input, page: 1 });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        <Input
          aria-label="Search results"
          placeholder="Filter by any text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => { setIsFocused(false); setInput(query); }}
          className="max-w-xs"
        />
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
      {page && <Pager total={page.total} offset={offset} limit={LIMIT} onChange={(o) => updateParams({ page: o / LIMIT + 1 })} />}
    </div>
  );
}
