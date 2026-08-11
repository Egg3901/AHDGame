import { describe, it, expect } from "vitest";
import {
  CAPACITY_ANCHOR_YEAR,
  CAPACITY_BUILD_CANCEL_REFUND,
  CAPACITY_FOUNDING_DISCOUNT,
  IDLE_UPKEEP_FRACTION,
  MOTHBALL_UPKEEP_FRACTION,
  computeBuildCost,
  revenuePerCapacityUnit,
} from "./capacityEconomy";
import {
  GROWTH_COST_MULTIPLIER,
  acumenRateSensitivity,
  getDominanceGrowthCostMultiplier,
} from "./corporations";
import { NEUTRAL_STAT } from "@/lib/stats/statsConstants";

/**
 * P3a: the build price (`computeBuildCost`) and the founding affordability
 * gate. These are the numbers a player actually pays, so they are pinned
 * against hand-computed values rather than against the implementation.
 */

const RPU_MANUFACTURING = revenuePerCapacityUnit("manufacturing", 1);

describe("computeBuildCost", () => {
  it("is units × era price × dominance × rate, hand-computed", () => {
    // At the anchor year the era index is exactly 1, so the unit price is
    // GROWTH_COST_MULTIPLIER × RPU (identity B).
    const units = 1_000;
    const cost = computeBuildCost({
      eraUnitScale: 1,
      sectorType: "manufacturing",
      units,
      year: CAPACITY_ANCHOR_YEAR,
      marketSharePercent: 0,
      primeRate: 5,
      acumen: NEUTRAL_STAT,
    });
    // Neutral acumen ⇒ sensitivity 1 ⇒ rate multiplier 1 + 5/10 = 1.5.
    expect(acumenRateSensitivity(NEUTRAL_STAT)).toBeCloseTo(1, 10);
    expect(cost.rateMultiplier).toBeCloseTo(1.5, 10);
    expect(cost.dominanceMultiplier).toBeCloseTo(1, 10);
    expect(cost.unitPriceAnchor).toBeCloseTo(GROWTH_COST_MULTIPLIER * RPU_MANUFACTURING, 8);
    expect(cost.totalAnchor).toBeCloseTo(
      units * GROWTH_COST_MULTIPLIER * RPU_MANUFACTURING * 1.5,
      6
    );
  });

  it("charges the same dominance premium the growth path charges", () => {
    const share = 80;
    const cost = computeBuildCost({
      eraUnitScale: 1,
      sectorType: "manufacturing",
      units: 10,
      year: CAPACITY_ANCHOR_YEAR,
      marketSharePercent: share,
    });
    expect(cost.dominanceMultiplier).toBeCloseTo(getDominanceGrowthCostMultiplier(share), 10);
    expect(cost.dominanceMultiplier).toBeGreaterThan(1);
  });

  it("floors the rate multiplier at 0.5 and never goes negative on units", () => {
    // A very high acumen at a high prime rate cannot drive financing below 0.5×.
    const cheap = computeBuildCost({
      eraUnitScale: 1,
      sectorType: "manufacturing",
      units: 10,
      year: CAPACITY_ANCHOR_YEAR,
      primeRate: 0,
      acumen: 100,
    });
    expect(cheap.rateMultiplier).toBeGreaterThanOrEqual(0.5);
    const zero = computeBuildCost({
      eraUnitScale: 1,
      sectorType: "manufacturing",
      units: -5,
      year: CAPACITY_ANCHOR_YEAR,
    });
    expect(zero.totalAnchor).toBe(0);
  });

  it("prices later eras above the 1953 anchor", () => {
    const anchor = computeBuildCost({
      eraUnitScale: 1,
      sectorType: "manufacturing",
      units: 1,
      year: CAPACITY_ANCHOR_YEAR,
    });
    const modern = computeBuildCost({
      eraUnitScale: 1,
      sectorType: "manufacturing",
      units: 1,
      year: 2020,
    });
    expect(modern.totalAnchor).toBeGreaterThan(anchor.totalAnchor);
  });
});

describe("P3a upkeep / refund constants", () => {
  it("keeps mothballing cheaper than holding a plant idle, and cancellation lossy", () => {
    expect(MOTHBALL_UPKEEP_FRACTION).toBeLessThan(IDLE_UPKEEP_FRACTION);
    expect(CAPACITY_BUILD_CANCEL_REFUND).toBeGreaterThan(0);
    expect(CAPACITY_BUILD_CANCEL_REFUND).toBeLessThan(1);
  });

  it("refunds exactly the documented share of a cancelled order", () => {
    const paid = 1_000_000;
    expect(paid * CAPACITY_BUILD_CANCEL_REFUND).toBe(750_000);
  });
});

/**
 * FOUNDING CALIBRATION GATE.
 *
 * A new corp's first plant is ONE facility (`plantSizeUnits`). With the
 * founding discount that must fit inside a baseline era treasury and pay back
 * quickly — otherwise plants closes the game to new entrants.
 */
describe("founding calibration gate — one facility", () => {
  // Baseline 1953 corp treasury is ~14k; fee+build must clear that with room.
  const MAX_FOUNDING_ALL_IN_1953 = 14_000;
  const MAX_PAYBACK_FINANCIAL_DAYS = 30;
  const TYPICAL_MARGIN = 0.35;

  it("keeps fee + founding build inside a baseline 1953 treasury for every type", async () => {
    const { plantSizeUnits } = await import("@/lib/constants/facilityQuantum");
    const { sectorEntryFeeAnchor } = await import("@/lib/corporations/foundingPlant");
    const { getEraUnitScale } = await import("@/lib/constants/sectorSeedEra");
    const fee = sectorEntryFeeAnchor("1953-default");
    const eraScale = getEraUnitScale("1953-default");
    for (const type of [
      "manufacturing",
      "retail",
      "energy",
      "technology",
      "agriculture",
    ] as const) {
      const units = plantSizeUnits(type);
      const founding = computeBuildCost({
        eraUnitScale: eraScale,
        sectorType: type,
        units,
        year: CAPACITY_ANCHOR_YEAR,
        founding: true,
      });
      expect(founding.foundingMultiplier).toBe(CAPACITY_FOUNDING_DISCOUNT);
      expect(fee + founding.totalAnchor).toBeLessThanOrEqual(MAX_FOUNDING_ALL_IN_1953);
      const dailyRevenue = units * revenuePerCapacityUnit(type, eraScale);
      const paybackDays = founding.totalAnchor / (dailyRevenue * TYPICAL_MARGIN);
      expect(paybackDays).toBeLessThanOrEqual(MAX_PAYBACK_FINANCIAL_DAYS);
    }
  });

  it("still needs the founding discount — standing one-facility price is dearer", async () => {
    const { plantSizeUnits } = await import("@/lib/constants/facilityQuantum");
    const units = plantSizeUnits("manufacturing");
    const standing = computeBuildCost({
      eraUnitScale: 1,
      sectorType: "manufacturing",
      units,
      year: CAPACITY_ANCHOR_YEAR,
    });
    const founding = computeBuildCost({
      eraUnitScale: 1,
      sectorType: "manufacturing",
      units,
      year: CAPACITY_ANCHOR_YEAR,
      founding: true,
    });
    expect(standing.totalAnchor).toBeGreaterThan(founding.totalAnchor);
    expect(founding.totalAnchor).toBeCloseTo(standing.totalAnchor * CAPACITY_FOUNDING_DISCOUNT, 2);
  });
});
