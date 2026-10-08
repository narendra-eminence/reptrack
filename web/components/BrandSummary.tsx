import type { BrandSet, ProfileBrand } from "@/lib/types";

export const HAND_WRITTEN_NOTE =
  "Written by hand before the form existed. It still works for verification. To change it, create it again with the form.";

function lines(b: ProfileBrand): string[] {
  const out: string[] = [];
  const add = (label: string, values: string[]) => {
    if (values.length > 0) out.push(`${label}: ${values.join(", ")}`);
  };
  add("Other names", b.aliases);
  add("Hashtags", b.hashtags.map((h) => `#${h}`));
  add("Handles", b.handles.map((h) => `@${h}`));
  add("Confirmed by", b.confirming_words);
  add("Not when after", b.exclusions.followed_by);
  add("Not when before", b.exclusions.preceded_by);
  add("Not in the same sentence as", b.exclusions.nearby);
  add("Ignored phrases", b.exclusions.phrases);
  add("People", b.people.map((p) => (p.require_brand_nearby ? `${p.name} (only near the brand)` : p.name)));
  return out;
}

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
          {lines(b).map((l) => (
            <p key={l} className="mt-1 break-words text-xs text-neutral-600">{l}</p>
          ))}
        </li>
      ))}
    </ul>
  );
}
