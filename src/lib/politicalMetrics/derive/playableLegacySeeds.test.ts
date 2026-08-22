import { describe, it, expect } from "vitest";
import { playableRegionSeeds1953 } from "./playableLegacySeeds";

describe("playableRegionSeeds1953", () => {
  it("returns one entry per US state with a split legacy/macro block", () => {
    const seeds = playableRegionSeeds1953("US");
    expect(seeds.length).toBe(51);
    const ca = seeds.find((s) => s.regionId === "CA")!;
    expect(ca.legacy["publicSafety.crimeRate"]).toBeGreaterThan(0);
    // economic/population are macro-owned and must not appear in `legacy`
    expect(ca.legacy["economic.medianIncome"]).toBeUndefined();
    expect(Object.keys(ca.macro).some((k) => k.startsWith("economic."))).toBe(true);
  });

  it("carries real per-region variation, not one repeated value", () => {
    const seeds = playableRegionSeeds1953("US");
    const crime = seeds.map((s) => s.legacy["publicSafety.crimeRate"]);
    expect(new Set(crime).size).toBeGreaterThan(5);
  });

  it("applies the 1953 era adjuster to the UK, whose source file is modern", () => {
    const seeds = playableRegionSeeds1953("UK");
    expect(seeds.length).toBeGreaterThan(0);
    // The raw ukStateMetrics file seeds broadband at modern levels; 1953 has none.
    for (const s of seeds) {
      const broadband = s.legacy["infrastructure.broadbandAccess"];
      if (broadband !== undefined) expect(broadband).toBeLessThan(5);
    }
  });

  it("covers all four playable countries", () => {
    for (const cid of ["US", "UK", "RU", "DD"] as const) {
      expect(playableRegionSeeds1953(cid).length).toBeGreaterThan(0);
    }
  });
});
