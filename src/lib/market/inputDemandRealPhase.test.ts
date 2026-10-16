import { describe, expect, it } from "vitest";
import {
  COMMODITY_BASE_PRICES,
  SECTOR_DEMAND,
  computeRawSupplyDemand,
  type CommodityType,
} from "@/lib/constants/commodities";
import { computeInputsCost } from "@/lib/corporations/physicalPnl";
import {
  INPUT_DEMAND_PRICE_LEG_MAX,
  INPUT_DEMAND_REAL_PHASE_TURNS,
  effectiveInputDemandRealPhase,
  inputDemandDeflator,
  inputDemandRealPhaseProgress,
  inputDemandRealPhaseStartTurnFrom,
  sectorPriceLeg,
} from "./inputDemandRealPhase";

describe("inputDemandRealPhaseProgress", () => {
  it("is 0 before the start, ramps linearly, and holds at 1", () => {
    expect(inputDemandRealPhaseProgress(undefined, 200)).toBe(0);
    expect(inputDemandRealPhaseProgress(200, 199)).toBe(0);
    expect(inputDemandRealPhaseProgress(200, 212)).toBeCloseTo(12 / INPUT_DEMAND_REAL_PHASE_TURNS);
    expect(inputDemandRealPhaseProgress(200, 400)).toBe(1);
  });
});

describe("sectorPriceLeg", () => {
  it("is clearing factor over sold fraction, null when unknown", () => {
    expect(sectorPriceLeg(1.8, 0.9)).toBeCloseTo(2, 10);
    expect(sectorPriceLeg(undefined, 0.9)).toBeNull();
    expect(sectorPriceLeg(1.8, 0)).toBeNull();
    expect(sectorPriceLeg(Number.NaN, 1)).toBeNull();
  });
});

describe("inputDemandDeflator", () => {
  it("is 1 before the phase and the price leg once complete", () => {
    expect(inputDemandDeflator(2, 0)).toBe(1);
    expect(inputDemandDeflator(2, 0.5)).toBeCloseTo(1.5, 10);
    expect(inputDemandDeflator(2, 1)).toBeCloseTo(2, 10);
  });

  it("clamps outlier legs and ignores missing ones", () => {
    expect(inputDemandDeflator(38, 1)).toBe(INPUT_DEMAND_PRICE_LEG_MAX);
    expect(inputDemandDeflator(null, 1)).toBe(1);
  });
});

describe("inputDemandRealPhaseStartTurnFrom", () => {
  it("reads only an operator-set numeric start turn", () => {
    expect(inputDemandRealPhaseStartTurnFrom(null)).toBeUndefined();
    expect(inputDemandRealPhaseStartTurnFrom({})).toBeUndefined();
    expect(inputDemandRealPhaseStartTurnFrom({ inputDemandRealPhaseStartTurn: 201 })).toBe(201);
  });
});

describe("computeRawSupplyDemand input demand under the phase", () => {
  const demandFor = (phase: number, priceLeg: number | null) => {
    const args = [
      [{ sectorType: "manufacturing", revenue: 1_000_000, stateId: "S1", priceLeg }],
      ...Array.from({ length: 17 }, () => undefined),
      phase,
    ] as unknown as Parameters<typeof computeRawSupplyDemand>;
    const inputs = computeRawSupplyDemand(...args).productionInputDemandByState.get("S1");
    let total = 0;
    for (const [, v] of inputs ?? new Map<CommodityType, number>()) total += v;
    return total;
  };

  it("leaves demand unchanged before the phase starts", () => {
    expect(demandFor(0, 2)).toBeCloseTo(demandFor(0, null), 6);
  });

  it("divides revenue-driven input demand by the price leg at full phase", () => {
    const base = demandFor(0, 2);
    expect(base).toBeGreaterThan(0);
    expect(demandFor(1, 2)).toBeCloseTo(base / 2, 6);
    expect(demandFor(0.5, 2)).toBeCloseTo(base / 1.5, 6);
  });

  it("does not deflate a sector with no recorded price leg", () => {
    expect(demandFor(1, null)).toBeCloseTo(demandFor(0, null), 6);
  });
});

