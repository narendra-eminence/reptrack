"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Clip } from "@/components/Clip";
import { Pager } from "@/components/Pager";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api";
import { fmt } from "@/lib/format";
import type { Page, VerifyRow } from "@/lib/types";

const LIMIT = 50;
const text = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export function VerifyResultsTable({
  runId,
  verifyJobId,
  status,
  actions,
}: {
  runId: string;
  verifyJobId: number;
  status: string;
  actions?: ReactNode;
}) {
  const [hideDuplicates, setHideDuplicates] = useState(false);
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<Page<VerifyRow> | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A different verify job or status filter is a different result set; page 2 of the old one would otherwise
  // show "No rows match" instead of the new set's first page. Reset during render (React's recommended pattern
  // for adjusting state when a prop changes), not in an effect, so there is no extra commit with stale rows.
  const [prevKey, setPrevKey] = useState({ verifyJobId, status });
  if (prevKey.verifyJobId !== verifyJobId || prevKey.status !== status) {
    setPrevKey({ verifyJobId, status });
    setOffset(0);
  }

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
      .verifyRows(runId, verifyJobId, { offset, limit: LIMIT, status, hide_duplicates: hideDuplicates, q: query })
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
  }, [runId, verifyJobId, offset, status, hideDuplicates, query]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h3 className="text-base">
          Verified rows <span data-testid="verify-total" className="tabular-nums text-neutral-500">{page ? fmt(page.total) : ""}</span>
        </h3>
        <div className="flex items-center gap-4">
          {actions}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-[#000c66]"
              checked={hideDuplicates}
              onChange={(e) => {
                setHideDuplicates(e.target.checked);
                setOffset(0);
              }}
            />
            Hide duplicates
          </label>
          <Input aria-label="Search verified rows" placeholder="Filter by any text" value={input} onChange={(e) => setInput(e.target.value)} className="w-64" />
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[960px] table-fixed text-sm">
          <colgroup>
            <col className="w-[28%]" />
            <col className="w-40" />
            <col />
            <col className="w-48" />
          </colgroup>
          <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-2 whitespace-nowrap">Link</th>
              <th className="px-3 py-2 whitespace-nowrap">Status</th>
              <th className="px-3 py-2 whitespace-nowrap">Hit sentence</th>
              <th className="px-3 py-2 whitespace-nowrap">Brands found</th>
            </tr>
          </thead>
          <tbody>
            {page?.rows.map((r) => (
              <tr key={r.seq} data-testid="verify-row" className={r.is_duplicate ? "border-t bg-red-50/40" : "border-t"}>
                <td className="px-3 py-2">
                  <a href={text(r.row.Link)} target="_blank" rel="noreferrer" title={text(r.row.Link)} className="block truncate text-brand-blue hover:underline">
                    {text(r.row.Link)}
                  </a>
                </td>
                <td className="px-3 py-2"><Clip text={text(r.status) + (r.is_duplicate ? " (duplicate)" : "")} /></td>
                <td className="px-3 py-2"><Clip text={text(r.row["Hit Sentence"])} /></td>
                <td className="px-3 py-2"><Clip text={text(r.row["Brands Found"])} /></td>
              </tr>
            ))}
            {page && page.rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-neutral-500">No rows match.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {page && <Pager total={page.total} offset={offset} limit={LIMIT} onChange={setOffset} />}
    </div>
  );
}
