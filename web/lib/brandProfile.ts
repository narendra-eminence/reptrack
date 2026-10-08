import type { BrandProfile, Closeness, EverydayWord, ProfileBrand } from "./types";

export const CLOSENESS_LABELS: Record<Closeness, string> = {
  close: "Close (about 10 words)",
  nearby: "Nearby (about 15 words)",
  paragraph: "Same paragraph",
};

export const WORD_LISTS = ["confirm", "not_followed_by", "not_preceded_by", "not_in_sentence_with", "ignore_phrases"] as const;
export type WordList = (typeof WORD_LISTS)[number];

export const emptyWord = (word = ""): EverydayWord => ({
  word,
  exact_case: true,
  closeness: "nearby",
  confirm: [],
  not_followed_by: [],
  not_preceded_by: [],
  not_in_sentence_with: [],
  ignore_phrases: [],
});

export const emptyBrand = (): ProfileBrand => ({ name: "", always: [], handles: [], everyday_word: null });

export const emptyProfile = (): BrandProfile => ({ brands: [emptyBrand()], people: [] });

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

export function cleanProfile(p: BrandProfile): BrandProfile {
  return {
    brands: p.brands.map((b) => ({
      name: b.name.trim(),
      always: trimAll(b.always),
      handles: trimAll(b.handles),
      everyday_word: b.everyday_word && {
        ...b.everyday_word,
        word: b.everyday_word.word.trim(),
        ...Object.fromEntries(WORD_LISTS.map((k) => [k, trimAll(b.everyday_word![k])])),
      },
    })),
    people: p.people.map((x) => ({ name: x.name.trim(), common: x.common })).filter((x) => x.name),
  };
}
