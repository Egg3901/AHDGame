import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { Corporation, CorporateSector, UnownedSector } from "@/lib/db/types";
import { computeBuildCost, CAPACITY_ANCHOR_YEAR } from "@/lib/constants/capacityEconomy";
import { NEUTRAL_STAT } from "@/lib/stats/statsConstants";
import { ceoArchetypeModifiers } from "../ceoArchetype";
import { makeNppCorpDecision } from "./makeCorpDecision";
import { getNppCashFloorAnchor } from "./nppCashReserve";

describe("existing autonomous plant top-ups", () => {
  it("places an affordable sub-facility order without spending its cash reserve", () => {
    const modifiers = ceoArchetypeModifiers("cautious");
    const quote = computeBuildCost({
      sectorType: "retail",
      units: 1,
      year: CAPACITY_ANCHOR_YEAR,
      preset: "2019-default",
      eraUnitScale: 1,
      marketSharePercent: (100 * 80) / 1080,
      nationalMarketSharePercent: 0,
      primeRate: 0,
      acumen: NEUTRAL_STAT,
      hostCostOfLivingIndex: null,
      founding: false,
    });
    const floor = getNppCashFloorAnchor("2019-default", modifiers.cashFloorMult);
    const corp = {
      _id: new ObjectId(),
      type: "retail",
      countryId: "US",
      headquartersState: "NY",
      liquidCurrencyCode: "USD",
      liquidCapital: floor + quote.totalAnchor * 60,
      ceoType: "npp",
      logisticsStrength: 1000,
    } as Corporation;
    const sector = {
      _id: new ObjectId(),
      corporationId: corp._id,
      sectorType: "retail",
      countryId: "US",
      stateId: "NY",
      revenue: 100000,
      profitMargin: 10,
      plantsPnl: { revenue: 100000, costs: 90000, profit: 10000 },
      capitalStock: 80,
      operatingCapacityUnits: 80,
      producedUnits: 80,
      soldUnits: 80,
      buildQueue: [],
    } as unknown as CorporateSector;
    const pool = {
      _id: new ObjectId(),
      countryId: "US",
      stateId: "NY",
      sectorType: "retail",
      revenue: 100000,
      headroomUnits: 1000,
    } as UnownedSector;
    const decision = makeNppCorpDecision(
      {
        corp,
        sectors: [sector],
        turn: 70,
        now: new Date("2026-01-01"),
        modifiers,
        strategyLoopEnabled: false,
      },
      new Map([["US", [pool]]]),
      new Set(),
      () => 2,
      {
        enabled: true,
        eraUnitScale: 1,
        year: CAPACITY_ANCHOR_YEAR,
        preset: "2019-default",
        primeRateOf: () => 0,
        costOfLivingOf: () => null,
      }
    );
    const growth = (decision.reinvestments ?? []).reduce((sum, build) => sum + build.units, 0);
    // Maintenance alone is less than one unit in this fixture.
    expect(growth).toBeGreaterThan(1);
    expect(growth).toBeLessThan(80);
    expect(corp.liquidCapital + decision.liquidCapitalDelta).toBeGreaterThanOrEqual(floor);
  });
});
