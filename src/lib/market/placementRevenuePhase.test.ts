import { describe, expect, it } from "vitest";
import { COMMODITY_BASE_PRICES } from "@/lib/constants/commodities";
import { computeClearingFactors } from "./clearing";
import {
  PLACEMENT_REVENUE_PHASE_TURNS,
  placementRevenueLeg,
  placementRevenuePhaseProgress,
} from "./placementRevenuePhase";

describe("placementRevenuePhase", () => {
  it("progress runs 0 to 1 over the phase and is 0 before a start is stamped", () => {
    expect(placementRevenuePhaseProgress(undefined, 200)).toBe(0);
    expect(placementRevenuePhaseProgress(200, 190)).toBe(0);
    expect(placementRevenuePhaseProgress(200, 200)).toBe(0);
    expect(placementRevenuePhaseProgress(200, 212)).toBeCloseTo(0.5, 10);
    expect(placementRevenuePhaseProgress(200, 200 + PLACEMENT_REVENUE_PHASE_TURNS + 5)).toBe(1);
  });

  it("leg is 1 before the phase, the placed share after it, linear between", () => {
    expect(placementRevenueLeg(0.1, 0)).toBe(1);
    expect(placementRevenueLeg(0.1, 1)).toBeCloseTo(0.1, 10);
    expect(placementRevenueLeg(0.1, 0.5)).toBeCloseTo(0.55, 10);
    expect(placementRevenueLeg(undefined, 1)).toBe(1);
    expect(placementRevenueLeg(Number.NaN, 1)).toBe(1);
  });
});

describe("computeClearingFactors with placementRevenuePhase", () => {
  // A mine whose state placed only 10% of its coal: the offer is shrunk to 10
  // units, ample demand buys all of them, so the offer is "100% sold".
  const run = (placementRevenuePhase?: number) =>
    computeClearingFactors({
      sectors: [
        {
          sectorId: "mine",
          revenue: 0,
          supplyRates: { coal: 1 },
          producedUnits: 100,
          posture: 0,
          offerPlacementByCommodity: { coal: 0.1 },
        },
      ],
      balances: new Map([["coal", { supply: 100, demand: 1000 }]]),
      priceRatioByCommodity: new Map(),
      basePrices: COMMODITY_BASE_PRICES,
      plantsEnabled: true,
      recordDelivery: true,
      ...(placementRevenuePhase === undefined ? {} : { placementRevenuePhase }),
    }).get("mine")!;

  it("without the phase, unplaced output still reads fully sold (the bug)", () => {
    const r = run();
    expect(r.soldFraction).toBeCloseTo(1, 6);
    expect(r.deliveredUnitsByCommodity?.coal).toBeCloseTo(10, 6);
  });

  it("at full phase, the sold fraction is the placed share of physical output", () => {
    const r = run(1);
    expect(r.soldFraction).toBeCloseTo(0.1, 6);
    expect(r.factor).toBeLessThan(run(0).factor);
  });

  it("half way through the phase, pay for unplaced output is half removed", () => {
    expect(run(0.5).soldFraction).toBeCloseTo(0.55, 6);
  });
});

describe("placementRevenuePhaseStartTurnFrom", () => {
  it("reads only an operator-set turn; absent means no phase", async () => {
    const { placementRevenuePhaseStartTurnFrom } = await import("./placementRevenuePhase");
    expect(placementRevenuePhaseStartTurnFrom(null)).toBeUndefined();
    expect(placementRevenuePhaseStartTurnFrom({})).toBeUndefined();
    expect(placementRevenuePhaseStartTurnFrom({ placementRevenuePhaseStartTurn: 205 })).toBe(205);
  });
});
