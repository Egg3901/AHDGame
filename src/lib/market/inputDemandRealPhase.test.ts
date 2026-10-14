import { describe, expect, it } from "vitest";
import { computeRawSupplyDemand, type CommodityType } from "@/lib/constants/commodities";
import {
  INPUT_DEMAND_PRICE_LEG_MAX,
  INPUT_DEMAND_REAL_PHASE_TURNS,
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
