import { describe, expect, it } from "vitest";
import { buildOwnershipSlices } from "./OwnershipDonut";
import type { CorporationDetail } from "./CorporationPageTypes";

function corp(holders: number[], totalShares: number): CorporationDetail {
  return {
    _id: "c1",
    totalShares,
    brandColor: "#3366cc",
    shareholders: holders.map((shares, i) => ({
      name: `H${i}`,
      characterId: `ch${i}`,
      shares,
    })),
  } as unknown as CorporationDetail;
}

describe("buildOwnershipSlices", () => {
  it("names the top six, groups the tail and shows unheld shares as on the market", () => {
    const slices = buildOwnershipSlices(
      corp([10, 30, 5, 5, 5, 5, 5, 5, 5], 100),
      () => null,
      "ch1"
    );
    expect(slices.map((s) => s.label)).toEqual([
      "H1",
      "H0",
      "H2",
      "H3",
      "H4",
      "H5",
      "3 smaller holders",
      "On the market",
    ]);
    expect(slices[0].isYou).toBe(true);
    expect(slices.at(-2)?.pct).toBeCloseTo(15);
    expect(slices.at(-1)?.pct).toBeCloseTo(25);
    expect(slices.reduce((sum, s) => sum + s.pct, 0)).toBeCloseTo(100);
  });

  it("returns nothing when the company has no shares", () => {
    expect(buildOwnershipSlices(corp([], 0), () => null, null)).toEqual([]);
  });
});
