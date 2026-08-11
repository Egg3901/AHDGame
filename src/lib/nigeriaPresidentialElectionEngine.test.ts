import { describe, expect, it } from "vitest";
import { resolveNigeriaPresidentialResult, NG_ZONES } from "./nigeriaPresidentialElectionEngine";

// Build per-zone tallies from a party→[6 zone counts] map.
function zones(per: Record<string, number[]>): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  NG_ZONES.forEach((z, i) => {
    out[z] = {};
    for (const p in per) out[z][p] = per[p][i];
  });
  return out;
}

describe("NG presidential resolution (national plurality + 4-zone spread)", () => {
  it("wins outright with plurality and >=25% in >=4 zones", () => {
    const t = zones({ apc: [60, 60, 60, 60, 30, 30], pdp: [40, 40, 40, 40, 70, 70] });
    const r = resolveNigeriaPresidentialResult(t);
    expect(r.outcome).toBe("won");
    expect(r.winnerPartyId).toBe("apc");
    expect(r.leaderZonesCleared).toBeGreaterThanOrEqual(4);
  });

  it("triggers a run-off when the national leader lacks the 4-zone spread", () => {
    // apc has the most national votes but clears 25% in only 3 zones.
    const t = zones({
      apc: [98, 98, 98, 2, 2, 2],
      pdp: [1, 1, 1, 60, 60, 60],
      lp: [1, 1, 1, 38, 38, 38],
    });
    const r = resolveNigeriaPresidentialResult(t);
    expect(r.outcome).toBe("runoff");
    expect(r.runoffPartyIds).toHaveLength(2);
    expect(r.runoffPartyIds).toContain("apc");
  });

  it("run-off pair is the top two by national vote", () => {
    // apc leads nationally (255) but clears 25% in only 3 zones → run-off vs pdp (180).
    const t = zones({
      apc: [80, 80, 80, 5, 5, 5],
      pdp: [10, 10, 10, 50, 50, 50],
      lp: [10, 10, 10, 45, 45, 45],
    });
    const r = resolveNigeriaPresidentialResult(t);
    expect(r.outcome).toBe("runoff");
    expect(r.leaderZonesCleared).toBe(3);
    expect(new Set(r.runoffPartyIds)).toEqual(new Set(["apc", "pdp"]));
  });

  it("returns runoff with no parties on an empty tally", () => {
    const r = resolveNigeriaPresidentialResult({});
    expect(r.outcome).toBe("runoff");
    expect(r.leaderZonesCleared).toBe(0);
  });

  it("a uniformly dominant party clears all six zones and wins", () => {
    const t = zones({ apc: [70, 70, 70, 70, 70, 70], pdp: [30, 30, 30, 30, 30, 30] });
    const r = resolveNigeriaPresidentialResult(t);
    expect(r.outcome).toBe("won");
    expect(r.winnerPartyId).toBe("apc");
    expect(r.leaderZonesCleared).toBe(6);
  });
});
