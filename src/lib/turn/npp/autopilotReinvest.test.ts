import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { Corporation, CorporateSector, UnownedSector } from "@/lib/db/types";
import { CAPACITY_ANCHOR_YEAR } from "@/lib/constants/capacityEconomy";
import { AUTOPILOT_MODIFIERS } from "@/lib/corporations/autopilot";
import { ceoArchetypeModifiers } from "../ceoArchetype";
import { makeNppCorpDecision } from "./makeCorpDecision";
import {
  AUTOPILOT_CAPEX_CASH_SHARE,
  AUTOPILOT_GROWTH_STEP_OF_RUN,
  AUTOPILOT_PAYBACK_HORIZON_TURNS,
  evaluateAutopilotGrowthGate,
} from "./rules/autopilotReinvest";
import { getNppCashFloorAnchor } from "./nppCashReserve";

const CASH = 36_800_000;
const PLANTS = {
  enabled: true,
  eraUnitScale: 1,
  year: CAPACITY_ANCHOR_YEAR,
  preset: "2019-default",
  primeRateOf: () => 0,
  costOfLivingOf: () => null,
} as const;

/** Four large, fully sold-out, profitable plants, as on the reported corp. */
function fixture(profitPerTurn: number, autopilot: boolean) {
  const corp = {
    _id: new ObjectId(),
    type: "energy",
    countryId: "US",
    headquartersState: "ND",
    liquidCurrencyCode: "USD",
    liquidCapital: CASH,
    ceoType: autopilot ? "character" : "npp",
    ceoId: new ObjectId(),
    userId: autopilot ? new ObjectId() : undefined,
    autopilot: autopilot ? { enabledTurn: 1 } : undefined,
    logisticsStrength: 1000,
  } as unknown as Corporation;
  const specs: Array<[string, string, number]> = [
    ["energy", "ND", 52_528],
    ["energy", "WY", 53_976],
    ["energy", "TX", 35_132],
    ["chemical_industries", "NY", 3_090],
  ];
  const sectors = specs.map(
    ([sectorType, stateId, units]) =>
      ({
        _id: new ObjectId(),
        corporationId: corp._id,
        sectorType,
        countryId: "US",
        stateId,
        revenue: profitPerTurn * 3,
        profitMargin: 33,
        plantsPnl: { revenue: profitPerTurn * 3, costs: profitPerTurn * 2, profit: profitPerTurn },
        capitalStock: units,
        operatingCapacityUnits: units,
        producedUnits: units,
        soldUnits: units,
        buildQueue: [],
      }) as unknown as CorporateSector
  );
  const pools = specs.map(
    ([sectorType, stateId]) =>
      ({
        _id: new ObjectId(),
        countryId: "US",
        stateId,
        sectorType,
        revenue: 1,
        headroomUnits: 1_000_000,
      }) as UnownedSector
  );
  return { corp, sectors, pools };
}

function run(profitPerTurn: number, autopilot: boolean) {
  const { corp, sectors, pools } = fixture(profitPerTurn, autopilot);
  const decision = makeNppCorpDecision(
    {
      corp,
      sectors,
      turn: 242,
      now: new Date("2026-01-01"),
      modifiers: autopilot ? AUTOPILOT_MODIFIERS : ceoArchetypeModifiers("cautious"),
      strategyLoopEnabled: false,
    },
    new Map([["US", pools]]),
    new Set(),
    () => 2,
    PLANTS
  );
  return { decision, sectors, corp };
}

/** Only the wear-replacement leg (a sliver of the plant) may be ordered. */
function expectNoGrowth(decision: ReturnType<typeof run>["decision"], sectors: CorporateSector[]) {
  for (const b of decision.reinvestments ?? []) {
    const sector = sectors.find((s) => s._id.equals(b.sectorId))!;
    expect(b.units).toBeLessThan((sector.capitalStock ?? 0) * 0.002);
  }
}

describe("autopilot reinvestment", () => {
  it("grows each sector by a small step and spends a capped share of cash", () => {
    const { decision, sectors } = run(5_000_000, true);
    const builds = decision.reinvestments ?? [];
    expect(builds.length).toBeGreaterThan(0);
    for (const b of builds) {
      const sector = sectors.find((s) => s._id.equals(b.sectorId))!;
      const cap = (sector.capitalStock ?? 0) * (AUTOPILOT_GROWTH_STEP_OF_RUN + 0.01);
      expect(b.units).toBeLessThanOrEqual(cap);
    }
    const spent = builds.reduce((sum, b) => sum + b.costLocal, 0);
    const floor = getNppCashFloorAnchor("2019-default", AUTOPILOT_MODIFIERS.cashFloorMult);
    expect(spent).toBeLessThanOrEqual((CASH - floor) * AUTOPILOT_CAPEX_CASH_SHARE + 1);
    expect(spent / CASH).toBeLessThan(0.16);
  });

  it("rejects a build that cannot pay back, with the new gate reason", () => {
    const { decision, sectors } = run(1, true);
    expectNoGrowth(decision, sectors);
    const gates = (decision.capacityObservations ?? []).map((o) => o.outcome);
    expect(gates).toContain("autopilot_no_payback");
  });

  it("rejects growth while the sector has no profit", () => {
    const { decision, sectors } = run(0, true);
    expectNoGrowth(decision, sectors);
  });

  it("leaves a non-autopilot NPP corp sized as before", () => {
    const { decision } = run(5_000_000, false);
    const total = (decision.reinvestments ?? []).reduce((sum, b) => sum + b.units, 0);
    // Numbers captured before the autopilot change: growth is half of run capacity.
    expect((decision.reinvestments ?? []).map((b) => [b.units, Math.round(b.costLocal)])).toEqual([
      [27014.988, 5984859],
      [26290.264, 5824305],
      [17583.566, 3895436],
      [1546.545, 1532037],
    ]);
    expect(total).toBeCloseTo(72435.363, 3);
  });
});

describe("evaluateAutopilotGrowthGate", () => {
  const base = {
    sectorProfitLocal: 1000,
    operatingCapacityUnits: 100,
    corpEarningsLocal: 1,
    growthUnits: 5,
    growthCostLocal: 5 * 10 * AUTOPILOT_PAYBACK_HORIZON_TURNS,
    demandHeadroomUnits: 100,
  };
  it("passes at exactly the payback horizon", () => {
    expect(evaluateAutopilotGrowthGate(base)).toBeNull();
  });
  it("fails just beyond the horizon", () => {
    expect(
      evaluateAutopilotGrowthGate({ ...base, growthCostLocal: base.growthCostLocal + 1 })
    ).toBe("autopilot_no_payback");
  });
  it("requires a profitable sector and positive corp earnings", () => {
    expect(evaluateAutopilotGrowthGate({ ...base, sectorProfitLocal: 0 })).toBe(
      "autopilot_unprofitable"
    );
    expect(evaluateAutopilotGrowthGate({ ...base, corpEarningsLocal: 0 })).toBe(
      "autopilot_unprofitable"
    );
  });
  it("requires demand headroom", () => {
    expect(evaluateAutopilotGrowthGate({ ...base, demandHeadroomUnits: 0 })).toBe(
      "autopilot_demand_headroom"
    );
  });
});
