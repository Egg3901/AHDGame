import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { CommodityType } from "@/lib/constants/commodities";
import type { Corporation } from "@/lib/db/types";
import type { SectorClearingResult } from "@/lib/market/clearing";
import { getEffectiveStrategyRatesForOperatingModel } from "@/lib/constants/sectorStrategies";
import { scenario, runCase, SECTOR_ID } from "@/lib/test-utils/nppOperatingCapacityFixture";
describe("NPP operation at the authoritative production boundary", () => {
  it("reduces idle payroll while preserving sold output and paid capacity", () => {
    const baseline = scenario();
    baseline.env.lookups.engineSixCountries = new Set();
    const before = runCase(baseline);
    const after = runCase(scenario());
    expect(after.producedUnits).toBeCloseTo(before.producedUnits!, 2);
    expect(after.plantsPnl!.labour).toBeLessThan(before.plantsPnl!.labour / 2);
    expect(after.plantsPnl!.upkeep).toBeLessThan(before.plantsPnl!.upkeep);
    expect(after.capitalStock).toBe(before.capitalStock);
    expect(after.capacityBookAnchor).toBe(before.capacityBookAnchor);
  });

  it("reactivates before a new named buyer needs the parked plant", () => {
    const s = scenario({ activeCapacityPercent: 15 });
    s.env.market.contractProductionTargetBySectorId = new Map([[SECTOR_ID.toString(), 200]]);
    expect(runCase(s).producedUnits).toBe(200);
  });

  it("reactivates when current physical market demand exceeds supply", () => {
    const s = scenario({ activeCapacityPercent: 15 });
    for (const book of s.env.lookups.globalCommodityBalances.values()) book.demand = 2000;
    const full = scenario();
    for (const book of full.env.lookups.globalCommodityBalances.values()) book.demand = 2000;
    for (const c of [s, full])
      c.env.market.clearingBySectorId = new Map([
        [
          SECTOR_ID.toString(),
          {
            factor: 1,
            soldFraction: 1,
            soldByCommodity: { software: 1 },
            marketSupplyShareByCommodity: { software: 0.5 },
          } as SectorClearingResult,
        ],
      ]);
    full.env.lookups.engineSixCountries = new Set();
    expect(runCase(s).producedUnits).toBe(runCase(full).producedUnits);
  });

  it("restores full operation if current contract demand is unknown", () => {
    const s = scenario({ activeCapacityPercent: 15, producedUnits: 200, soldUnits: 200 });
    s.env.market.contractProductionTargetBySectorId = undefined;
    expect(runCase(s).producedUnits).toBe(230);
  });

  it("preserves player and caretaker operating choices", () => {
    const player = scenario({ activeCapacityPercent: 15 });
    player.corp.ceoType = "character";
    const caretaker = scenario({ activeCapacityPercent: 15 });
    caretaker.corp.caretakerCeo = {
      underlyingUserId: new ObjectId(),
    } as Corporation["caretakerCeo"];
    expect(runCase(player).producedUnits).toBeLessThan(100);
    expect(runCase(caretaker).producedUnits).toBeLessThan(100);
    expect(player.env.sectorOps).toHaveLength(1);
    expect(caretaker.env.sectorOps).toHaveLength(1);
  });
  it("keeps the measured input invoice unchanged while parking excess capacity", () => {
    const full = scenario();
    full.env.lookups.engineSixCountries = new Set();
    expect(runCase(scenario()).plantsPnl!.inputs).toBeCloseTo(runCase(full).plantsPnl!.inputs, 6);
  });

  it("restores full operation when an output book is missing", () => {
    const s = scenario({ activeCapacityPercent: 15, producedUnits: 200, soldUnits: 200 });
    s.env.lookups.globalCommodityBalances.clear();
    expect(runCase(s).producedUnits).toBe(230);
  });

  it("preserves output through a newly binding input shortage", () => {
    const s = scenario({ activeCapacityPercent: 15, producedUnits: 200, soldUnits: 200 });
    const full = scenario({ producedUnits: 200, soldUnits: 200 });
    full.env.lookups.engineSixCountries = new Set();
    const rates = getEffectiveStrategyRatesForOperatingModel(
      "technology",
      "software",
      undefined,
      undefined,
      1000
    );
    for (const c of [s, full])
      for (const commodity of Object.keys(rates.demand)) {
        c.env.lookups.globalCommodityBalances.set(commodity as CommodityType, {
          supply: 0,
          demand: 1000,
        });
      }
    expect(runCase(s).producedUnits).toBe(runCase(full).producedUnits);
  });

  it("preserves output when labour becomes scarce", () => {
    const s = scenario({
      activeCapacityPercent: 15,
      producedUnits: 200,
      soldUnits: 200,
      labourStaffingFactor: 0.5,
    });
    const full = scenario({ producedUnits: 200, soldUnits: 200, labourStaffingFactor: 0.5 });
    full.env.lookups.engineSixCountries = new Set();
    for (const c of [s, full]) c.env.lookups.labourTightnessByState.set("US-CA", 2);
    expect(runCase(s).producedUnits).toBe(runCase(full).producedUnits);
  });

  it("does not contract profitable full plants", () => {
    const s = scenario();
    s.sector.plantsPnl!.profit = 100;
    runCase(s);
    expect(s.env.sectorOps).toHaveLength(1);
  });

  it("reactivates as a parked plant sells more of its run", () => {
    const s = scenario({
      activeCapacityPercent: 25,
      demandThrottleFactor: 1,
      producedUnits: 100,
      soldUnits: 100,
    });
    expect(runCase(s).producedUnits).toBe(115);
  });

  it("preserves mixed-output shortage supply when just one leg is scarce", () => {
    const a = scenario({
      sectorType: "manufacturing",
      strategyId: "standard",
      activeCapacityPercent: 15,
      producedUnits: 200,
      soldUnits: 200,
    });
    const b = scenario({
      sectorType: "manufacturing",
      strategyId: "standard",
      producedUnits: 200,
      soldUnits: 200,
    });
    b.env.lookups.engineSixCountries = new Set();
    const rates = getEffectiveStrategyRatesForOperatingModel(
      "manufacturing",
      "standard",
      undefined,
      undefined,
      1000
    );
    for (const c of [a, b])
      for (const commodity of Object.keys(rates.supply)) {
        c.env.lookups.globalCommodityBalances.set(commodity as CommodityType, {
          supply: 1000,
          demand: 500,
        });
      }
    const first = Object.keys(rates.supply)[0] as CommodityType;
    for (const c of [a, b])
      c.env.lookups.globalCommodityBalances.set(first, { supply: 1000, demand: 2000 });
    expect(runCase(a).producedUnits).toBe(runCase(b).producedUnits);
  });
});
