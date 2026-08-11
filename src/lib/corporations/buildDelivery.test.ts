import { describe, expect, it } from "vitest";
import type { SectorBuildOrder } from "@/lib/db/types";
import {
  costReleasedThisTurn,
  deliveredFraction,
  queueUndeliveredCost,
  undeliveredCost,
  undeliveredUnits,
  unitsDeliveredThisTurn,
} from "@/lib/corporations/buildDelivery";

function smooth(partial: Partial<SectorBuildOrder> = {}): SectorBuildOrder {
  return {
    unitsOrdered: 100,
    costPaidAnchor: 1_000,
    startTurn: 0,
    onlineTurn: 100,
    smooth: true,
    ...partial,
  };
}

function legacy(partial: Partial<SectorBuildOrder> = {}): SectorBuildOrder {
  return { unitsOrdered: 100, costPaidAnchor: 1_000, startTurn: 0, onlineTurn: 100, ...partial };
}

describe("buildDelivery — smooth orders ramp linearly", () => {
  it("delivers a proportional slice of units every turn", () => {
    const o = smooth();
    expect(unitsDeliveredThisTurn(o, 1)).toBeCloseTo(1, 9); // 1/100 of 100
    expect(unitsDeliveredThisTurn(o, 50)).toBeCloseTo(1, 9);
    expect(unitsDeliveredThisTurn(o, 100)).toBeCloseTo(1, 9); // the final slice
  });

  it("delivers nothing before it starts and nothing after it lands", () => {
    const o = smooth({ startTurn: 10, onlineTurn: 110 });
    expect(unitsDeliveredThisTurn(o, 10)).toBe(0); // start turn: 0 so far
    expect(unitsDeliveredThisTurn(o, 200)).toBe(0); // long done
  });

  it("the per-turn slices telescope to exactly the whole order", () => {
    const o = smooth({ unitsOrdered: 100, onlineTurn: 100 });
    let sum = 0;
    for (let t = 1; t <= 100; t++) sum += unitsDeliveredThisTurn(o, t);
    expect(sum).toBeCloseTo(100, 6);
  });

  it("releases cost in lockstep with units", () => {
    const o = smooth({ costPaidAnchor: 1_000, onlineTurn: 100 });
    let sum = 0;
    for (let t = 1; t <= 100; t++) sum += costReleasedThisTurn(o, t);
    expect(sum).toBeCloseTo(1_000, 6);
  });

  it("reports the not-yet-built remainder as undelivered", () => {
    const o = smooth({ unitsOrdered: 100, costPaidAnchor: 1_000, onlineTurn: 100 });
    expect(deliveredFraction(o, 25)).toBeCloseTo(0.25, 9);
    expect(undeliveredUnits(o, 25)).toBeCloseTo(75, 9);
    expect(undeliveredCost(o, 25)).toBeCloseTo(750, 9);
    expect(undeliveredCost(o, 100)).toBeCloseTo(0, 9);
  });
});

describe("buildDelivery — legacy orders keep all-at-once landing", () => {
  it("delivers zero until the online turn, then the whole order", () => {
    const o = legacy({ onlineTurn: 100 });
    expect(unitsDeliveredThisTurn(o, 50)).toBe(0);
    expect(unitsDeliveredThisTurn(o, 100)).toBe(100);
    expect(costReleasedThisTurn(o, 100)).toBe(1_000);
  });

  it("holds full cost in CIP until it lands", () => {
    const o = legacy({ onlineTurn: 100 });
    expect(undeliveredCost(o, 99)).toBe(1_000);
    expect(undeliveredUnits(o, 99)).toBe(100);
    expect(undeliveredCost(o, 100)).toBe(0);
  });

  it("a degenerate zero-window smooth order falls back to all-at-once", () => {
    const o = smooth({ startTurn: 100, onlineTurn: 100 });
    expect(unitsDeliveredThisTurn(o, 100)).toBe(100);
  });
});

describe("buildDelivery — queueUndeliveredCost", () => {
  it("sums the undelivered cost across mixed orders", () => {
    const q = [
      smooth({ costPaidAnchor: 1_000, startTurn: 0, onlineTurn: 100 }), // 25% done → 750 left
      legacy({ costPaidAnchor: 500, onlineTurn: 200 }), // not landed → 500 left
    ];
    expect(queueUndeliveredCost(q, 25)).toBeCloseTo(750 + 500, 6);
  });
});
