import type { BrandProfile, Exclusions, ProfileBrand, ProfileWarning, TestResult } from "./types";

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

/** A hashtag or handle as stored: trimmed, without one leading # or @ (the same rule as url-verification). */
export function normaliseTag(value: string): string {
  const v = value.trim();
  return /^[#@]/.test(v) ? v.slice(1) : v;
}

const tagsAll = (xs: string[]) => xs.map(normaliseTag).filter(Boolean);

/** Trim, drop blanks, strip the leading # or @ from hashtags and handles, and clear common-word-only lists when
 * the brand is not a common word. */
export function cleanProfile(p: BrandProfile): BrandProfile {
  return {
    brands: p.brands.map((b) => ({
      name: b.name.trim(),
      description: b.description.trim(),
      aliases: trimAll(b.aliases),
      hashtags: tagsAll(b.hashtags),
      handles: tagsAll(b.handles),
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

export type CheckResult = { warnings: ProfileWarning[]; tests: TestResult[] };

/** The brands that have a name, plus their indexes in the full list. Unnamed brands cannot be checked yet. */
export function namedBrands(p: BrandProfile): { profile: BrandProfile; indexes: number[] } {
  const indexes = p.brands.flatMap((b, i) => (b.name.trim() ? [i] : []));
  return { profile: { brands: indexes.map((i) => p.brands[i]) }, indexes };
}

/** Map brand indexes in a check of the named brands back to the full brand list. */
export function remapCheck(r: CheckResult, indexes: number[]): CheckResult {
  const at = (i: number | null | undefined) => (i === null || i === undefined ? null : indexes[i] ?? null);
  return {
    warnings: r.warnings.map((w) => ({ ...w, brand: at(w.brand) })),
    tests: r.tests.map((t) => ({
      ...t,
      brand: at(t.brand) ?? t.brand,
      elsewhere: t.elsewhere.map((e) => ({ ...e, owner: at(e.owner) })),
    })),
  };
}
