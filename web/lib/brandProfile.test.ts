import { describe, expect, it } from "vitest";
import { addValues, cleanProfile, emptyBrand, emptyProfile, emptyWord, missingValues, splitEntries } from "./brandProfile";

describe("brandProfile helpers", () => {
  it("splits typed or pasted entries on commas and new lines", () => {
    expect(splitEntries(" luggage, bag\ntrolley ,, ")).toEqual(["luggage", "bag", "trolley"]);
  });

  it("adds values without case-insensitive duplicates, keeping order", () => {
    expect(addValues(["Luggage"], ["luggage", "bag", "Bag", "tab"])).toEqual(["Luggage", "bag", "tab"]);
  });

  it("reports which suggestions are not in the list yet", () => {
    expect(missingValues(["Luggage"], ["luggage", "bag"])).toEqual(["bag"]);
  });

  it("starts with one empty brand and no people", () => {
    expect(emptyProfile()).toEqual({ brands: [emptyBrand()], people: [] });
    expect(emptyWord("Safari").word).toBe("Safari");
    expect(emptyWord().closeness).toBe("nearby");
    expect(emptyWord().exact_case).toBe(true);
  });

  it("trims names and values before sending", () => {
    const p = emptyProfile();
    p.brands[0] = { ...p.brands[0], name: " Safari ", always: [" Safari Industries "], everyday_word: { ...emptyWord(" Safari "), confirm: [" bag "] } };
    p.people = [{ name: " Jo ", common: false }];
    const c = cleanProfile(p);
    expect(c.brands[0].name).toBe("Safari");
    expect(c.brands[0].always).toEqual(["Safari Industries"]);
    expect(c.brands[0].everyday_word?.word).toBe("Safari");
    expect(c.brands[0].everyday_word?.confirm).toEqual(["bag"]);
    expect(c.people[0].name).toBe("Jo");
  });

  it("drops untouched people rows and blank list values", () => {
    const p = emptyProfile();
    p.brands[0] = { ...p.brands[0], name: "Safari", always: ["  ", "Safari Industries"], everyday_word: { ...emptyWord("Safari"), confirm: ["", " bag "] } };
    p.people = [{ name: "   ", common: false }, { name: "Jo", common: true }, { name: "", common: true }];
    const c = cleanProfile(p);
    expect(c.people).toEqual([{ name: "Jo", common: true }]);
    expect(c.brands[0].always).toEqual(["Safari Industries"]);
    expect(c.brands[0].everyday_word?.confirm).toEqual(["bag"]);
  });
});
