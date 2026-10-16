import { describe, expect, it } from "vitest";
import { advanceProducerCapacity, type ProducerCapacityState } from "./capacityRules";
import { CAPITAL_DEPRECIATION_PER_TURN } from "@/lib/market/capital";
import { TURNS_PER_DAY } from "@/lib/constants/turnTime";

const advance = (state: ProducerCapacityState, activeFraction = 1, operatingRecipeRatio = 1) =>
  advanceProducerCapacity({
    state,
    turn: state.completedTurn + 1,
    activeFraction,
    operatingRecipeRatio,
    recessionCapacityFactor: 1,
  });

describe("owned producer capacity", () => {
  it("preserves accelerated fractional schedules and secured claims without resetting delivery", () => {
    const order = {
      unitsOrdered: 100,
      costPaidAnchor: 50,
      startTurn: 0.5,
      onlineTurn: 3,
      smooth: true,
      constructionLoanId: "loan",
      constructionClaimId: "claim",
    };
    const next = advance({
      completedTurn: 1,
      ownedDailyUnits: 20,
      paidBookAnchor: 10,
      buildQueue: [order],
    });
    expect(next.deliveredDailyUnits).toBeCloseTo(40, 12);
    expect(next.deliveredPaidCostAnchor).toBeCloseTo(20, 12);
    expect(next.constructionInProgressAnchor).toBeCloseTo(20, 12);
    expect(next.state.buildQueue).toEqual([order]);
    expect(
      next.state.paidBookAnchor + next.constructionInProgressAnchor + next.depreciationAnchor
    ).toBeCloseTo(50, 12);
    const last = advance(next.state);
    expect(last.deliveredDailyUnits).toBeCloseTo(40, 12);
    expect(last.state.buildQueue).toEqual([]);
  });

  it("conserves paid construction across gradual deliveries and depreciation", () => {
    let state: ProducerCapacityState = {
      completedTurn: 10,
      ownedDailyUnits: 0,
      paidBookAnchor: 0,
      buildQueue: [
        { unitsOrdered: 240, costPaidAnchor: 480, startTurn: 10, onlineTurn: 14, smooth: true },
      ],
    };
    let depreciation = 0;
    let delivered = 0;
    for (let turn = 11; turn <= 14; turn++) {
      const next = advance(state);
      depreciation += next.depreciationAnchor;
      delivered += next.deliveredDailyUnits;
      expect(next.state.paidBookAnchor / next.state.ownedDailyUnits).toBeCloseTo(2, 12);
      expect(
        next.state.paidBookAnchor + next.constructionInProgressAnchor + depreciation
      ).toBeCloseTo(480, 10);
      expect(next.capacityUnits * TURNS_PER_DAY).toBe(next.state.ownedDailyUnits);
      state = next.state;
    }
    expect(delivered).toBe(240);
    expect(state.buildQueue).toEqual([]);
    expect(advance(state).deliveredDailyUnits).toBe(0);
  });

  it("parks output without deleting stock, and applies retool ratios only to operation", () => {
    const opening = { completedTurn: 2, ownedDailyUnits: 240, paidBookAnchor: 100, buildQueue: [] };
    const active = advance(opening, 1, 3);
    const parked = advance(opening, 0, 3);
    expect(parked.state).toEqual(active.state);
    expect(parked.activeUnits).toBe(0);
    expect(active.state.ownedDailyUnits).toBe(240 * (1 - CAPITAL_DEPRECIATION_PER_TURN));
    expect(active.capacityUnits).toBeCloseTo((active.state.ownedDailyUnits * 3) / TURNS_PER_DAY);
  });

  it("delivers a scheduled single tranche once and retains its actual paid basis", () => {
    const next = advance({
      completedTurn: 6,
      ownedDailyUnits: 100,
      paidBookAnchor: 50,
      buildQueue: [{ unitsOrdered: 80, costPaidAnchor: 10, startTurn: 3, onlineTurn: 7 }],
    });
    expect(next.deliveredDailyUnits).toBe(80);
    expect(next.state.paidBookAnchor).toBeCloseTo(60 * (1 - CAPITAL_DEPRECIATION_PER_TURN));
    expect(advance(next.state).deliveredDailyUnits).toBe(0);
  });

  it("refuses replay, skipped turns, phantom basis and already-delivered orders", () => {
    const state = { completedTurn: 3, ownedDailyUnits: 0, paidBookAnchor: 0, buildQueue: [] };
    for (const turn of [3, 5])
      expect(() =>
        advanceProducerCapacity({
          state,
          turn,
          activeFraction: 1,
          operatingRecipeRatio: 1,
          recessionCapacityFactor: 1,
        })
      ).toThrow("next unsettled turn");
    expect(() => advance({ ...state, paidBookAnchor: 1 })).toThrow("reconciliation");
    expect(() =>
      advance({
        ...state,
        buildQueue: [{ unitsOrdered: 1, costPaidAnchor: 1, startTurn: 1, onlineTurn: 3 }],
      })
    ).toThrow("schedule");
  });
});
