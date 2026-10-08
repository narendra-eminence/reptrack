import type { BrandProfile, Exclusions, ProfileBrand } from "./types";

export const emptyExclusions = (): Exclusions => ({ followed_by: [], preceded_by: [], nearby: [], phrases: [] });

export const emptyBrand = (): ProfileBrand => ({
  name: "",
  description: "",
  aliases: [],
  hashtags: [],
  handles: [],
  common_word: false,
  confirming_words: [],
  exclusions: emptyExclusions(),
  people: [],
  tests: [],
});

export const emptyProfile = (): BrandProfile => ({ brands: [emptyBrand()] });

export function splitEntries(raw: string): string[] {
  return raw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
}

export function addValues(list: string[], values: string[]): string[] {
  const seen = new Set(list.map((v) => v.toLowerCase()));
  const out = [...list];
  for (const v of values) {
    const key = v.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(v);
    }
  }
  return out;
}

export function missingValues(list: string[], values: string[]): string[] {
  const seen = new Set(list.map((v) => v.toLowerCase()));
  return values.filter((v) => !seen.has(v.toLowerCase()));
}

const trimAll = (xs: string[]) => xs.map((x) => x.trim()).filter(Boolean);

/** Trim, drop blanks, and clear common-word-only lists when the brand is not a common word. */
export function cleanProfile(p: BrandProfile): BrandProfile {
  return {
    brands: p.brands.map((b) => ({
      name: b.name.trim(),
      description: b.description.trim(),
      aliases: trimAll(b.aliases),
      hashtags: trimAll(b.hashtags),
      handles: trimAll(b.handles),
      common_word: b.common_word,
      confirming_words: b.common_word ? trimAll(b.confirming_words) : [],
      exclusions: b.common_word
        ? {
            followed_by: trimAll(b.exclusions.followed_by),
            preceded_by: trimAll(b.exclusions.preceded_by),
            nearby: trimAll(b.exclusions.nearby),
            phrases: trimAll(b.exclusions.phrases),
          }
        : emptyExclusions(),
      people: b.people
        .map((x) => ({ name: x.name.trim(), require_brand_nearby: x.require_brand_nearby }))
        .filter((x) => x.name),
      tests: b.tests.map((t) => ({ text: t.text.trim(), expect: t.expect })).filter((t) => t.text),
    })),
  };
}
