import { describe, expect, it } from "vitest";
import {
  CAPACITY_BUILD_TURNS,
  CAPACITY_SECTOR_TYPES,
  computeBuildCost,
} from "@/lib/constants/capacityEconomy";
import { deliveredFraction } from "@/lib/corporations/buildDelivery";
import {
  activeCapacityFraction,
  capacityUpkeepUnits,
  forecastSectorInvestment,
  investmentBuildTurns,
  type InvestmentForecastInput,
} from "./rules";

const forecastInput: InvestmentForecastInput = {
  units: 100,
  constructionPerUnitAnchor: 300,
  chargedPerUnitAnchor: 300,
  buildTurns: 1,
  depreciationPerTurn: 0,
  turnsPerDay: 24,
  capacityUnits: 1000,
  activeFraction: 1,
  producedUnits: 1000,
  soldUnits: 500,
  demandGapUnits: 1000,
  revenueDailyAnchor: 10000,
  operatingCostDailyAnchor: 4000,
  overheadDailyAnchor: 0,
  upkeepDailyAnchor: 0,
  taxRatePercent: 0,
};

describe("sector investment terms", () => {
  it("keeps founding prices independent of the ordinary expansion discount for every industry", () => {
    for (const sectorType of CAPACITY_SECTOR_TYPES) {
      const args = { sectorType, units: 100, year: 1966, eraUnitScale: 1, primeRate: 5 };
      const ordinary = computeBuildCost(args);
      const founding = computeBuildCost({ ...args, founding: true });
      expect(ordinary.expansionMultiplier).toBe(0.8);
      expect(founding.expansionMultiplier).toBe(1);
      expect(founding.totalAnchor).toBeCloseTo((ordinary.totalAnchor / 0.8) * 0.1, 6);
    }
  });

  it("halves heavy expansion and preserves all founding durations", () => {
    expect(CAPACITY_BUILD_TURNS("energy")).toBe(48);
    expect(CAPACITY_BUILD_TURNS("manufacturing")).toBe(36);
    expect(CAPACITY_BUILD_TURNS("retail")).toBe(12);
    for (const base of [12, 24, 36, 48, 60, 72, 84, 96]) {
      expect(investmentBuildTurns(base, true)).toBe(Math.ceil(base / 2));
    }
  });

  it("leaves a previously paid 96-turn order on its original ramp", () => {
    const order = {
      unitsOrdered: 100,
      costPaidAnchor: 1000,
      startTurn: 10,
      onlineTurn: 106,
      smooth: true,
    };
    expect(deliveredFraction(order, 58)).toBe(0.5);
    expect(deliveredFraction(order, 106)).toBe(1);
  });
});

describe("partial mothballing", () => {
  it("defaults existing plants to fully active and lets a whole mothball override the share", () => {
    expect(activeCapacityFraction({})).toBe(1);
    expect(activeCapacityFraction({ activeCapacityPercent: 25 })).toBe(0.25);
    expect(activeCapacityFraction({ mothballed: true, activeCapacityPercent: 25 })).toBe(0);
    expect(activeCapacityFraction({ activeCapacityPercent: NaN })).toBe(1);
  });

  it("does not double bill parked units as both cold and idle", () => {
    expect(
      capacityUpkeepUnits({
        capacity: 1000,
        activeFraction: 0.25,
        ownerIdleActiveUnits: 50,
        idleFraction: 0.3,
        coldFraction: 0.05,
        ramp: 1,
      })
    ).toBe(52.5);
    expect(
      capacityUpkeepUnits({
        capacity: 1000,
        activeFraction: 0,
        ownerIdleActiveUnits: 1000,
        idleFraction: 0.3,
        coldFraction: 0.05,
        ramp: 1,
      })
    ).toBe(50);
  });
});

describe("investment cash scenarios", () => {
  it("uses realized receipts once, without applying the 50% sales fill a second time", () => {
    const result = forecastSectorInvestment(forecastInput)!;
    expect(result[0].availableCashAnchor).toBeCloseTo(1200, 8);
    expect(result[0].cashReturnPercent).toBeCloseTo(4, 8);
    expect(result[0].soldUnitsDaily).toBe(50);
    expect(result.map((point) => point.turns)).toEqual([48, 96, 192]);
  });

  it("caps expected sales at available buyer demand", () => {
    const result = forecastSectorInvestment({ ...forecastInput, demandGapUnits: 40 })!;
    expect(result[0].soldUnitsDaily).toBe(40);
    expect(result[0].availableCashAnchor).toBeCloseTo(800, 8);
  });

  it("deducts overhead before tax and never gives loss-making expansion a tax refund", () => {
    const result = forecastSectorInvestment({
      ...forecastInput,
      overheadDailyAnchor: 1200,
      taxRatePercent: 25,
    })!;
    expect(result[0].overheadAnchor).toBeCloseTo(240, 8);
    expect(result[0].taxAnchor).toBeCloseTo(240, 8);
    expect(result[0].availableCashAnchor).toBeCloseTo(720, 8);
    const loss = forecastSectorInvestment({
      ...forecastInput,
      operatingCostDailyAnchor: 12000,
      taxRatePercent: 25,
    })!;
    expect(loss[0].taxAnchor).toBe(0);
    expect(loss[0].availableCashAnchor).toBeLessThan(0);
  });

  it("does not invent customers in a glut or count paid plant value as cash", () => {
    const result = forecastSectorInvestment({ ...forecastInput, demandGapUnits: 0 })!;
    expect(result[0].soldUnitsDaily).toBe(0);
    expect(result[0].availableCashAnchor).toBeCloseTo(-800, 8);
    expect(result[0].remainingPaidBasisAnchor).toBe(30000);
  });

  it("ramps delivery, depreciates owned units and separately reserves replacement cash", () => {
    const slow = forecastSectorInvestment({
      ...forecastInput,
      buildTurns: 96,
      depreciationPerTurn: 0.0005,
    })!;
    const fast = forecastSectorInvestment({
      ...forecastInput,
      buildTurns: 48,
      depreciationPerTurn: 0.0005,
    })!;
    expect(fast[0].availableCashAnchor).toBeGreaterThan(slow[0].availableCashAnchor);
    expect(slow[0].deliveredUnits).toBeLessThan(50);
    expect(slow[0].replacementReserveAnchor).toBeGreaterThan(0);
    expect(slow[0].remainingPaidBasisAnchor).toBeLessThan(30000);
  });

  it("withholds estimates without an observed run or with invalid inputs", () => {
    expect(forecastSectorInvestment({ ...forecastInput, producedUnits: 0 })).toBeNull();
    expect(forecastSectorInvestment({ ...forecastInput, chargedPerUnitAnchor: NaN })).toBeNull();
  });
});
