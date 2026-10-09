import { describe, expect, it } from "vitest";
import {
  addValues, cleanProfile, emptyBrand, emptyExclusions, emptyProfile, formProblems, missingValues, namedBrands, normaliseTag,
  remapCheck, splitEntries, suggestSetName,
} from "./brandProfile";
import type { BrandProfile } from "./types";

describe("brandProfile helpers", () => {
  it("splits typed or pasted entries on commas and new lines", () => {
    expect(splitEntries(" luggage, bag\ntrolley ,, ")).toEqual(["luggage", "bag", "trolley"]);
  });

  it("adds values without case-insensitive duplicates, keeping order", () => {
    expect(addValues(["Luggage"], ["luggage", "bag", "Bag", "tab"])).toEqual(["Luggage", "bag", "tab"]);
  });

  it("reports which values are not in the list yet", () => {
    expect(missingValues(["Luggage"], ["luggage", "bag"])).toEqual(["bag"]);
  });

  it("starts with one empty, not-common brand", () => {
    const p = emptyProfile();
    expect(p).toEqual({ brands: [emptyBrand()] });
    expect(p.brands[0]).toEqual({
      name: "", description: "", aliases: [], hashtags: [], handles: [], common_word: false,
      confirming_words: [], exclusions: emptyExclusions(), people: [], tests: [],
    });
    expect(emptyExclusions()).toEqual({ followed_by: [], preceded_by: [], nearby: [], phrases: [] });
  });

  const messy = (): BrandProfile => ({
    brands: [{
      name: " Safari ", description: " bags ", aliases: [" Safari Industries ", "  "], hashtags: [" #safari ", "#"], handles: ["", "@safari", " @x "],
      common_word: true, confirming_words: [" bag ", ""],
      exclusions: { followed_by: [" park "], preceded_by: ["", "on"], nearby: [" zoo "], phrases: [" Safari browser ", " "] },
      people: [{ name: " Jo ", require_brand_nearby: true }, { name: "   ", require_brand_nearby: false }],
      tests: [{ text: " Safari bag ", expect: "no_match" }, { text: "   ", expect: "match" }],
    }],
  });

  it("trims and drops blanks, keeping flags and expectations", () => {
    const b = cleanProfile(messy()).brands[0];
    expect(b.name).toBe("Safari");
    expect(b.description).toBe("bags");
    expect(b.aliases).toEqual(["Safari Industries"]);
    expect(b.hashtags).toEqual(["safari"]);
    expect(b.handles).toEqual(["safari", "x"]);
    expect(b.confirming_words).toEqual(["bag"]);
    expect(b.exclusions).toEqual({ followed_by: ["park"], preceded_by: ["on"], nearby: ["zoo"], phrases: ["Safari browser"] });
    expect(b.people).toEqual([{ name: "Jo", require_brand_nearby: true }]);
    expect(b.tests).toEqual([{ text: "Safari bag", expect: "no_match" }]);
  });

  it("clears confirming words and exclusions when not a common word", () => {
    const p = messy();
    p.brands[0].common_word = false;
    const b = cleanProfile(p).brands[0];
    expect(b.confirming_words).toEqual([]);
    expect(b.exclusions).toEqual(emptyExclusions());
    expect(b.aliases).toEqual(["Safari Industries"]);
  });

  it("does not mutate its input", () => {
    const p = messy();
    const before = structuredClone(p);
    cleanProfile(p);
    const notCommon = { brands: [{ ...p.brands[0], common_word: false }] };
    const notCommonBefore = structuredClone(notCommon);
    cleanProfile(notCommon);
    expect(p).toEqual(before);
    expect(notCommon).toEqual(notCommonBefore);
  });

  it("normalises a hashtag or handle: trimmed, one leading # or @ removed", () => {
    expect(normaliseTag(" #safari ")).toBe("safari");
    expect(normaliseTag("@safari_india")).toBe("safari_india");
    expect(normaliseTag("##x")).toBe("#x");
    expect(normaliseTag("safari")).toBe("safari");
  });

  it("treats #Safari and safari as the same hashtag once normalised", () => {
    expect(addValues(["safari"], ["#Safari"].map(normaliseTag))).toEqual(["safari"]);
  });
});

describe("checking only named brands", () => {
  const entry = { brand: "B", offset: 0, text: "B", before: "", after: "", cut_before: false, cut_after: false, snippet: "B" };

  it("drops unnamed brands and keeps the original indexes", () => {
    const p: BrandProfile = { brands: [{ ...emptyBrand(), name: "A" }, emptyBrand(), { ...emptyBrand(), name: " B " }] };
    const { profile, indexes } = namedBrands(p);
    expect(profile.brands.map((b) => b.name)).toEqual(["A", " B "]);
    expect(indexes).toEqual([0, 2]);
  });

  it("maps result, warning and owner indexes back to the full list", () => {
    const out = remapCheck(
      {
        warnings: [{ brand: 1, field: "phrases", message: "m" }, { brand: null, field: "x", message: "n" }],
        tests: [{
          brand: 0, index: 0, text: "t", expect: "match", passed: false, counted: [], not_counted: [],
          elsewhere: [{ ...entry, owner: 1 }, { ...entry, owner: null }],
        }],
      },
      [0, 2],
    );
    expect(out.warnings.map((w) => w.brand)).toEqual([2, null]);
    expect(out.tests[0].brand).toBe(0);
    expect(out.tests[0].elsewhere.map((e) => e.owner)).toEqual([2, null]);
  });
});

describe("formProblems", () => {
  const opts = { isNew: true, existingNames: ["safari"] };
  const profile = (...names: string[]) => ({ brands: names.map((name) => ({ ...emptyBrand(), name })) });

  it("names every missing required field, in form order", () => {
    expect(formProblems("", profile("", "Genie"), opts)).toEqual([
      { field: "set-name", message: "Set name is required, for example safari." },
      { field: "b0-name", message: "Brand 1: Brand name is required." },
    ]);
  });

  it("checks the set name's shape and that a new set's name is free", () => {
    expect(formProblems("Safari Bags", profile("Safari"), opts)[0].message).toMatch(/lowercase letters/);
    expect(formProblems("safari", profile("Safari"), opts)[0].message).toMatch(/already exists/);
    expect(formProblems("safari", profile("Safari"), { ...opts, isNew: false })).toEqual([]);
  });

  it("flags a brand name used twice", () => {
    expect(formProblems("zeta", profile("Zeta", " zeta "), opts)).toEqual([
      { field: "b1-name", message: "Brand 2: zeta is already Brand 1." },
    ]);
  });
});

describe("suggestSetName", () => {
  it("makes a valid set name from a brand name", () => {
    expect(suggestSetName("Safari Industries")).toBe("safari_industries");
    expect(suggestSetName("  Navana.ai! ")).toBe("navana_ai");
    expect(suggestSetName("Café")).toBe("caf");
  });
});
