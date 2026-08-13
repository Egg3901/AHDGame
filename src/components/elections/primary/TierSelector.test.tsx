import { describe, expect, it } from "vitest";
import { __ALL_TIERS_FOR_TEST } from "./TierSelector";

describe("TierSelector — tier configuration", () => {
  it("ships exactly 5 tiers in the documented order", () => {
    expect(__ALL_TIERS_FOR_TEST.map((t) => t.id)).toEqual([
      "president",
      "senate",
      "house",
      "governor",
      "stateSenate",
    ]);
  });

  it("each tier has an icon and a translation key", () => {
    for (const t of __ALL_TIERS_FOR_TEST) {
      expect(t.icon).toBeTruthy();
      expect(t.labelKey).toBeTruthy();
    }
  });
});
