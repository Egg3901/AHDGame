import { describe, expect, it } from "vitest";
import { applyExtractionResourceCapacityToSupply } from "./extractionResourceSupply";

describe("applyExtractionResourceCapacityToSupply", () => {
  it("leaves non-extraction sector supply untouched", () => {
    const supply = { steel: 0.2, oil: 0.4 };

    expect(applyExtractionResourceCapacityToSupply("manufacturing", supply, { oil: 0 })).toEqual(
      supply
    );
  });

  it("leaves extraction supply untouched when the state has no capacity doc", () => {
    const supply = { oil: 0.4, coal: 0.2 };

    expect(applyExtractionResourceCapacityToSupply("extraction", supply, undefined)).toEqual(
      supply
    );
  });

  it("zeros unavailable extractable resources while preserving available and non-resource supply", () => {
    const supply = { oil: 0.4, coal: 0.2, freight: 0.1 };

    expect(
      applyExtractionResourceCapacityToSupply("extraction", supply, {
        oil: 100,
        coal: 0,
      })
    ).toEqual({ oil: 0.4, coal: 0, freight: 0.1 });
  });
});
