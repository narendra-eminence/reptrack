"use client";

import { TagInput } from "@/components/TagInput";
import { DETAIL_FIELDS } from "@/lib/cleaning";
import type { CleaningDetails } from "@/lib/types";

const stripAt = (v: string) => v.replace(/^@/, "");

/** The four cleaning-detail lists of a brand set, as part of whichever editor holds the set. */
export function CleaningDetailsFields({ value, onChange }: { value: CleaningDetails; onChange: (next: CleaningDetails) => void }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {DETAIL_FIELDS.map((f) => (
        <TagInput
          key={f.key}
          id={`cleaning-${f.key}`}
          label={f.label}
          values={value[f.key]}
          onChange={(values) => onChange({ ...value, [f.key]: values })}
          normalise={f.key.endsWith("handles") ? stripAt : (v) => v.toLowerCase()}
          placeholder={f.placeholder}
          hint={f.hint}
        />
      ))}
    </div>
  );
}

export const CLEANING_HINT =
  "Used by the Clean step only; verification ignores them. The brand's own pages and posts go to Brand Communication, a competitor's to Competitor Owned.";
