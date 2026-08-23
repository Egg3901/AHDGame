import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import { buildMarketContext } from "@/lib/market/marketContext";
import type { CorporationLookups } from "./types";
import { processSector, type SectorTurnEnv } from "./sectorTurn";
import {
  LABOUR_STAFFING_MAX_TURN_MOVE,
  staffingFactorFromTightness,
} from "@/lib/labour/labourMarket";

/**
 * Phase 2 labour rationing, end to end through `processSector`.
 *
 * The pure staffing math is covered in `@/lib/labour/labourMarket.test.ts`.
 * What THIS file pins is the wiring, which is the part that actually broke the
 * live world: that a state's tightness reading reaches both the persisted
 * headcount and the sector's realized output.
 *
 * Every pre-existing sector test runs with an empty `labourTightnessByState`,
 * so they all exercise the staffing factor at exactly 1 and would stay green if
 * the factor were never threaded into output at all. Without the assertions
 * here, "the whole suite passes" would mean nothing about this feature.
 */
const CORP_ID = new ObjectId();
const SECTOR_ID = new ObjectId();
const STATE_ID = "AZ";
const COUNTRY_ID = "US";
const DAILY_REVENUE = 1_000_000;

function makeCorp(): Corporation {
  return {
    _id: CORP_ID,
    name: "Rationing Test Mining",
    countryId: COUNTRY_ID,
    sectorType: "extraction",
    liquidCapital: 10_000_000,
    createdAt: new Date(),
  } as unknown as Corporation;
}

function makeSector(priorStaffingFactor?: number): CorporateSector {
  return {
    _id: SECTOR_ID,
    corporationId: CORP_ID,
    stateId: STATE_ID,
    countryId: COUNTRY_ID,
    sectorType: "extraction",
    strategyId: "standard",
    revenue: DAILY_REVENUE,
    profitMargin: 20,
    effectiveProfitMargin: 20,
    currentGrowthRate: 0,
    targetGrowthRate: 0,
    currentGrowthCost: 0,
    productionPolicy: 0,
    productionPolicyLevel: 0,
    workers: 1000,
    labourStaffingFactor: priorStaffingFactor,
    createdAt: new Date(),
  } as unknown as CorporateSector;
}

function makeLookups(tightness: number | undefined): CorporationLookups {
  return {
    corporations: [],
    sectorsByCorp: new Map(),
    corpById: new Map(),
    ceoBusinessAcumenByCorpId: new Map(),
    bondsByCorpId: new Map(),
    bondsHeldByCorpId: new Map(),
    portfolioAnchorValueByCorpId: new Map(),
    bondAndImfPortfolioAnchorByCorpId: new Map(),
    issuedBondDebtByCorpId: new Map(),
    crossCorpStockHoldingsByHolderCorpId: new Map(),
    primeRateByCountry: new Map(),
    macroInflationByCountry: new Map(),
    investorConfidenceByCountry: new Map(),
    macroDebtToGdpByCountry: new Map(),
    macroDeficitByCountry: new Map(),
    sovereignDefaultMarginByCorpId: new Map(),
    marketShareBySectorId: new Map([[SECTOR_ID.toString(), 0]]),
    allTariffs: [],
    activeFtaPairs: new Set(),
    ftaCoverage: { byCountryEconomyWide: new Map(), bySectorType: new Map() },
    activeSubsidies: [],
    priceRatioByCommodity: new Map(),
    globalCommodityBalances: new Map(),
    stateInputAvailabilityByState: new Map(),
    nationalCommodityBalancesByCountry: new Map(),
    rawStateBalances: new Map(),
    extractionCapacityUtilBySector: new Map(),
    stateResourceCapacityByState: new Map(),
    stateSectorSpecializationByState: new Map(),
    rawWorkforceSkillByState: new Map(),
    labourTightnessByState: tightness === undefined ? new Map() : new Map([[STATE_ID, tightness]]),
    regionalConditionMarginByState: new Map(),
    sectorPresenceKeys: new Set(),
    exportIntensityByCountry: new Map(),
    activeDisasterEffectsByState: new Map(),
    politicalBoardByState: new Map(),
  } as unknown as CorporationLookups;
}

/**
 * `priorStaffingFactor` stands in for last turn's persisted value. The staffing
 * factor GLIDES toward its target at LABOUR_STAFFING_MAX_TURN_MOVE per turn, so
 * a test that wants to observe the settled constraint has to say which turn of
 * the ramp it is looking at. Passing the target itself means "fully ramped".
 */
