import { describe, expect, it } from "vitest";
import { sovereignIssuanceFlowsByCountry } from "./sovereignProceeds";

describe("sovereign cash proceeds", () => {
  it("adds at-par issues and actual old/new placement consideration once", () => {
    expect(
      sovereignIssuanceFlowsByCountry({
        atParIssues: [{ countryId: "US", face: 25_000 }],
        placements: [
          { countryId: "US", face: 14_000, cashPaid: 14_280 },
          { countryId: "UK", face: 10_000, cashPaid: 9_800 },
        ],
      })
    ).toEqual({ US: { cash: 39_280, face: 39_000 }, UK: { cash: 9_800, face: 10_000 } });
  });

  it("rejects negative, nonfinite, and unsafe proceeds", () => {
    expect(() =>
      sovereignIssuanceFlowsByCountry({
        atParIssues: [{ countryId: "US", face: -1 }],
        placements: [],
      })
    ).toThrow("Invalid");
    expect(() =>
      sovereignIssuanceFlowsByCountry({
        atParIssues: [],
        placements: [{ countryId: "US", face: 10_000, cashPaid: Number.NaN }],
      })
    ).toThrow("Invalid");
    expect(() =>
      sovereignIssuanceFlowsByCountry({
        atParIssues: [{ countryId: "JP", face: Number.MAX_SAFE_INTEGER }],
        placements: [{ countryId: "JP", face: 1, cashPaid: 1 }],
      })
    ).toThrow("safe units");
  });
});
