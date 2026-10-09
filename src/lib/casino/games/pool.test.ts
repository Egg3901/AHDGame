import { describe, expect, it } from "vitest";
import { settleByChips, splitPot } from "./pool";

describe("splitPot", () => {
  it("splits pro rata after rake and keeps the dust", () => {
    const { shares, rake } = splitPot(1000, 0.05, [
      { key: "a", anchorAmount: 100 },
      { key: "b", anchorAmount: 200 },
    ]);
    expect(shares).toEqual([
      { key: "a", anchorAmount: 316.66 },
      { key: "b", anchorAmount: 633.33 },
    ]);
    expect(rake).toBeCloseTo(50.01, 6);
  });

  it("keeps the whole pot when nobody won", () => {
    expect(splitPot(500, 0.05, [])).toEqual({ shares: [], rake: 500 });
  });
});

describe("settleByChips", () => {
  it("rakes only profit and conserves the pot", () => {
    const { shares, rake } = settleByChips(
      [
        { key: "a", anchorAmount: 1000, chips: 1500, startingChips: 1000 },
        { key: "b", anchorAmount: 1000, chips: 500, startingChips: 1000 },
      ],
      0.05
    );
    expect(shares).toEqual([
      { key: "a", anchorAmount: 1475 },
      { key: "b", anchorAmount: 500 },
    ]);
    expect(rake).toBe(25);
  });
});