describe("effectiveInputDemandRealPhase", () => {
  it("passes legacy progress through, clamped", () => {
    expect(effectiveInputDemandRealPhase(0.5, false)).toBe(0.5);
    expect(effectiveInputDemandRealPhase(3, false)).toBe(1);
    expect(effectiveInputDemandRealPhase(undefined, false)).toBe(0);
  });

  it("never deflates a plants world", () => {
    expect(effectiveInputDemandRealPhase(1, true)).toBe(0);
    expect(effectiveInputDemandRealPhase(0.5, true)).toBe(0);
  });
});

describe("plants ledger input demand equals the billed input units", () => {
  // Invariant: under plants, the units the world ledger books as a sector's
  // input demand are the units computeInputsCost bills it for (producedUnits x
  // recipe), whatever its realized price and sold share. Both plants here made
  // output they did not sell (soldFraction < 1) and both realized above base
  // (clearing factor over sold fraction > 1). Persisted revenue is the
  // base-priced capacity nameplate, as sectorTurn writes it.
  const plants = [
    {
      sectorType: "manufacturing",
      revenue: 1_000_000,
      stateId: "S1",
      sectorId: "plant-mfg",
      priceLeg: sectorPriceLeg(1.5, 0.75),
      producedUnits: 600,
      capacityUnits: 1_000,
    },
    {
      sectorType: "energy",
      revenue: 2_500_000,
      stateId: "S1",
      sectorId: "plant-energy",
      priceLeg: sectorPriceLeg(2.28, 0.95),
      producedUnits: 1_000,
      capacityUnits: 1_250,
    },
  ] as const;

  const ledgerBySector = (phase: number) => {
    const sectorUnitsOut = {
      supplyBySector: new Map<string, Map<CommodityType, number>>(),
      inputDemandBySector: new Map<string, Map<CommodityType, number>>(),
    };
    const args = [
      plants,
      ...Array.from({ length: 8 }, () => undefined),
      true, // plantsEnabled
      1, // ledgerUnitScale
      ...Array.from({ length: 5 }, () => undefined),
      sectorUnitsOut,
      undefined, // retailGdpParams
      phase,
    ] as unknown as Parameters<typeof computeRawSupplyDemand>;
    computeRawSupplyDemand(...args);
    return sectorUnitsOut.inputDemandBySector;
  };

  const billedFor = (plant: (typeof plants)[number]) =>
    computeInputsCost({
      nominalDailyRevenue: plant.revenue,
      rates: Object.fromEntries(
        (SECTOR_DEMAND[plant.sectorType] ?? []).map((f) => [f.commodity, f.rate])
      ) as Partial<Record<CommodityType, number>>,
      basePrices: COMMODITY_BASE_PRICES,
      priceRatios: new Map(),
      utilization: plant.producedUnits / plant.capacityUnits,
      inputMultiplier: 1,
      turnsPerDay: 1,
    });

  it("fixtures realize above base with unsold output", () => {
    for (const plant of plants) {
      expect(plant.priceLeg ?? 0).toBeGreaterThan(1.5);
    }
  });

  for (const phase of [0, 1]) {
    it(`books exactly the billed input units per sector at phase progress ${phase}`, () => {
      const ledger = ledgerBySector(phase);
      for (const plant of plants) {
        const bill = billedFor(plant);
        expect(bill.lines.length).toBeGreaterThan(0);
        const booked = ledger.get(plant.sectorId) ?? new Map<CommodityType, number>();
        expect([...booked.keys()].sort()).toEqual(bill.lines.map((l) => l.commodity).sort());
        for (const line of bill.lines) {
          expect(booked.get(line.commodity) ?? 0).toBeCloseTo(line.units, 6);
        }
      }
    });
  }
});
