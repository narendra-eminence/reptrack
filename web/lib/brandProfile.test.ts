import { describe, expect, it } from "vitest";
import { addValues, cleanProfile, emptyBrand, emptyExclusions, emptyProfile, missingValues, splitEntries } from "./brandProfile";
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
      name: " Safari ", description: " bags ", aliases: [" Safari Industries ", "  "], hashtags: [" #safari "], handles: ["", "@safari"],
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
    expect(b.hashtags).toEqual(["#safari"]);
    expect(b.handles).toEqual(["@safari"]);
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
    const before = JSON.stringify(p);
    cleanProfile(p);
    p.brands[0].common_word = false;
    cleanProfile(p);
    expect(JSON.stringify({ brands: [{ ...p.brands[0], common_word: true }] })).toBe(before);
  });
});
