import { describe, it, expect } from "vitest";
import {
  ATTACK_BUILD_PRICE_PREMIUM,
  ATTACK_CAPTURE_EFFICIENCY,
  capacityPricePerUnit,
  computeBuildCost,
} from "@/lib/constants/capacityEconomy";
import { ATTACK_OWNED_COST_FRACTION } from "@/lib/constants/corporations";
import type { CorporationType } from "@/lib/constants/corporations";
import {
  attackCostAnchorUnderPlants,
  capacityCaptureUnits,
  resolveWorldYear,
} from "./capacityCapture";
import { computeSectorImpliedUnits } from "@/lib/market/unownedHeadroom";

/**
 * ATTACKING MUST NEVER BE THE CHEAP WAY TO BUY A PLANT.
 *
 * Under plants an attack transfers capacity, so it is directly comparable with
 * the build queue: both end with `capitalStock` units in the attacker's sector.
 * If ₳-per-unit-acquired is lower through an attack, building is dominated and
 * the whole capacity economy collapses into a raiding game.
 */

const CASES: Array<{ sectorType: CorporationType; year: number }> = [
  { sectorType: "manufacturing", year: 1953 },
  { sectorType: "manufacturing", year: 2019 },
  { sectorType: "retail", year: 1953 },
  { sectorType: "retail", year: 2019 },
  { sectorType: "extraction", year: 1979 },
  { sectorType: "technology", year: 2019 },
];

describe("capacityCaptureUnits", () => {
  it("applies attrition: the attacker receives less than the defender loses", () => {
    const { unitsTaken, unitsReceived } = capacityCaptureUnits(1_000_000, "manufacturing", null, 1);
    expect(unitsTaken).toBeGreaterThan(0);
    expect(unitsReceived).toBeCloseTo(unitsTaken * ATTACK_CAPTURE_EFFICIENCY, 6);
    expect(unitsReceived).toBeLessThan(unitsTaken);
  });

  it("prices the capture on the defender's mix", () => {
    const captured = 500_000;
    const { unitsTaken } = capacityCaptureUnits(captured, "extraction", "coal_mining", 1);
    expect(unitsTaken).toBeCloseTo(
      computeSectorImpliedUnits("extraction", captured, "coal_mining", 1),
      6
    );
  });

  it("returns zero for a non-positive capture", () => {
    expect(capacityCaptureUnits(0, "retail", null, 1).unitsTaken).toBe(0);
    expect(capacityCaptureUnits(Number.NaN, "retail", null, 1).unitsReceived).toBe(0);
  });
});

describe("attack price vs build price, per unit acquired", () => {
  it.each(CASES)(
    "attacking is dearer than building — $sectorType @ $year",
    ({ sectorType, year }) => {
      // A representative defender: ₳1M/day of nameplate, standard mix.
      const targetRevenueAnchor = 1_000_000;
      // A representative capture: the contested fraction with neutral
      // multipliers and an even MS split (the usual case).
      const capturedAnchor = targetRevenueAnchor * 0.1 * 0.5;
      const { unitsReceived } = capacityCaptureUnits(capturedAnchor, sectorType, null, 1);

      const attackCost = attackCostAnchorUnderPlants({
        eraUnitScale: 1,
        legacyCostAnchor: targetRevenueAnchor * ATTACK_OWNED_COST_FRACTION,
        unitsReceived,
        sectorType,
        year,
      });
      const attackPerUnit = attackCost / unitsReceived;

      const build = computeBuildCost({ eraUnitScale: 1, sectorType, units: unitsReceived, year });
      const buildPerUnit = build.totalAnchor / unitsReceived;

      expect(attackPerUnit).toBeGreaterThan(buildPerUnit);
      // And by at least the documented premium, since the floor binds.
      expect(attackPerUnit).toBeGreaterThanOrEqual(
        buildPerUnit * ATTACK_BUILD_PRICE_PREMIUM * 0.99
      );
    }
  );

  it("documents WHY the floor exists: the legacy price alone is far too cheap", () => {
    // Modern era, neutral everything. Without the floor an attacker acquires
    // capacity for a small fraction of its build price — this assertion pins
    // the defect the floor fixes, so removing the floor fails loudly.
    const sectorType: CorporationType = "manufacturing";
    const year = 2019;
    const targetRevenueAnchor = 1_000_000;
    const capturedAnchor = targetRevenueAnchor * 0.1 * 0.5;
    const { unitsReceived } = capacityCaptureUnits(capturedAnchor, sectorType, null, 1);

    const legacyPerUnit = (targetRevenueAnchor * ATTACK_OWNED_COST_FRACTION) / unitsReceived;
    const buildPerUnit = capacityPricePerUnit(sectorType, year, 1);
    expect(legacyPerUnit).toBeLessThan(buildPerUnit);
  });

  it("never prices an attack below the legacy cost", () => {
    const legacy = 250_000;
    expect(
      attackCostAnchorUnderPlants({
        eraUnitScale: 1,
        legacyCostAnchor: legacy,
        unitsReceived: 0,
        sectorType: "retail",
        year: 1953,
      })
    ).toBe(legacy);
  });
});

describe("resolveWorldYear", () => {
  it("prefers an explicit year", () => {
    expect(resolveWorldYear(1963, 5000)).toBe(1963);
  });
  it("derives from the turn counter otherwise", () => {
    expect(resolveWorldYear(null, 1)).toBeGreaterThan(1900);
    expect(resolveWorldYear(undefined, 200)).toBeGreaterThan(resolveWorldYear(undefined, 1));
  });
});
