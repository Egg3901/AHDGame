import { describe, expect, it } from "vitest";
import { splitExtractionFields } from "./extraction";
describe("successor extraction conservation", () => {
  it("scales both capacity and depletion", () => {
    expect(
      splitExtractionFields(
        { resources: { oil: 100 }, extractedUnits: { oil: 20 } },
        0.2,
        "SCO",
        "LOT",
        true
      )
    ).toEqual({ resources: { oil: 20 }, extractedUnits: { oil: 4 } });
  });
  it("divides offer fees and remaps the public contracting authority", () => {
    expect(
      splitExtractionFields(
        {
          signingFeeAnchor: 1000,
          share: 0.5,
          royaltyRatePerTurn: 0.01,
          grantedByLevel: "national",
        },
        0.2,
        "SCO",
        "LOT",
        false
      )
    ).toEqual({ signingFeeAnchor: 200, grantedBy: "SCO" });
    expect(
      splitExtractionFields({ grantedByLevel: "state" }, 0.2, "SCO", "LOT", false).grantedBy
    ).toBe("LOT");
  });
});
