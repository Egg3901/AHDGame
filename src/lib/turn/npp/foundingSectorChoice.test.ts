import { describe, expect, it } from "vitest";
import { foundingSectorWeights, pickWeightedIndex } from "./foundingSectorChoice";
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

  it("pulls founders toward a dominated sector", () => {
    const flat = foundingSectorWeights({
      types: TYPES,
      countryId: "US",
      priceRatioOf: () => 1,
      existingCount: () => 0,
    });
    const pulled = foundingSectorWeights({
      types: TYPES,
      countryId: "US",
      priceRatioOf: () => 1,
      existingCount: () => 0,
      challengerBoostOf: (t) => (t === "retail" ? 2.5 : 1),
    });
    expect(pulled[2]).toBeCloseTo(flat[2] * 2.5, 9);
    expect(pulled[0]).toBeCloseTo(flat[0], 9);
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
