import { describe, expect, it } from "vitest";
import { productionProductivityMultiplier } from "./productionProductivity";

describe("plant productivity basis", () => {
  it("preserves neutral output and applies both known productivity sources once", () => {
    const input = { sectorType: "energy", supply: { energy: 1 }, currentTurn: 100 };
    expect(productionProductivityMultiplier(input)).toBe(1);
    expect(productionProductivityMultiplier({ sectorType: "media", currentTurn: 100 })).toBe(1);
    expect(productionProductivityMultiplier({ ...input, preset: "1991-default" })).toBe(1.3);
    expect(
      productionProductivityMultiplier({
        ...input,
        preset: "1991-default",
        outputRateMult: { energy: 2 },
      })
    ).toBe(2.6);
    expect(
      productionProductivityMultiplier({ ...input, preset: "1991-default", currentTurn: 48 })
    ).toBe(1);
  });
});
