import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { autoGrantedNodeIds } from "@/lib/constants/techTree";
import { CAPACITY_ANCHOR_YEAR } from "@/lib/constants/capacityEconomy";
import { ceoArchetypeModifiers } from "@/lib/turn/ceoArchetype";
import { maybePushNppTechUnlock, pickBestNppTechNode } from "./corpBehaviorConfig";
import { makeNppCorpDecision, type NppPlantsContext } from "../nppCorporationBehavior";
import type { Corporation, CorporateSector } from "@/lib/db/types";

const plants: NppPlantsContext = {
  enabled: true,
  eraUnitScale: 1,
  year: CAPACITY_ANCHOR_YEAR,
  preset: "2019-default",
  primeRateOf: () => 0,
  costOfLivingOf: () => null,
};

function corporation(): Corporation {
  return {
    _id: new ObjectId(),
    countryId: "US",
    type: "manufacturing",
    headquartersState: "CA",
    liquidCurrencyCode: "USD",
    liquidCapital: 3_000_000,
    ceoType: "npp",
    rdScore: 100_000,
    unlockedTechNodeIds: autoGrantedNodeIds("manufacturing", 2020),
  } as unknown as Corporation;
}

function sector(corporationId: ObjectId): CorporateSector {
  return {
    _id: new ObjectId(),
    corporationId,
    sectorType: "manufacturing",
    countryId: "US",
    stateId: "CA",
    revenue: 10_000_000,
    realizedRevenue: 10_000_000,
    profitMargin: 30,
    effectiveProfitMargin: 30,
    targetGrowthRate: 3,
    capitalStock: 1_000,
    producedUnits: 1_000,
    soldUnits: 1_000,
  } as unknown as CorporateSector;
}

describe("NPP tech spending budget", () => {
  it("prices an autonomous unlock from daily revenue without multiplying it by turns", () => {
    const corp = corporation();
    const corpUpdates: Parameters<typeof maybePushNppTechUnlock>[0]["corpUpdates"] = [];

    maybePushNppTechUnlock({
      corp,
      dailyGrossRevenueLocal: 10_000_000,
      techCurrentYear: 2020,
      turn: 200,
      now: new Date("2026-09-15T12:00:00Z"),
      corpUpdates,
    });

    expect(corpUpdates).toHaveLength(1);
    expect(corpUpdates[0].update.$inc?.liquidCapital).toBe(-1_500_000);
  });

  it("does not spend the opening cash twice after capacity reinvestment", () => {
    const corp = corporation();
    const decision = makeNppCorpDecision(
      {
        corp,
        sectors: [sector(corp._id)],
        turn: 200,
        now: new Date("2026-09-15T12:00:00Z"),
        fxRate: 1,
        modifiers: ceoArchetypeModifiers("cautious"),
        currentYear: 2020,
      },
      new Map(),
      new Set(),
      () => null,
      plants
    );

    const cashAfterCapacity = (corp.liquidCapital ?? 0) + decision.liquidCapitalDelta;
    const openingCashPick = pickBestNppTechNode(corp, 2020, 10_000_000);
    const techPick = pickBestNppTechNode(
      { ...corp, liquidCapital: cashAfterCapacity },
      2020,
      10_000_000,
      { cashReserve: decision.cashFloorLocal }
    );

    expect(decision.liquidCapitalDelta).toBeLessThan(0);
    expect(openingCashPick).not.toBeNull();
    expect(techPick).toBeNull();
  });
});
