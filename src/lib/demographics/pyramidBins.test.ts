import { describe, expect, it } from "vitest";
import { buildAgePyramid } from "./pyramidBins";
import type { AgeSexVector } from "./cohortVector";

// uniform: N people at every age 0..100 for each sex
const uniform = (n: number): AgeSexVector => ({
  male: Array.from({ length: 101 }, () => n),
  female: Array.from({ length: 101 }, () => n),
});

describe("buildAgePyramid", () => {
  it("bins ages into 5-year bands with an open-ended top band", () => {
    const p = buildAgePyramid(uniform(10), 5);
    // bands: 0-4,5-9,...,80-84,85+ => 18 bands (0..84 is 17 bands of 5, +85+)
    expect(p.bands).toHaveLength(18);
    expect(p.bands[0].label).toBe("0–4");
    expect(p.bands[p.bands.length - 1].label).toBe("85+");
  });

  it("sums each sex within a band", () => {
    const p = buildAgePyramid(uniform(10), 5);
    // 0-4 = 5 ages × 10 = 50 each sex
    expect(p.bands[0].male).toBe(50);
    expect(p.bands[0].female).toBe(50);
    // 85+ = ages 85..100 = 16 ages × 10 = 160 each sex
    expect(p.bands[p.bands.length - 1].male).toBe(160);
  });

  it("computes each cell as a percent of TOTAL population (both sexes, all bands)", () => {
    const p = buildAgePyramid(uniform(10), 5);
    // total = 101 ages × 10 × 2 sexes = 2020
    expect(p.total).toBe(2020);
    // 0-4 male = 50 / 2020
    expect(p.bands[0].malePct).toBeCloseTo((50 / 2020) * 100, 6);
  });

  it("reports the widest single cell percent for axis scaling", () => {
    const p = buildAgePyramid(uniform(10), 5);
    // 85+ is the largest band (160), pct = 160/2020
    expect(p.maxCellPct).toBeCloseTo((160 / 2020) * 100, 6);
  });

  it("handles an all-zero vector without dividing by zero", () => {
    const empty: AgeSexVector = { male: Array(101).fill(0), female: Array(101).fill(0) };
    const p = buildAgePyramid(empty, 5);
    expect(p.total).toBe(0);
    expect(p.bands[0].malePct).toBe(0);
    expect(p.maxCellPct).toBe(0);
  });
});
