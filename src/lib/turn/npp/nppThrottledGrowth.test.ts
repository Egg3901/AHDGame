import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { Corporation, CorporateSector, UnownedSector } from "@/lib/db/types";
import { computeBuildCost, CAPACITY_ANCHOR_YEAR } from "@/lib/constants/capacityEconomy";
import { NEUTRAL_STAT } from "@/lib/stats/statsConstants";
import { ceoArchetypeModifiers } from "../ceoArchetype";
import { makeNppCorpDecision } from "./makeCorpDecision";
import { getNppCashFloorAnchor } from "./nppCashReserve";
import { NPP_GROWTH_MIN_THROTTLE } from "./nppCorporationTuning";

function decide(demandThrottleFactor: number | null, plantUnits = 80) {
  const modifiers = ceoArchetypeModifiers("cautious");
  const quote = computeBuildCost({
    sectorType: "retail",
    units: 1,
    strategyId: null,
    year: CAPACITY_ANCHOR_YEAR,
    preset: "2019-default",
    eraUnitScale: 1,
    marketSharePercent: (100 * plantUnits) / (plantUnits + 1000),
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
    liquidCapital: floor + quote.totalAnchor * 600,
    ceoType: "npp",
    ceoId: new ObjectId(),
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
    capitalStock: plantUnits,
    operatingCapacityUnits: plantUnits,
    producedUnits: plantUnits,
    soldUnits: plantUnits,
    buildQueue: [],
    ...(demandThrottleFactor === null ? {} : { demandThrottleFactor }),
  } as unknown as CorporateSector;
  const pool = {
    _id: new ObjectId(),
    countryId: "US",
    stateId: "NY",
    sectorType: "retail",
    revenue: 100000,
    headroomUnits: 1000,
  } as UnownedSector;
  return makeNppCorpDecision(
    {
      corp,
      groupRootId: "root",
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
}

const growthOf = (d: ReturnType<typeof decide>) =>
  (d.reinvestments ?? []).reduce((sum, build) => sum + build.units, 0);

describe("NPP growth in a throttled market", () => {
  it("grows when the sector is not throttled", () => {
    expect(growthOf(decide(1))).toBeGreaterThan(1);
    expect(growthOf(decide(null))).toBeGreaterThan(1);
    expect(growthOf(decide(NPP_GROWTH_MIN_THROTTLE))).toBeGreaterThan(1);
  });

  it("refuses growth below the throttle floor and records the gate", () => {
    const d = decide(0.5);
    // Replacement of worn capacity is below one whole unit here, so nothing builds.
    expect(growthOf(d)).toBeLessThan(1);
    expect(d.capacityObservations?.some((o) => o.outcome === "growth_throttled_market")).toBe(true);
  });

  it("still replaces worn capacity in a throttled market", () => {
    const d = decide(0.5, 100_000);
    expect(growthOf(d)).toBeGreaterThan(0);
    expect(growthOf(d)).toBeLessThan(growthOf(decide(1, 100_000)));
  });
});
