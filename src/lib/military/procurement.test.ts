import { describe, expect, it } from "vitest";
import {
  unitPurchasePrice,
  unitUpgradePrice,
  UPGRADE_COST_SHARE,
  ARCHETYPE_COST_GDP_DIVISOR,
  militaryPriceAnchor,
  MILITARY_PRICE_INDEXATION,
} from "./procurement";
import { manpowerCeiling, initialManpowerPool, MANPOWER_START_FRACTION } from "./manpower";

const US_GDP_1953 = 387_000_000_000;
const PL_GDP_1953 = 300_000_000_000;

describe("unitPurchasePrice", () => {
  it("prices as a share of the country's own GDP", () => {
    // DE scale 1.0 → exactly cost/DIVISOR of GDP.
    const price = unitPurchasePrice({ cost: 1600 }, "DE", US_GDP_1953)!;
    expect(price).toBe(Math.round(US_GDP_1953 * (1600 / ARCHETYPE_COST_GDP_DIVISOR)));
  });

  it("reproduces the US 1953 Infantry Division figure", () => {
    // US scale 2.6 → 387e9 × (1600/387_000) × 2.6 = 4.16e9
    expect(unitPurchasePrice({ cost: 1600 }, "US", US_GDP_1953)).toBe(4_160_000_000);
  });

  it("is denomination-agnostic — Poland pays zloty off a zloty GDP", () => {
    // PL scale 1.0, no exchange rate involved anywhere.
    expect(unitPurchasePrice({ cost: 1600 }, "PL", PL_GDP_1953)).toBe(
      Math.round(PL_GDP_1953 * (1600 / ARCHETYPE_COST_GDP_DIVISOR))
    );
  });

  it("refuses when GDP is missing or non-positive rather than making units free", () => {
    expect(unitPurchasePrice({ cost: 1600 }, "US", 0)).toBeNull();
    expect(unitPurchasePrice({ cost: 1600 }, "US", -1)).toBeNull();
    expect(unitPurchasePrice({ cost: 1600 }, "US", null)).toBeNull();
    expect(unitPurchasePrice({ cost: 1600 }, "US", undefined)).toBeNull();
  });

  it("falls back to scale 1 for an unknown country", () => {
    expect(unitPurchasePrice({ cost: 387 }, "ZZ", US_GDP_1953)).toBe(387_000_000);
  });
});

// Modernizing used to be free: the upgrade route only set techTier, and techTier was
// not an input to upkeep either. A tier is worth +8% power per step, so a whole army
// could be taken to Cutting-Edge for nothing but ministerial actions.
describe("unitUpgradePrice", () => {
  it("prices a tier step as a share of what the unit costs to build", () => {
    const price = unitUpgradePrice({ cost: 1600 }, "DE", US_GDP_1953, 2)!;
    expect(price).toBe(
      Math.round(US_GDP_1953 * ((1600 * UPGRADE_COST_SHARE[2]) / ARCHETYPE_COST_GDP_DIVISOR))
    );
  });

  it("escalates with the target tier — Cutting-Edge costs the most", () => {
    const to1 = unitUpgradePrice({ cost: 1600 }, "DE", US_GDP_1953, 1)!;
    const to2 = unitUpgradePrice({ cost: 1600 }, "DE", US_GDP_1953, 2)!;
    const to3 = unitUpgradePrice({ cost: 1600 }, "DE", US_GDP_1953, 3)!;
    expect(to1).toBeLessThan(to2);
    expect(to2).toBeLessThan(to3);
  });

  it("costs about a rebuild to take one unit Legacy → Cutting-Edge", () => {
    const build = unitPurchasePrice({ cost: 1600 }, "DE", US_GDP_1953)!;
    const steps = ([1, 2, 3] as const).reduce(
      (sum, t) => sum + unitUpgradePrice({ cost: 1600 }, "DE", US_GDP_1953, t)!,
      0
    );
    expect(steps / build).toBeCloseTo(1.1, 2);
  });

  it("applies the same country cost scale as building does", () => {
    const de = unitUpgradePrice({ cost: 1600 }, "DE", US_GDP_1953, 3)!;
    const us = unitUpgradePrice({ cost: 1600 }, "US", US_GDP_1953, 3)!;
    expect(us).toBe(de * 2.6);
  });

  // Same rule as recruiting: a missing GDP must refuse, never price at zero.
  it("refuses when GDP is missing or non-positive rather than making upgrades free", () => {
    expect(unitUpgradePrice({ cost: 1600 }, "US", 0, 2)).toBeNull();
    expect(unitUpgradePrice({ cost: 1600 }, "US", null, 2)).toBeNull();
    expect(unitUpgradePrice({ cost: 1600 }, "US", undefined, 2)).toBeNull();
  });
});

