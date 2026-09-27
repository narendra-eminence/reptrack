"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Clip } from "@/components/Clip";
import { Pager } from "@/components/Pager";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api";
import { fmt } from "@/lib/format";
import type { Page, VerifyRow } from "@/lib/types";
import { cn } from "@/lib/utils";

const LIMIT = 50;
const text = (v: unknown) => (v === null || v === undefined ? "" : String(v));

const EVIDENCE_LABEL: Record<string, string> = {
  page: "PAGE", browser: "BROWSER", proxy: "PROXY", embed: "EMBED", serp: "SERP",
};

/** Small neutral badge for Evidence Source; SERP is visually distinct (amber) but never red - that colour is
 * reserved for the screen's one primary action. Blank when the row has no evidence source. */
function EvidenceBadge({ value }: { value: string }) {
  const label = EVIDENCE_LABEL[value];
  if (!label) return null;
  return (
    <span
      data-testid="evidence-badge"
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        value === "serp" ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-neutral-100 text-neutral-700 ring-neutral-200",
      )}
    >
      {label}
    </span>
  );
}

export function VerifyResultsTable({
  runId,
  verifyJobId,
  status,
  hideDuplicates: hideDuplicatesFromUrl,
  onHideDuplicatesChange,
  actions,
}: {
  runId: string;
  verifyJobId: number;
  status: string;
  hideDuplicates: boolean;
  onHideDuplicatesChange: (v: boolean) => void;
  actions?: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const urlPage = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const offset = (urlPage - 1) * LIMIT;

  // Adjusted during render (React's pattern for state derived from a prop), not in an effect - see
  // SerpResultsTable for the same pattern, including the focus guard, with the same rationale.
  const [isFocused, setIsFocused] = useState(false);
  const [input, setInput] = useState(query);
  const [prevQuery, setPrevQuery] = useState(query);
  if (prevQuery !== query) {
    setPrevQuery(query);
    if (!isFocused) setInput(query);
  }

  // The checkbox flips immediately (local state) instead of waiting on the URL round trip through
  // next/navigation's router.replace, which runs as a transition and can lag a tick behind the click.
  const [hideDuplicates, setHideDuplicates] = useState(hideDuplicatesFromUrl);
  const [prevHideDuplicatesFromUrl, setPrevHideDuplicatesFromUrl] = useState(hideDuplicatesFromUrl);
  if (prevHideDuplicatesFromUrl !== hideDuplicatesFromUrl) {
    setPrevHideDuplicatesFromUrl(hideDuplicatesFromUrl);
    setHideDuplicates(hideDuplicatesFromUrl);
  }

  const [page, setPage] = useState<Page<VerifyRow> | null>(null);
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

  // The debounce timer id lives in a ref only so a blur can cancel and flush it immediately - read/written only
  // from effects and event handlers, never during render, per the "no ref access during render" rule.
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    debounceTimer.current = setTimeout(() => {
      if (input !== query) updateParams({ q: input, page: 1 });
    }, 300);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  // A keystroke typed just before leaving the box must not be lost: flush the pending write immediately instead
  // of cancelling it and snapping the box back to the last-committed URL value.
  function flushInput() {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (input !== query) updateParams({ q: input, page: 1 });
  }

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
                onHideDuplicatesChange(e.target.checked);
              }}
            />
            Hide duplicates
          </label>
          <Input
            aria-label="Search verified rows"
            placeholder="Filter by any text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => { setIsFocused(false); flushInput(); }}
            className="w-64"
          />
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[960px] table-fixed text-sm">
          <colgroup>
            <col className="w-[26%]" />
            <col className="w-40" />
            <col className="w-24" />
            <col />
            <col className="w-48" />
          </colgroup>
          <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-2 whitespace-nowrap">Link</th>
              <th className="px-3 py-2 whitespace-nowrap">Status</th>
              <th className="px-3 py-2 whitespace-nowrap">Evidence</th>
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
                <td className="px-3 py-2"><EvidenceBadge value={text(r.row["Evidence Source"])} /></td>
                <td className="px-3 py-2"><Clip text={text(r.row["Hit Sentence"])} /></td>
                <td className="px-3 py-2"><Clip text={text(r.row["Brands Found"])} /></td>
              </tr>
            ))}
            {page && page.rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-neutral-500">No rows match.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {page && <Pager total={page.total} offset={offset} limit={LIMIT} onChange={(o) => updateParams({ page: o / LIMIT + 1 })} />}
    </div>
  );
}