function run(tightness: number | undefined, priorStaffingFactor?: number) {
  const env = {
    lookups: makeLookups(tightness),
    turn: 1000,
    currentTurn: 1000,
    now: new Date("2026-08-23T00:00:00Z"),
    techTreesEnabled: false,
    labour: { wagesEnabled: false },
    market: buildMarketContext("plants"),
    wageIndexByState: new Map(),
    automationIndexByState: new Map(),
    labourDemandByState: new Map(),
    pendingStrikeEvents: [],
    pendingCapacityBindingEvents: [],
    sectorOps: [],
  } as unknown as SectorTurnEnv;
  const result = processSector(env, makeCorp(), makeSector(priorStaffingFactor), 1, undefined, 1);
  const op = env.sectorOps[0] as { updateOne: { update: { $set: Record<string, unknown> } } };
  return { result, env, update: op.updateOne.update.$set };
}

describe("phase 2 labour rationing through processSector", () => {
  it("is a no-op in a slack state", () => {
    const slack = run(0.4);
    const unknown = run(undefined);

    expect(slack.update.labourStaffingFactor).toBe(1);
    expect(slack.update.workers).toBe(slack.update.workersDesired);
    // A state with no tightness reading must behave exactly like a slack one,
    // never like a fully-rationed one, or missing data would halt an economy.
    expect(unknown.result.hourlyRevenue).toBeCloseTo(slack.result.hourlyRevenue, 8);
  });

  it("staffs half the desired headcount when the state is twice oversubscribed", () => {
    const { update } = run(2, 0.5);
    const desired = update.workersDesired as number;
    expect(update.labourStaffingFactor).toBe(0.5);
    expect(update.workers as number).toBe(Math.round(desired * 0.5));
  });

  it("throttles realized output in proportion to the staffing shortfall", () => {
    // The wiring assertion. If the staffing factor never reached the output
    // legs, headcount would fall and revenue would not, which is precisely the
    // bug that let one Arizona sector bill 48M phantom workers of production.
    const slack = run(1, 1);
    const tight = run(4, 0.25);

    expect(tight.result.hourlyRevenue).toBeCloseTo(slack.result.hourlyRevenue * 0.25, 6);
  });

  it("collapses a 200x oversubscribed state to under one percent of its output", () => {
    const slack = run(1, 1);
    const arizona = run(200.9, staffingFactorFromTightness(200.9));

    expect(arizona.result.hourlyRevenue).toBeLessThan(slack.result.hourlyRevenue * 0.006);
    expect(arizona.result.hourlyRevenue).toBeGreaterThan(0);
  });

  it("keeps persisted nameplate revenue off the staffing factor, so rationing cannot oscillate", () => {
    // The stability property. Next turn's desired headcount is derived from the
    // persisted `revenue` (nameplate capacity x mix price). If the staffing
    // haircut reached that field, a rationed state would report low demand next
    // turn, read as slack, un-ration, spike, and flip-flop every turn forever.
    // Realized output falls; the nameplate the sector is sized from does not.
    const slack = run(1, 1);
    const tight = run(200.9, staffingFactorFromTightness(200.9));

    expect(tight.update.revenue).toBeCloseTo(slack.update.revenue as number, 6);
    expect(tight.result.hourlyRevenue).toBeLessThan(slack.result.hourlyRevenue * 0.006);
  });

  it("records desired headcount, not the rationed result, so tightness cannot self-cancel", () => {
    // Next turn's tightness sums this. Recording the rationed figure would drive
    // the reading toward 1 and quietly switch rationing back off, restoring the
    // bug one turn later.
    const { env, update } = run(10, 0.1);
    const accumulated = env.labourDemandByState.get(STATE_ID);

    expect(accumulated).toBe(update.workersDesired);
    expect(accumulated).toBeGreaterThan(update.workers as number);
  });
  it("does not snap a newly oversubscribed sector straight to its floor", () => {
    // A CEO gets warning and time to act, not a one-turn wipeout.
    const firstTurn = run(200.9);
    expect(firstTurn.update.labourStaffingFactor).toBeCloseTo(1 - LABOUR_STAFFING_MAX_TURN_MOVE, 8);
    expect(firstTurn.result.hourlyRevenue).toBeGreaterThan(0);
  });

  it("still arrives at the full constraint by replaying the ramp turn by turn", () => {
    // The ramp must CONVERGE. A ramp that never lands is just the exploit
    // paying out more slowly, which is the failure mode worth guarding.
    const target = staffingFactorFromTightness(200.9);
    let prior: number | undefined = undefined;
    let turns = 0;
    for (; turns < 25; turns++) {
      const next = run(200.9, prior).update.labourStaffingFactor as number;
      if (prior !== undefined && Math.abs(next - prior) < 1e-9) break;
      prior = next;
    }
    expect(turns).toBeLessThanOrEqual(10);
    expect(prior).toBeCloseTo(target, 8);
  });
});
