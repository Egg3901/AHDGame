import { describe, it, expect } from "vitest";
import { getRegionCensusData } from "./regionCensusData";

describe("getRegionCensusData", () => {
  it("returns US census for a known state under 2019-default", () => {
    const c = getRegionCensusData("US", "CA", "2019-default");
    expect(c).not.toBeNull();
    expect(c).toHaveProperty("race");
  });

  it("returns DE census for a known Land", () => {
    const c = getRegionCensusData("DE", "BY", "2019-default");
    expect(c).not.toBeNull();
    expect(c).toHaveProperty("ethnicity");
  });

  it("falls back to 2019-default when a 1991 bundle is absent", () => {
    // US has no 1991 bundle yet at this point → should fall back, not throw.
    const c = getRegionCensusData("US", "CA", "1991-default");
    expect(c).not.toBeNull();
    expect(c).toHaveProperty("race");
  });

  it("resolves the distinct DE 1991 profile under 1991-default", () => {
    const c1991 = getRegionCensusData("DE", "BY", "1991-default") as unknown as {
      ethnicity: { german: number };
    };
    const c2019 = getRegionCensusData("DE", "BY", "2019-default") as unknown as {
      ethnicity: { german: number };
    };
    expect(c1991.ethnicity.german).toBe(87);
    expect(c1991.ethnicity.german).not.toBe(c2019.ethnicity.german);
  });

  it("returns IE census under both presets", () => {
    expect(getRegionCensusData("IE", "DUB", "1991-default")).toHaveProperty("ethnicity");
    expect(getRegionCensusData("IE", "DUB", "2019-default")).toHaveProperty("ethnicity");
  });

  it("returns null for a country with no census bundle at all (NG, not playable)", () => {
    expect(getRegionCensusData("NG", "LA", "1991-default")).toBeNull();
    expect(getRegionCensusData("NG", "LA", "2019-default")).toBeNull();
  });

  it("returns null for an unknown state id", () => {
    expect(getRegionCensusData("DE", "ZZ", "2019-default")).toBeNull();
  });

  it("resolves seceded nations to their own differentiated per-sub-region census", () => {
    const gla = getRegionCensusData("SCO", "GLA", "2019-default") as unknown as {
      ethnicity: { white_british: number };
    };
    const hig = getRegionCensusData("SCO", "HIG", "2019-default") as unknown as {
      ethnicity: { white_british: number };
    };
    expect(gla).toHaveProperty("ethnicity");
    // Differentiated, not a uniform national copy: Glasgow is more diverse
    // (lower white_british) than the Highlands.
    expect(gla.ethnicity.white_british).toBeLessThan(hig.ethnicity.white_british);

    expect(getRegionCensusData("WAL", "CDF", "1991-default")).toHaveProperty("ethnicity");
    expect(getRegionCensusData("WAL", "CDF", "2019-default")).toHaveProperty("ethnicity");
    // Unknown sub-region id → null.
    expect(getRegionCensusData("SCO", "ZZ", "2019-default")).toBeNull();
  });
});