describe("militaryPriceAnchor", () => {
  it("is the identity when GDP has not moved", () => {
    expect(militaryPriceAnchor(US_GDP_1953, US_GDP_1953)).toBe(US_GDP_1953);
  });

  it("absorbs only part of GDP growth", () => {
    // indexation 0.5 -> the anchor grows as the square root of the GDP ratio.
    const anchor = militaryPriceAnchor(US_GDP_1953 * 1.45, US_GDP_1953)!;
    expect(anchor / US_GDP_1953).toBeCloseTo(Math.sqrt(1.45), 6);
    expect(MILITARY_PRICE_INDEXATION).toBe(0.5);
  });

  // The safe degradation: an unmigrated budget must price exactly as it did pre-C1,
  // never at zero (which would make every unit free).
  it("falls back to live GDP when no baseline is recorded", () => {
    expect(militaryPriceAnchor(US_GDP_1953, null)).toBe(US_GDP_1953);
    expect(militaryPriceAnchor(US_GDP_1953, undefined)).toBe(US_GDP_1953);
    expect(militaryPriceAnchor(US_GDP_1953, 0)).toBe(US_GDP_1953);
    expect(militaryPriceAnchor(US_GDP_1953, -5)).toBe(US_GDP_1953);
  });

  it("refuses on a missing or non-positive live GDP", () => {
    expect(militaryPriceAnchor(null, US_GDP_1953)).toBeNull();
    expect(militaryPriceAnchor(undefined, US_GDP_1953)).toBeNull();
    expect(militaryPriceAnchor(0, US_GDP_1953)).toBeNull();
    expect(militaryPriceAnchor(-1, US_GDP_1953)).toBeNull();
  });
});

describe("anchored procurement pricing", () => {
  it("leaves prices untouched when no baseline is passed", () => {
    expect(unitPurchasePrice({ cost: 1600 }, "US", US_GDP_1953)).toBe(
      unitPurchasePrice({ cost: 1600 }, "US", US_GDP_1953, null)
    );
  });

  // The defect this exists to fix: under live-GDP pricing, price and accrual both scale
  // with GDP, so units-per-year reduces to defenceBurden / k and growth buys nothing.
  it("lets economic growth buy more units per year", () => {
    const grown = US_GDP_1953 * 1.45;
    const priceBefore = unitPurchasePrice({ cost: 1600 }, "US", US_GDP_1953, US_GDP_1953)!;
    const priceAfter = unitPurchasePrice({ cost: 1600 }, "US", grown, US_GDP_1953)!;
    // The defence line tracks GDP fully (x1.45); the price only x1.204.
    const unitsBefore = (US_GDP_1953 * 0.1364) / priceBefore;
    const unitsAfter = (grown * 0.1364) / priceAfter;
    expect(unitsAfter).toBeGreaterThan(unitsBefore * 1.15);
  });

  it("anchors tier upgrades on the same figure", () => {
    const grown = US_GDP_1953 * 1.45;
    const anchor = militaryPriceAnchor(grown, US_GDP_1953)!;
    expect(unitUpgradePrice({ cost: 1600 }, "DE", grown, 2, US_GDP_1953)).toBe(
      Math.round(anchor * ((1600 * UPGRADE_COST_SHARE[2]) / ARCHETYPE_COST_GDP_DIVISOR))
    );
  });

  it("still refuses on a missing live GDP even with a baseline present", () => {
    expect(unitPurchasePrice({ cost: 1600 }, "US", null, US_GDP_1953)).toBeNull();
    expect(unitUpgradePrice({ cost: 1600 }, "US", 0, 2, US_GDP_1953)).toBeNull();
  });
});

describe("manpowerCeiling", () => {
  it("is population x cap fraction x stance multiplier", () => {
    // manpowerPoolCapFraction is 0.02
    expect(manpowerCeiling(1_000_000, 1)).toBe(20_000);
    expect(manpowerCeiling(1_000_000, 2)).toBe(40_000);
  });

  it("floors fractional results", () => {
    expect(manpowerCeiling(1_001, 1)).toBe(20);
  });

  it("is zero for zero population", () => {
    expect(manpowerCeiling(0, 2)).toBe(0);
  });
});

describe("initialManpowerPool", () => {
  it("is a quarter of the ceiling", () => {
    expect(MANPOWER_START_FRACTION).toBe(0.25);
    expect(initialManpowerPool(1_000_000, 1)).toBe(manpowerCeiling(1_000_000, 1) / 4);
    expect(initialManpowerPool(1_000_000, 1)).toBe(5_000);
  });

  it("scales with the conscription stance, like the ceiling it derives from", () => {
    expect(initialManpowerPool(1_000_000, 2)).toBe(10_000);
  });

  it("floors fractional results", () => {
    // ceiling(1_001, 1) = 20 -> 25% = 5.0; ceiling(1_051,1) = 21 -> 5.25 -> 5
    expect(initialManpowerPool(1_051, 1)).toBe(5);
  });

  it("is zero for zero population", () => {
    expect(initialManpowerPool(0, 2)).toBe(0);
  });
});
