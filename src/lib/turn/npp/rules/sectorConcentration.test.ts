import { describe, expect, it } from "vitest";
import {
  MAX_CHALLENGER_BOOST,
  THIN_SECTOR_PULL,
  challengerBoost,
  computeSectorConcentration,
} from "./sectorConcentration";

const rows = (sectorType: string, weights: Record<string, number>) =>
  Object.entries(weights).map(([corporationId, weight]) => ({ sectorType, corporationId, weight }));

describe("computeSectorConcentration", () => {
  it("finds the leader, its share and the meaningful rivals per sector", () => {
    const m = computeSectorConcentration([
      ...rows("energy", { a: 60, b: 20, c: 10, d: 5, e: 5 }),
      ...rows("retail", { x: 10, y: 10 }),
    ]);
    const energy = m.get("energy")!;
    expect(energy.leaderCorporationId).toBe("a");
    expect(energy.leaderShare).toBeCloseTo(0.6, 9);
    // 20% of the leader is 12: only a and b qualify.
    expect(energy.meaningfulFirms).toBe(2);
    expect(m.get("retail")!.meaningfulFirms).toBe(2);
  });

  it("sums a firm's rows across states and ignores empty or invalid weights", () => {
    const m = computeSectorConcentration([
      ...rows("energy", { a: 10, b: 0, c: Number.NaN }),
      { sectorType: "energy", corporationId: "a", weight: 30 },
    ]);
    expect(m.get("energy")!.leaderShare).toBe(1);
    expect(m.get("energy")!.meaningfulFirms).toBe(1);
  });
});

describe("challengerBoost", () => {
  const conc = (leaderShare: number, meaningfulFirms: number) => ({
    leaderCorporationId: "lead",
    leaderShare,
    meaningfulFirms,
  });

  it("is 1 for the leader, an unmeasured sector and a healthy sector", () => {
    expect(challengerBoost(conc(0.9, 1), "lead")).toBe(1);
    expect(challengerBoost(undefined, "x")).toBe(1);
    expect(challengerBoost(conc(0.25, 6), "x")).toBe(1);
  });

  it("rises with the leader's share to the cap", () => {
    expect(challengerBoost(conc(0.45, 4), "x")).toBeCloseTo(
      1 + 0.5 * (MAX_CHALLENGER_BOOST - 1),
      9
    );
    expect(challengerBoost(conc(0.6, 4), "x")).toBe(MAX_CHALLENGER_BOOST);
    expect(challengerBoost(conc(0.95, 4), "x")).toBe(MAX_CHALLENGER_BOOST);
  });

  it("pulls a thin sector even when its leader is not dominant", () => {
    expect(challengerBoost(conc(0.35, 2), "x")).toBeCloseTo(
      1 + (MAX_CHALLENGER_BOOST - 1) * THIN_SECTOR_PULL,
      9
    );
  });
});
