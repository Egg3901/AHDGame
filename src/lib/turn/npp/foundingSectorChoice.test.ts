import { describe, expect, it } from "vitest";
import {
  foundingChanceMultiplier,
  foundingSectorWeights,
  foundingShortagePressure,
  foundingSweepCap,
  pickWeightedIndex,
} from "./foundingSectorChoice";
import type { CorporationType } from "@/lib/constants/corporations";
import { SECTOR_SUPPLY } from "@/lib/constants/commodities";

const TYPES = ["healthcare", "extraction", "retail"] as CorporationType[];

function ratioFor(map: Record<string, number>) {
  return (commodity: string) => map[commodity] ?? 1;
}

describe("foundingSectorWeights", () => {
  it("favors a sector whose outputs are short", () => {
    const short = Object.fromEntries(
      (SECTOR_SUPPLY.healthcare ?? []).map((s) => [s.commodity, 2.5])
    );
    const w = foundingSectorWeights({
      types: TYPES,
      countryId: "US",
      priceRatioOf: ratioFor(short) as never,
      existingCount: () => 0,
    });
    expect(w[0]).toBeGreaterThan(w[1]);
    expect(w[0]).toBeGreaterThan(w[2]);
  });

  it("discounts a sector already crowded in the founder's country", () => {
    const flat = foundingSectorWeights({
      types: TYPES,
      countryId: "US",
      priceRatioOf: () => 1,
      existingCount: () => 0,
    });
    const crowded = foundingSectorWeights({
      types: TYPES,
      countryId: "US",
      priceRatioOf: () => 1,
      existingCount: (_c, t) => (t === "retail" ? 9 : 0),
    });
    expect(crowded[2]).toBeCloseTo(flat[2] / 10, 9);
    expect(crowded[0]).toBeCloseTo(flat[0], 9);
  });

  it("never gives a sector zero weight", () => {
    const w = foundingSectorWeights({
      types: TYPES,
      countryId: "US",
      priceRatioOf: () => 0.01,
      existingCount: () => 0,
    });
    for (const x of w) expect(x).toBeGreaterThan(0);
  });
});

describe("pickWeightedIndex", () => {
  it("maps a roll onto cumulative weight", () => {
    expect(pickWeightedIndex([1, 3], 0.2)).toBe(0);
    expect(pickWeightedIndex([1, 3], 0.3)).toBe(1);
    expect(pickWeightedIndex([1, 3], 0.999)).toBe(1);
  });

  it("falls back to uniform when every weight is zero", () => {
    expect(pickWeightedIndex([0, 0, 0, 0], 0.6)).toBe(2);
  });
});

describe("founding responds to shortage", () => {
  it("measures the share of priced markets that are short", () => {
    expect(foundingShortagePressure([2, 1.2, 1, 0.8, null])).toBeCloseTo(0.5, 9);
    expect(foundingShortagePressure([null, Number.NaN])).toBe(0);
    expect(foundingShortagePressure([])).toBe(0);
  });

  it("widens the sweep cap and the chance with pressure, bounded", () => {
    expect(foundingSweepCap(0)).toBe(3);
    expect(foundingSweepCap(1)).toBe(12);
    expect(foundingSweepCap(7)).toBe(12);
    expect(foundingSweepCap(0.79)).toBeGreaterThan(foundingSweepCap(0.2));
    expect(foundingChanceMultiplier(0)).toBe(1);
    expect(foundingChanceMultiplier(1)).toBe(3);
    expect(foundingChanceMultiplier(-1)).toBe(1);
  });
});
