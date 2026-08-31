import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import { buildMarketContext } from "@/lib/market/marketContext";
import { TURNS_PER_DAY } from "@/lib/constants/corporations";
import type { CorporationLookups } from "./types";
import { processSector, type SectorTurnEnv } from "./sectorTurn";
import { buildFreightBillingBySector } from "./freightBillingTurn";
import type { CommodityType } from "@/lib/constants/commodities";

/**
 * Canonical freight billing v1 (issue #897) turn wiring, flag ON: the
 * apportioned charge is a named cost line riding sector costs, the credit a
 * named revenue leg riding sector revenue, both persisted per sector. With the
 * maps absent (the flag is off) nothing is computed or written, except to
 * clear a stale value written while billing was on.
 */

const CORP_ID = new ObjectId();
const SECTOR_ID = new ObjectId();
const STATE_ID = "US-CA";
const COUNTRY_ID = "US";
const DAILY_REVENUE = 240_000;

function makeCorp(): Corporation {
  return {
    _id: CORP_ID,
    name: "Freightco",
    countryId: COUNTRY_ID,
    sectorType: "manufacturing",
    liquidCapital: 10_000_000,
    createdAt: new Date(),
  } as unknown as Corporation;
}

function makeSector(overrides: Partial<CorporateSector> = {}): CorporateSector {
  return {
    _id: SECTOR_ID,
    corporationId: CORP_ID,
    stateId: STATE_ID,
    countryId: COUNTRY_ID,
    sectorType: "manufacturing",
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
    createdAt: new Date(),
    ...overrides,
  } as unknown as CorporateSector;
}

/** Empty-but-complete lookups: every consumer sees "no data ⇒ neutral". */
function makeLookups(): CorporationLookups {
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
    marketShareBySectorId: new Map(),
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
    labourTightnessByState: new Map(),
    regionalConditionMarginByState: new Map(),
    sectorPresenceKeys: new Set(),
    exportIntensityByCountry: new Map(),
    activeDisasterEffectsByState: new Map(),
    politicalBoardByState: new Map(),
  } as unknown as CorporationLookups;
}

