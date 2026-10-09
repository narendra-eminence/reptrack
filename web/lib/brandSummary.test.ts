import { describe, expect, it } from "vitest";
import { emptyBrand } from "./brandProfile";
import { summaryLines } from "./brandSummary";

describe("summaryLines", () => {
  it("omits everything for an empty brand", () => {
    expect(summaryLines(emptyBrand())).toEqual([]);
  });

  it("builds readable lines and omits empty ones", () => {
    const b = {
      ...emptyBrand(),
      name: "Safari",
      aliases: ["Safari Industries"],
      hashtags: ["safari", "trolley"],
      handles: ["safari_bags"],
      confirming_words: ["luggage"],
      exclusions: { followed_by: [], preceded_by: ["Apple"], nearby: [], phrases: ["safari park"] },
      people: [
        { name: "Jane Doe", require_brand_nearby: true },
        { name: "John Roe", require_brand_nearby: false },
      ],
    };
    expect(summaryLines(b)).toEqual([
      "Other names: Safari Industries",
      "Hashtags: #safari, #trolley",
      "Handles: @safari_bags",
      "Confirmed by: luggage",
      "Not when before: Apple",
      "Ignored phrases: safari park",
      "People: Jane Doe (only near the brand), John Roe",
    ]);
  });
});
