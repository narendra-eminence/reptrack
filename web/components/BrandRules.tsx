import type { BrandRule } from "@/lib/types";

export function BrandRules({ rules }: { rules: BrandRule[] }) {
  return (
    <ul className="space-y-2 text-sm">
      {rules.map((r, i) => (
        <li key={i} className="rounded-md border p-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-semibold">{r.name}</span>
            <code className="break-all text-xs text-neutral-700">{r.pattern}</code>
            {r.case_sensitive && <span className="text-xs text-neutral-500">case sensitive</span>}
          </div>
          {r.require_context.length > 0 && (
            <p className="mt-1 text-xs text-neutral-600">
              Counts only with one of these within {r.context_window} characters: <span className="break-all font-mono">{r.require_context.join(", ")}</span>
            </p>
          )}
          {r.exclude.length > 0 && (
            <p className="mt-1 text-xs text-neutral-600">
              Excludes: <span className="break-all font-mono">{r.exclude.join(", ")}</span>
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
