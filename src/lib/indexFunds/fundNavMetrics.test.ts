import { describe, expect, it } from "vitest";
import { buildFundNavMetrics, navChangeFromSnapshots } from "./fundNavMetrics";
import type { IndexFundSnapshot } from "@/lib/db/types";
import { ObjectId } from "mongodb";

function snap(turn: number, quotedNav: number): IndexFundSnapshot {
  return {
    _id: new ObjectId(),
    fundId: new ObjectId(),
    turn,
    quotedNav,
    unitSupply: 1000,
    cashAnchor: 0,
    totalHoldingsValueAnchor: 0,
    backingRatio: 1,
    targetConstituents: [],
    createdAt: new Date(),
  };
}

describe("navChangeFromSnapshots", () => {
  it("returns percent change vs prior turn", () => {
    const snapshots = [snap(10, 110), snap(9, 100)];
    expect(navChangeFromSnapshots(snapshots, 1)).toBeCloseTo(10, 5);
  });
});

describe("buildFundNavMetrics", () => {
  it("builds sparkline in chronological order", () => {
    const snapshots = [snap(2, 102), snap(1, 101)];
    const metrics = buildFundNavMetrics(snapshots);
    expect(metrics.sparkline.map((p) => p.turn)).toEqual([1, 2]);
    expect(metrics.sparkline.map((p) => p.quotedNav)).toEqual([101, 102]);
  });
});
