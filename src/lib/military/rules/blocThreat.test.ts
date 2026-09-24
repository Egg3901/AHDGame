import { describe, expect, it } from "vitest";
import { blocMassingHeat } from "./blocThreat";

describe("blocMassingHeat", () => {
  it("treats custom and preset rivals equally", () => {
    expect(blocMassingHeat("west", new Set(["ORG:andes-pact"]))).toBe(
      blocMassingHeat("west", new Set(["east"]))
    );
  });

  it("does not mistake friendly or neutral forces for an enemy Bloc", () => {
    expect(blocMassingHeat("ORG:andes-pact", new Set(["ORG:andes-pact"]))).toBe(12);
    expect(blocMassingHeat("west", new Set())).toBe(12);
  });

  it("adds the mixed-Bloc bonus for two distinct treaty poles", () => {
    expect(blocMassingHeat("west", new Set(["east", "ORG:andes-pact"]))).toBeCloseTo(25.2);
  });
});
