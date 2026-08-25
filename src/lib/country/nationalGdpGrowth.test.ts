import { describe, expect, it, vi } from "vitest";
import {
  gdpWeightedGrowth,
  loadNationalGdpGrowth,
  resolvePipelineGdpGrowth,
} from "./nationalGdpGrowth";

describe("resolvePipelineGdpGrowth", () => {
  it("prefers the national doc when it carries a finite value", () => {
    expect(
      resolvePipelineGdpGrowth({
        nationalDocGrowth: 4.068,
        regions: [{ growth: -9, gdp: 100 }],
      })
    ).toBe(4.068);
  });

  it("keeps a negative or zero national value rather than falling through", () => {
    expect(resolvePipelineGdpGrowth({ nationalDocGrowth: -4.867, regions: [] })).toBe(-4.867);
    expect(resolvePipelineGdpGrowth({ nationalDocGrowth: 0, regions: [] })).toBe(0);
  });

  it("derives the GDP-weighted regional mean when there is no national doc", () => {
    // The 17 countries with no national doc. This is the whole point of the
    // change: the old code returned a flat 2.5 here.
    expect(
      resolvePipelineGdpGrowth({
        regions: [
          { growth: -8.912, gdp: 100 },
          { growth: -8.912, gdp: 50 },
        ],
      })
    ).toBeCloseTo(-8.912, 3);
  });

  it("reports a contraction as a contraction, never as +2.5", () => {
    const result = resolvePipelineGdpGrowth({ regions: [{ growth: -6.87, gdp: 10 }] });
    expect(result).toBeLessThan(0);
    expect(result).not.toBe(2.5);
  });

  it("falls back to 2.5 only when no region is weightable", () => {
    expect(resolvePipelineGdpGrowth({ regions: [] })).toBe(2.5);
    expect(resolvePipelineGdpGrowth({ regions: [{ gdp: 100 }] })).toBe(2.5);
  });

  it("ignores a non-finite national value and uses the regions", () => {
    expect(
      resolvePipelineGdpGrowth({
        nationalDocGrowth: Number.NaN,
        regions: [{ growth: 3, gdp: 100 }],
      })
    ).toBe(3);
  });
});

/**
 * `findOne` answers the national-doc lookup; `find(...).project(...).toArray()`
 * answers the regional fallback. Passing `regions: null` models a country whose
 * regions carry no growth metric at all.
 */
function fakeDb(nationalDoc: unknown, regionRows: unknown[] = [], states: unknown[] = []) {
  return {
    collection: (name: string) =>
      name === "states"
        ? {
            find: () => ({ project: () => ({ toArray: async () => states }) }),
          }
        : {
            findOne: vi.fn().mockResolvedValue(nationalDoc),
            find: () => ({ project: () => ({ toArray: async () => regionRows }) }),
          },
  } as never;
}

describe("gdpWeightedGrowth", () => {
  it("weights each region's growth by its GDP, not its population", () => {
    // A big slow region and a small fast one: 100*1 + 10*11 over 110 => 1.909.
    expect(
      gdpWeightedGrowth([
        { growth: 1, gdp: 100 },
        { growth: 11, gdp: 10 },
      ])
    ).toBeCloseTo(1.909, 3);
  });

  it("keeps a contraction negative", () => {
    expect(gdpWeightedGrowth([{ growth: -8.9, gdp: 50 }])).toBeCloseTo(-8.9, 6);
  });

  it("skips regions with no growth value without distorting the mean", () => {
    expect(gdpWeightedGrowth([{ growth: 4, gdp: 100 }, { gdp: 900 }])).toBe(4);
  });

  it("skips regions with non-positive or non-finite gdp", () => {
    expect(
      gdpWeightedGrowth([
        { growth: 4, gdp: 100 },
        { growth: 999, gdp: 0 },
        { growth: 999, gdp: Number.NaN },
      ])
    ).toBe(4);
  });

  it("returns null when nothing is weightable", () => {
    expect(gdpWeightedGrowth([])).toBeNull();
    expect(gdpWeightedGrowth([{ gdp: 100 }])).toBeNull();
  });
});

describe("loadNationalGdpGrowth", () => {
  it("returns the national doc's value when there is one", async () => {
    const doc = { economic: { gdpGrowth: { value: 4.068 } } };
    await expect(loadNationalGdpGrowth(fakeDb(doc), "US", 1959)).resolves.toBe(4.068);
  });

  it("returns a genuine negative rate rather than treating it as absent", async () => {
    const doc = { economic: { gdpGrowth: { value: -5.382 } } };
    await expect(loadNationalGdpGrowth(fakeDb(doc), "CN", 1959)).resolves.toBe(-5.382);
  });

  it("returns a zero rate as zero, not as a fallback", async () => {
    const doc = { economic: { gdpGrowth: { value: 0 } } };
    await expect(loadNationalGdpGrowth(fakeDb(doc), "JP", 1959)).resolves.toBe(0);
  });

  it("derives the GDP-weighted regional mean for a country with no national doc", async () => {
    // AT is not in NATIONAL_SCOPE. Its real economy is what its regions are
    // doing, NOT the authored era trend (which reads +5.5 while the regions
    // average well under 1).
    const result = await loadNationalGdpGrowth(
      fakeDb(
        null,
        [{ _id: "r1", economic: { gdpGrowth: { value: 0.5 } } }],
        [{ _id: "r1", gdp: 100 }]
      ),
      "AT",
      1959
    );
    expect(result).toBe(0.5);
  });

  it("reports a contracting economy as contracting, not as the era trend", async () => {
    // CS regions average about -8.9 live. Falling back to the +5.5 era trend
    // here would have grown its tax bases through a recession.
    const result = await loadNationalGdpGrowth(
      fakeDb(
        null,
        [{ _id: "r1", economic: { gdpGrowth: { value: -8.912 } } }],
        [{ _id: "r1", gdp: 100 }]
      ),
      "CS",
      1959
    );
    expect(result).toBeCloseTo(-8.912, 3);
  });

  it("falls back to the era trend only when no region carries a growth metric", async () => {
    await expect(loadNationalGdpGrowth(fakeDb(null, [], []), "FR", 1959)).resolves.toBe(4.5);
  });

  it("returns null when there is no doc, no regional metric and no era trend", async () => {
    await expect(loadNationalGdpGrowth(fakeDb({}, [], []), "US", 1959)).resolves.toBeNull();
  });
});
