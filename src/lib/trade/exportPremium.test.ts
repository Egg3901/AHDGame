import { describe, it, expect } from "vitest";
import { computeExportPremium, computeExportExposure } from "./exportPremium";
import { TRADE_EXPORT_PREMIUM_RATE, TRADE_EXPORT_PREMIUM_CAP } from "./constants";
import type { CommodityType } from "@/lib/constants/commodities";

const R = TRADE_EXPORT_PREMIUM_RATE;
const intensity = (rec: Partial<Record<CommodityType, number>>) =>
  new Map(Object.entries(rec) as Array<[CommodityType, number]>);

describe("computeExportPremium", () => {
  it("rewards producing a commodity the country exports", () => {
    const p = computeExportPremium({ steel: 0.4 }, intensity({ steel: 1.0 }));
    expect(p).toBeCloseTo(Math.min(TRADE_EXPORT_PREMIUM_CAP, 0.4 * 1.0 * R));
  });

  it("returns 0 when the produced commodity is not exported", () => {
    expect(computeExportPremium({ steel: 0.4 }, intensity({ steel: 0 }))).toBe(0);
    expect(computeExportPremium({ steel: 0.4 }, intensity({}))).toBe(0);
  });

  it("scales with export intensity", () => {
    const low = computeExportPremium({ steel: 0.4 }, intensity({ steel: 0.25 }));
    const high = computeExportPremium({ steel: 0.4 }, intensity({ steel: 1.0 }));
    expect(high).toBeGreaterThan(low);
    expect(low).toBeCloseTo(Math.min(TRADE_EXPORT_PREMIUM_CAP, 0.4 * 0.25 * R));
  });

  it("sums across multiple produced commodities", () => {
    const p = computeExportPremium(
      { steel: 0.4, building_materials: 0.2 },
      intensity({ steel: 0.5, building_materials: 1.0 })
    );
    expect(p).toBeCloseTo(Math.min(TRADE_EXPORT_PREMIUM_CAP, (0.4 * 0.5 + 0.2 * 1.0) * R));
  });

  it("clamps to the cap", () => {
    // Force a large raw premium well above the cap.
    const p = computeExportPremium(
      { steel: 1.0, building_materials: 1.0, electronics: 1.0 },
      intensity({ steel: 1.0, building_materials: 1.0, electronics: 1.0 })
    );
    expect(p).toBe(TRADE_EXPORT_PREMIUM_CAP);
  });

  it("returns 0 for a sector that supplies nothing", () => {
    expect(computeExportPremium({}, intensity({ steel: 1.0 }))).toBe(0);
  });

  it("returns 0 when supply rates are undefined (sector with no SECTOR_SUPPLY)", () => {
    expect(computeExportPremium(undefined, intensity({ steel: 1.0 }))).toBe(0);
    expect(computeExportPremium(null, intensity({ steel: 1.0 }))).toBe(0);
  });
});

describe("computeExportExposure", () => {
  it("is the supply-weighted mean export intensity", () => {
    // 60% steel @ 1.0 exported, 40% food @ 0.0 (domestic) → 0.6
    const e = computeExportExposure(
      { steel: 0.6, food: 0.4 },
      intensity({ steel: 1.0, food: 0.0 })
    );
    expect(e).toBeCloseTo(0.6);
  });

  it("is 1 for a fully-exported single-commodity sector, 0 for a fully-domestic one", () => {
    expect(computeExportExposure({ steel: 0.4 }, intensity({ steel: 1.0 }))).toBe(1);
    expect(computeExportExposure({ steel: 0.4 }, intensity({ steel: 0.0 }))).toBe(0);
    expect(computeExportExposure({ steel: 0.4 }, intensity({}))).toBe(0);
  });

  it("clamps out-of-range intensities and handles empty/undefined supply", () => {
    expect(computeExportExposure({ steel: 0.4 }, intensity({ steel: 5 }))).toBe(1);
    expect(computeExportExposure({ steel: 0.4 }, intensity({ steel: -3 }))).toBe(0);
    expect(computeExportExposure({}, intensity({ steel: 1.0 }))).toBe(0);
    expect(computeExportExposure(undefined, intensity({ steel: 1.0 }))).toBe(0);
    expect(computeExportExposure(null, intensity({ steel: 1.0 }))).toBe(0);
  });
});
