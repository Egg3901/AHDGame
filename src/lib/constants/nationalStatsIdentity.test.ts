import { describe, it, expect } from "vitest";
import { getStatsIdentity, NATIONAL_STATS_IDENTITY } from "./nationalStatsIdentity";

describe("nationalStatsIdentity", () => {
  it("provides all six designed countries", () => {
    for (const c of ["CN", "US", "UK", "DE", "JP", "IE"] as const) {
      expect(NATIONAL_STATS_IDENTITY[c]).toBeDefined();
    }
  });

  it("resolves a known country", () => {
    const id = getStatsIdentity("UK");
    expect(id.office).toMatch(/Office for National Statistics/i);
    expect(id.accent.stat).toMatch(/^#/);
  });

  it("falls back for an unknown/unstyled country", () => {
    const id = getStatsIdentity("BR");
    expect(id).toBeDefined();
    expect(id.glyph.length).toBeGreaterThan(0);
    expect(id.accent.g0).toMatch(/^#/);
  });

  it("encodes English-in-parens for non-English titles and null titleEn for English ones", () => {
    expect(getStatsIdentity("CN").title).toContain("(National Statistics)");
    expect(getStatsIdentity("US").titleEn).toBeNull();
  });
});
