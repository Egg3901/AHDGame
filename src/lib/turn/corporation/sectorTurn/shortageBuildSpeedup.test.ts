import { describe, expect, it } from "vitest";
import type { CommodityType } from "@/lib/constants/commodities";
import type { SectorBuildOrder } from "@/lib/db/types";
import {
  deliveredFraction,
  undeliveredCost,
  unitsDeliveredThisTurn,
} from "@/lib/corporations/buildDelivery";
import {
  acceleratedBuildWindow,
  sectorOutputUnmetShare,
  shortageBuildSpeedupOps,
} from "./shortageBuildSpeedup";

const order = (o: Partial<SectorBuildOrder> = {}): SectorBuildOrder => ({
  unitsOrdered: 4800,
  costPaidAnchor: 48_000,
  startTurn: 155,
  onlineTurn: 203,
  smooth: true,
  ...o,
});

describe("acceleratedBuildWindow", () => {
  it("keeps the delivered share at the current turn and halves the remaining time", () => {
    const o = order();
    const t = 191; // 36 of 48 turns elapsed, 12 left
    const next = acceleratedBuildWindow(o, t)!;
    expect(next.onlineTurn).toBe(197);
    const a = { ...o, ...next };
    expect(deliveredFraction(a, t)).toBeCloseTo(deliveredFraction(o, t), 10);
    expect(undeliveredCost(a, t)).toBeCloseTo(undeliveredCost(o, t), 6);
  });

  it("delivers exactly the ordered units, just sooner", () => {
    const o = order();
    const t = 191;
    const a = { ...o, ...acceleratedBuildWindow(o, t)! };
    let before = 0;
    for (let turn = o.startTurn; turn <= t; turn++) before += unitsDeliveredThisTurn(o, turn);
    let after = 0;
    for (let turn = t + 1; turn <= a.onlineTurn; turn++) after += unitsDeliveredThisTurn(a, turn);
    expect(before + after).toBeCloseTo(o.unitsOrdered, 6);
  });

  it("an order placed this turn simply takes half as long", () => {
    const o = order({ startTurn: 191, onlineTurn: 239 });
    expect(acceleratedBuildWindow(o, 191)).toEqual({ startTurn: 191, onlineTurn: 215 });
  });

  it("moves only the landing turn of an all-at-once order", () => {
    const o = order({ smooth: undefined });
    expect(acceleratedBuildWindow(o, 191)).toEqual({ startTurn: 155, onlineTurn: 197 });
  });

  it("never re-accelerates, and leaves orders due within a turn alone", () => {
    expect(acceleratedBuildWindow(order({ accelerated: true }), 191)).toBeNull();
    expect(acceleratedBuildWindow(order({ onlineTurn: 192 }), 191)).toBeNull();
  });
});

describe("shortageBuildSpeedupOps", () => {
  const short = new Map<CommodityType, { supply: number; demand: number }>([
    ["energy", { supply: 70, demand: 100 }],
  ]);
  const balanced = new Map<CommodityType, { supply: number; demand: number }>([
    ["energy", { supply: 100, demand: 100 }],
  ]);

  it("measures the sector's output-weighted unmet share", () => {
    expect(sectorOutputUnmetShare({ energy: 1 }, short)).toBeCloseTo(0.3, 10);
    expect(sectorOutputUnmetShare({ energy: 1 }, balanced)).toBe(0);
  });

  const run = (enabled: boolean, unmetShare: number) =>
    shortageBuildSpeedupOps({
      enabled,
      sectorId: "s1",
      outstanding: [order(), order({ accelerated: true, startTurn: 160, onlineTurn: 208 })],
      currentTurn: 191,
      unmetShare,
      now: new Date(0),
    });

  it("is inert when switched off or when the sector is not deeply short", () => {
    expect(run(false, 0.5)).toEqual([]);
    expect(run(true, 0.2)).toEqual([]);
  });

  it("emits one positional update per un-accelerated order, matched by identity", () => {
    const ops = run(true, 0.3);
    expect(ops).toHaveLength(1);
    expect(ops[0].updateOne.update.$set["buildQueue.$[o].onlineTurn"]).toBe(197);
    expect(ops[0].updateOne.update.$set["buildQueue.$[o].accelerated"]).toBe(true);
    expect(ops[0].updateOne.arrayFilters[0]).toMatchObject({
      "o.startTurn": 155,
      "o.onlineTurn": 203,
      "o.unitsOrdered": 4800,
    });
  });
});
