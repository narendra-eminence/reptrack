import { Card } from "@/components/ui/card";
import { fmt } from "@/lib/format";
import type { Plan, Provider } from "@/lib/types";

export function PlanPreview({ plan, error, loading, provider }: { plan: Plan | null; error: string | null; loading: boolean; provider: Provider }) {
  return (
    <Card className="gap-3 p-5">
      <h2 className="text-base">Before you run</h2>
      {error ? (
        <p role="alert" className="text-sm text-red-700">{error}</p>
      ) : !plan ? (
        <p className="text-sm text-neutral-500">Paste queries to see how many billable pages this search can use.</p>
      ) : (
        <>
          <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-sm tabular-nums">
            <dt>Queries</dt>
            <dd data-testid="plan-count" className="text-right">{plan.count}</dd>
            <dt>Pages per query</dt>
            <dd data-testid="plan-pages" className="text-right">{plan.pages}</dd>
            <dt className="font-semibold">Maximum billable SERP pages</dt>
            <dd data-testid="plan-max" className="text-right font-semibold">{fmt(plan.max_calls)}</dd>
            <dt>Already cached (free)</dt>
            <dd data-testid="plan-cached" className="text-right">{fmt(plan.cached_calls)}</dd>
          </dl>
          <p className="text-xs text-neutral-500">
            An upper bound: a query stops early when results run out.
            {provider === "dataforseo" && " DataForSEO fetches all of a query's pages in one request but bills each page."}
          </p>
          <details className="text-sm">
            <summary className="cursor-pointer text-brand-blue">Show parsed queries</summary>
            <ol data-testid="parsed-queries" className="mt-2 max-h-48 list-decimal space-y-1 overflow-auto pl-6 font-mono text-xs">
              {plan.queries.map((q, i) => (
                <li key={i} className="break-all">{q}</li>
              ))}
            </ol>
          </details>
        </>
      )}
      <p aria-live="polite" className="h-4 text-xs text-neutral-500">{loading ? "Updating..." : ""}</p>
    </Card>
  );
}
