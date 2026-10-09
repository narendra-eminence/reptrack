import type { ProfileBrand } from "./types";

export function summaryLines(b: ProfileBrand): string[] {
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