function makeEnv(currentTurn: number): SectorTurnEnv {
  return {
    lookups: makeLookups(),
    turn: currentTurn,
    currentTurn,
    now: new Date("2026-08-01T00:00:00Z"),
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
}

/** The `$set` payload processSector queued for the sector. */
function sectorUpdateOf(env: SectorTurnEnv): Record<string, unknown> {
  const op = env.sectorOps[0] as { updateOne: { update: { $set?: Record<string, unknown> } } };
  return op.updateOne.update.$set ?? {};
}

function run(
  sector: CorporateSector,
  billing?: { charge?: Map<string, number>; credit?: Map<string, number> },
  currentTurn = 1000
) {
  const env = makeEnv(currentTurn);
  if (billing) {
    env.market.freightBillingChargeBySectorId = billing.charge ?? new Map();
    env.market.freightBillingCreditBySectorId = billing.credit ?? new Map();
  }
  const result = processSector(env, makeCorp(), sector, 1, undefined, 1);
  return { result, update: sectorUpdateOf(env) };
}

describe("sector turn — canonical freight billing, flag ON", () => {
  const CHARGE = 120; // ₳/turn
  const CREDIT = 45; // ₳/turn
  const sectorKey = SECTOR_ID.toString();

  it("persists both legs as named daily lines and stamps the turn", () => {
    const { update } = run(makeSector(), {
      charge: new Map([[sectorKey, CHARGE]]),
      credit: new Map([[sectorKey, CREDIT]]),
    });
    expect(update.freightBillingCharge as number).toBeCloseTo(CHARGE * TURNS_PER_DAY, 8);
    expect(update.freightBillingCredit as number).toBeCloseTo(CREDIT * TURNS_PER_DAY, 8);
    expect(update.freightBillingTurn).toBe(1000);
  });

  it("charge rides sector costs, credit rides sector revenue", () => {
    const baseline = run(makeSector());
    const billed = run(makeSector(), {
      charge: new Map([[sectorKey, CHARGE]]),
      credit: new Map([[sectorKey, CREDIT]]),
    });
    expect(billed.result.costs - baseline.result.costs).toBeCloseTo(CHARGE, 8);
    expect(billed.result.hourlyRevenue - baseline.result.hourlyRevenue).toBeCloseTo(CREDIT, 8);
  });

  it("a sector with no apportioned money persists explicit zero legs", () => {
    const { result, update } = run(makeSector(), { charge: new Map(), credit: new Map() });
    expect(update.freightBillingCharge).toBe(0);
    expect(update.freightBillingCredit).toBe(0);
    const baseline = run(makeSector());
    expect(result.costs).toBeCloseTo(baseline.result.costs, 8);
    expect(result.hourlyRevenue).toBeCloseTo(baseline.result.hourlyRevenue, 8);
  });
});

describe("sector turn — canonical freight billing, flag OFF", () => {
  it("writes no billing fields on a sector that never billed", () => {
    const { update, result } = run(makeSector());
    expect("freightBillingCharge" in update).toBe(false);
    expect("freightBillingCredit" in update).toBe(false);
    expect("freightBillingTurn" in update).toBe(false);
    expect(result).toBeDefined();
  });

  it("clears a stale value written while billing was on", () => {
    const { update } = run(makeSector({ freightBillingCharge: 480, freightBillingCredit: 180 }));
    expect(update.freightBillingCharge).toBe(0);
    expect(update.freightBillingCredit).toBe(0);
  });
});

describe("buildFreightBillingBySector — corp-phase glue", () => {
  const BUYER_ID = new ObjectId();
  const HAULER_ID = new ObjectId();

  function glueLookups(over: {
    freightChargesByDestState?: Map<string, Map<CommodityType, number>>;
    freightHaulRevenueByOriginState?: Map<string, number>;
  }) {
    const corp = makeCorp();
    const buyer = makeSector({ _id: BUYER_ID, stateId: "US-NY", sectorType: "manufacturing" });
    const hauler = makeSector({
      _id: HAULER_ID,
      stateId: "US-TX",
      sectorType: "logistics",
    });
    return {
      sectorsByCorp: new Map([[CORP_ID.toString(), [buyer, hauler]]]),
      corpById: new Map([[CORP_ID.toString(), corp]]),
      eraUnitScale: 1,
      exchangeRatesByCurrency: new Map(),
      stateResourceCapacityByState: new Map(),
      ...over,
    } as unknown as Parameters<typeof buildFreightBillingBySector>[0]["lookups"];
  }

  it("bills the demanding sector and credits the freight supplier, conserving totals", () => {
    const billing = buildFreightBillingBySector({
      lookups: glueLookups({
        // Manufacturing demands iron, so the buyer is the only demander in NY.
        freightChargesByDestState: new Map([["US-NY", new Map([["iron" as CommodityType, 500]])]]),
        freightHaulRevenueByOriginState: new Map([["US-TX", 200]]),
      }),
      currentTurn: 1000,
      plantsEnabled: false,
      currentYear: undefined,
      commandEconomyEnabled: false,
    });
    expect(billing.chargeBySectorId.get(BUYER_ID.toString())).toBeCloseTo(500, 8);
    expect(billing.creditBySectorId.get(HAULER_ID.toString())).toBeCloseTo(200, 8);
    expect(billing.unapportionedCharges).toBe(0);
    expect(billing.unapportionedHaulRevenue).toBe(0);
  });

  it("routes money nobody can own to the unapportioned remainders", () => {
    const billing = buildFreightBillingBySector({
      lookups: glueLookups({
        // No sector lives in either state.
        freightChargesByDestState: new Map([["US-WY", new Map([["iron" as CommodityType, 300]])]]),
        freightHaulRevenueByOriginState: new Map([["US-MT", 100]]),
      }),
      currentTurn: 1000,
      plantsEnabled: false,
      currentYear: undefined,
      commandEconomyEnabled: false,
    });
    expect(billing.chargeBySectorId.size).toBe(0);
    expect(billing.creditBySectorId.size).toBe(0);
    expect(billing.unapportionedCharges).toBeCloseTo(300);
    expect(billing.unapportionedHaulRevenue).toBeCloseTo(100);
  });

  it("with empty aggregates (flag off shape) it apportions nothing", () => {
    const billing = buildFreightBillingBySector({
      lookups: glueLookups({}),
      currentTurn: 1000,
      plantsEnabled: false,
      currentYear: undefined,
      commandEconomyEnabled: false,
    });
    expect(billing.chargeBySectorId.size).toBe(0);
    expect(billing.creditBySectorId.size).toBe(0);
    expect(billing.unapportionedCharges).toBe(0);
    expect(billing.unapportionedHaulRevenue).toBe(0);
  });
});
