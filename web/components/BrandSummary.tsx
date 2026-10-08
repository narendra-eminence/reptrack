import { summaryLines } from "@/lib/brandSummary";
import type { BrandSet } from "@/lib/types";

export const HAND_WRITTEN_NOTE =
  "Written by hand before the form existed. It still works for verification. To change it, create it again with the form.";

export function BrandSummary({ set }: { set: BrandSet }) {
  if (!set.profile) {
    return <p data-testid="brand-summary" className="max-w-prose text-sm text-neutral-600">{HAND_WRITTEN_NOTE}</p>;
  }
  return (
    <ul data-testid="brand-summary" className="space-y-2 text-sm">
      {set.profile.brands.map((b, i) => (
        <li key={i} className="rounded-md border p-3">
          <p className="break-words font-semibold">{b.name}</p>
          {b.description && <p className="mt-0.5 break-words text-neutral-600">{b.description}</p>}
          {summaryLines(b).map((l) => (
            <p key={l} className="mt-1 break-words text-xs text-neutral-600">{l}</p>
          ))}
        </li>
      ))}
    </ul>
  );
}
