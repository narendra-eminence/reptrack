"use client";

import { Button } from "@/components/ui/button";
import { missingValues } from "@/lib/brandProfile";

export function SuggestChips({
  values, current, onAdd, note, allLabel,
}: {
  values: string[];
  current: string[];
  onAdd: (values: string[]) => void;
  note?: string;
  allLabel: string; // e.g. "Add all confirming words"
}) {
  const missing = missingValues(current, values);
  if (!missing.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-1">
      <span className="text-xs text-neutral-500">Suggested{note ? ` (${note})` : ""}:</span>
      {missing.map((v) => (
        <button
          key={v}
          type="button"
          aria-label={`Add ${v}`}
          onClick={() => onAdd([v])}
          className="rounded-md border border-dashed border-neutral-300 px-2 py-0.5 text-sm text-neutral-700 hover:border-neutral-500 hover:bg-neutral-50"
        >
          + {v}
        </button>
      ))}
      {missing.length > 1 && (
        <Button variant="ghost" size="xs" aria-label={allLabel} onClick={() => onAdd(missing)}>Add all</Button>
      )}
    </div>
  );
}
