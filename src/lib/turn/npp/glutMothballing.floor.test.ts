import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import { buildNppGlutMothballUpdates } from "./glutMothballing";
import { glutStaggerEligible } from "./cohort";
import type { SectorProfitInfo } from "./sectorProfitability";
import {
  buildMarketSaturationIndex,
  marketSaturationOf,
  NPP_FLOOR_MOTHBALL_TURNS,
} from "./rules/marketSaturation";

const corp = { _id: new ObjectId(), countryId: "US" } as unknown as Corporation;
const eligibleTurn = (() => {
  for (let t = 0; t < 64; t += 1) if (glutStaggerEligible(corp._id.toString(), t)) return t;
  throw new Error("no stagger slot");
})();

const sp = (over: Partial<CorporateSector>): SectorProfitInfo => ({
  sector: {
    _id: new ObjectId(),
    stateId: "TN",
    countryId: "US",
    sectorType: "logistics",
    capitalStock: 100,
    soldFraction: 0.9,
    ...over,
  } as CorporateSector,
  income: -1,
  margin: -200,
  isProfitable: false,
  marginCategory: "loss",
});

// Shortage-priced everywhere, as on live turn 250: the price gates never fire.
const shortagePrices = () => 2.5;

const run = (sectors: SectorProfitInfo[], extra: SectorProfitInfo[] = []) => {
  const index = buildMarketSaturationIndex([...sectors, ...extra].map((s) => s.sector));
  return buildNppGlutMothballUpdates({
    corporation: corp,
    turn: eligibleTurn,
    now: new Date(0),
    plantsEnabled: true,
    sectorProfits: sectors,
    divestedSectorIds: [],
    priceRatioOf: shortagePrices,
    marketSaturationOf: (cell, excluding) => marketSaturationOf(index, cell, excluding),
  });
};

describe("floor-stuck mothballing", () => {
  it("mothballs a plant held at the throttle floor despite fill and price", () => {
    const stuck = sp({ demandThrottleFactor: 0.1, demandIdleTurns: NPP_FLOOR_MOTHBALL_TURNS });
    const updates = run([stuck, sp({ demandThrottleFactor: 1, pnlLossTurns: 0 })]);
    expect(updates).toHaveLength(1);
    expect(updates[0].filter).toEqual({ _id: stuck.sector._id });
    expect(updates[0].update).toMatchObject({ $set: { mothballed: true } });
  });

  it("leaves a deep-throttled plant alone before the streak runs", () => {
    const fresh = sp({ demandThrottleFactor: 0.1, demandIdleTurns: NPP_FLOOR_MOTHBALL_TURNS - 1 });
    expect(run([fresh])).toEqual([]);
  });

  it("does not restart into a cell whose rivals are floor-throttled", () => {
    const cold = sp({ mothballed: true, capitalStock: 500 });
    const rival = sp({ demandThrottleFactor: 0.1, demandIdleTurns: 0 });
    expect(run([cold], [rival])).toEqual([]);
  });

  it("still restarts on price when the rivals have room", () => {
    const cold = sp({ mothballed: true, capitalStock: 500 });
    const rival = sp({ demandThrottleFactor: 1 });
    const updates = run([cold], [rival]);
    expect(updates[0]?.update).toMatchObject({ $set: { mothballed: false } });
  });
});
