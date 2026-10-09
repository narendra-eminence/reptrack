import { Clip } from "@/components/Clip";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { QueryRow } from "@/lib/types";

const STATE: Record<QueryRow["state"], { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "text-neutral-500" },
  running: { label: "Searching", cls: "text-blue-700" },
  done: { label: "Done", cls: "text-green-700" },
  failed: { label: "Failed", cls: "text-red-700" },
};

export function QueryTable({ queries }: { queries: QueryRow[] }) {
  return (
    <div className="max-h-80 overflow-auto rounded-md border">
      <table className="w-full table-fixed text-sm">
        <colgroup>
          <col className="w-12" />
          <col />
          <col className="w-24" />
          <col className="w-20" />
          <col className="w-32" />
          <col className="w-24" />
          <col className="w-28" />
          <col className="w-[28%]" />
        </colgroup>
        <thead className="sticky top-0 whitespace-nowrap bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
          <tr>
            <th className="px-3 py-2">#</th>
            <th className="px-3 py-2">Query</th>
            <th className="px-3 py-2">State</th>
            <th className="px-3 py-2 text-right">Found</th>
            <th className="px-3 py-2 text-right">Out of range</th>
            <th className="px-3 py-2 text-right">Attempts</th>
            <th className="px-3 py-2 text-right">Billed pages</th>
            <th className="px-3 py-2">Error</th>
          </tr>
        </thead>
        <tbody>
          {queries.map((q) => (
            <tr key={q.id} data-testid={`query-row-${q.position}`} className="border-t">
              <td className="px-3 py-2 tabular-nums text-neutral-500">{q.position + 1}</td>
              <td className="px-3 py-2"><Clip text={q.text} className="font-mono" /></td>
              <td className={cn("px-3 py-2", STATE[q.state].cls)}>{STATE[q.state].label}</td>
              <td className="px-3 py-2 text-right tabular-nums">{q.found ?? ""}</td>
              <td className="px-3 py-2 text-right tabular-nums">{q.out_of_range ?? ""}</td>
              <td className="px-3 py-2 text-right tabular-nums">{q.attempts ?? ""}</td>
              <td className="px-3 py-2 text-right tabular-nums">{q.calls === null ? "" : fmt(q.calls)}</td>
              <td className="px-3 py-2"><Clip text={q.error ?? ""} className="text-red-700" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
