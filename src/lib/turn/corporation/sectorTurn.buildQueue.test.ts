import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import type { Corporation, CorporateSector, SectorBuildOrder } from "@/lib/db/types";
import { COMMODITY_BASE_PRICES, type CommodityType } from "@/lib/constants/commodities";
import {
  CAPITAL_DEPRECIATION_PER_TURN,
  CAPITAL_SEED_HEADROOM,
  impliedOutputUnits,
} from "@/lib/market/capital";
import { buildMarketContext } from "@/lib/market/marketContext";
import { getEffectiveStrategyRates } from "@/lib/constants/sectorStrategies";
import { TURNS_PER_DAY, GROWTH_RATE_TURNS_PER_YEAR } from "@/lib/constants/corporations";
import {
  CAPACITY_ANCHOR_YEAR,
  CAPACITY_BUILD_TURNS,
  IDLE_UPKEEP_FRACTION,
  MOTHBALL_UPKEEP_FRACTION,
  capacityPricePerUnit,
} from "@/lib/constants/capacityEconomy";
import type { CorporationLookups } from "./types";
import { processSector, type SectorTurnEnv } from "./sectorTurn";
import { applySectorTurnOps } from "./applySectorTurnOps";

/**
 * P3a (buildable sectors): the build queue, mothballing (D12), idle upkeep and
 * the growth-ramp flip conversion. Harness mirrors sectorTurn.plants.test.ts.
 */

const CORP_ID = new ObjectId();
const SECTOR_ID = new ObjectId();
const STATE_ID = "US-CA";
const COUNTRY_ID = "US";
const DAILY_REVENUE = 240_000;
const GROWTH_RATE = 4;

function makeCorp(): Corporation {
  return {
    _id: CORP_ID,
    name: "Plantsco",
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
    currentGrowthRate: GROWTH_RATE,
    targetGrowthRate: GROWTH_RATE,
    currentGrowthCost: 0,
    productionPolicy: 0,
    productionPolicyLevel: 0,
    workers: 1000,
    createdAt: new Date(),
    ...overrides,
  } as unknown as CorporateSector;
}

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

function makeEnv(mode: "capital" | "plants", currentTurn: number): SectorTurnEnv {
  return {
    lookups: makeLookups(),
    turn: currentTurn,
    currentTurn,
    now: new Date("2026-08-01T00:00:00Z"),
    techTreesEnabled: false,
    currentYear: CAPACITY_ANCHOR_YEAR,
    labour: { wagesEnabled: false },
    market: buildMarketContext(mode),
    wageIndexByState: new Map(),
    automationIndexByState: new Map(),
    labourDemandByState: new Map(),
    pendingStrikeEvents: [],
    pendingCapacityBindingEvents: [],
    sectorOps: [],
  } as unknown as SectorTurnEnv;
}

function sectorUpdateOf(env: SectorTurnEnv): Record<string, unknown> {
  const op = env.sectorOps[0] as { updateOne: { update: { $set?: Record<string, unknown> } } };
  return op.updateOne.update.$set ?? {};
}

type TurnUpdate = {
  $set?: Record<string, unknown>;
  $pull?: { buildQueue?: { onlineTurn?: { $lte?: number } } };
  $inc?: Record<string, number>;
  $push?: { buildQueue?: SectorBuildOrder };
};

const applySectorOps = (doc: Record<string, unknown>, env: SectorTurnEnv) =>
  applySectorTurnOps(doc, env.sectorOps);

function run(mode: "capital" | "plants", sector: CorporateSector, currentTurn = 1000) {
  const env = makeEnv(mode, currentTurn);
  const result = processSector(env, makeCorp(), sector, 1, undefined, 1);
  return {
    result,
    update: sectorUpdateOf(env),
    doc: applySectorOps(sector as unknown as Record<string, unknown>, env),
    env,
  };
}

const SUPPLY = getEffectiveStrategyRates("manufacturing", "standard", undefined, undefined, 0)
  .supply as Partial<Record<CommodityType, number>>;
const PRE_FLIP_NAMEPLATE = DAILY_REVENUE * (1 + GROWTH_RATE / GROWTH_RATE_TURNS_PER_YEAR / 100);
const IMPLIED_UNITS = impliedOutputUnits(PRE_FLIP_NAMEPLATE, SUPPLY, COMMODITY_BASE_PRICES, 1);
const MIX_PRICE = PRE_FLIP_NAMEPLATE / IMPLIED_UNITS;
const BUILD_TURNS = CAPACITY_BUILD_TURNS("manufacturing");

/** An order that has already come online at `landsAt`. */
function order(overrides: Partial<SectorBuildOrder> = {}): SectorBuildOrder {
  return {
    unitsOrdered: 1_000,
    costPaidAnchor: 500_000,
    startTurn: 900,
    onlineTurn: 900 + BUILD_TURNS,
    ...overrides,
  };
}

describe("plants build queue — landing", () => {
  it("converts an order into capacity on its online turn and drops it", () => {
    const stock = 5_000;
    const landing = order({ unitsOrdered: 1_200, onlineTurn: 1000 });
    const { update, doc } = run(
      "plants",
      makeSector({
        capitalStock: stock,
        plantsStartTurn: 900,
        buildQueue: [landing],
        constructionInProgressAnchor: landing.costPaidAnchor,
      }),
      1000
    );
    expect(update.capitalStock as number).toBeCloseTo(
      (stock + 1_200) * (1 - CAPITAL_DEPRECIATION_PER_TURN),
      1
    );
    expect(doc.buildQueue as SectorBuildOrder[]).toEqual([]);
    // CIP releases when the capacity lands — the money is now a plant.
    expect(doc.constructionInProgressAnchor).toBe(0);
  });

  it("leaves an outstanding order alone and reports it as CIP", () => {
    const stock = 5_000;
    const pending = order({ unitsOrdered: 1_200, costPaidAnchor: 750_000, onlineTurn: 1050 });
    const { update, doc, result } = run(
      "plants",
      makeSector({
        capitalStock: stock,
        plantsStartTurn: 900,
        buildQueue: [pending],
        constructionInProgressAnchor: 750_000,
      }),
      1000
    );
    expect(update.capitalStock as number).toBeCloseTo(
      stock * (1 - CAPITAL_DEPRECIATION_PER_TURN),
      1
    );
    expect((doc.buildQueue as SectorBuildOrder[]).length).toBe(1);
    expect(doc.constructionInProgressAnchor).toBe(750_000);
    expect(result.constructionInProgressAnchor).toBeCloseTo(750_000, 6);
  });

  it("lands only the due orders and keeps CIP for the rest", () => {
    const queue = [
      order({ unitsOrdered: 100, costPaidAnchor: 100_000, onlineTurn: 999 }),
      order({ unitsOrdered: 200, costPaidAnchor: 200_000, onlineTurn: 1000 }),
      order({ unitsOrdered: 400, costPaidAnchor: 400_000, onlineTurn: 1001 }),
    ];
    const { update, doc } = run(
      "plants",
      makeSector({
        capitalStock: 5_000,
        plantsStartTurn: 900,
        buildQueue: queue,
        constructionInProgressAnchor: 700_000,
      }),
      1000
    );
    expect(update.capitalStock as number).toBeCloseTo(
      (5_000 + 300) * (1 - CAPITAL_DEPRECIATION_PER_TURN),
      1
    );
    expect(doc.constructionInProgressAnchor).toBe(400_000);
    expect((doc.buildQueue as SectorBuildOrder[]).map((o) => o.onlineTurn)).toEqual([1001]);
  });

  it("does not touch the queue outside plants mode", () => {
    const { update } = run(
      "capital",
      makeSector({ capitalStock: 5_000, buildQueue: [order({ onlineTurn: 900 })] }),
      1000
    );
    expect(update.buildQueue).toBeUndefined();
    expect(update.constructionInProgressAnchor).toBeUndefined();
  });
});

describe("plants build queue — smooth (per-turn) delivery", () => {
  /** A smooth order: 4800 units over the full build window, placed at turn 900. */
  const smoothOrder = (overrides: Partial<SectorBuildOrder> = {}): SectorBuildOrder => ({
    unitsOrdered: 4_800,
    costPaidAnchor: 480_000,
    startTurn: 900,
    onlineTurn: 900 + BUILD_TURNS,
    smooth: true,
    ...overrides,
  });

  it("delivers a slice of capacity mid-build without landing the order", () => {
    const stock = 5_000;
    const ord = smoothOrder();
    const midTurn = 900 + Math.floor(BUILD_TURNS / 2);
    const { update, doc } = run(
      "plants",
      makeSector({
        capitalStock: stock,
        plantsStartTurn: 900,
        buildQueue: [ord],
        constructionInProgressAnchor: ord.costPaidAnchor,
      }),
      midTurn
    );
    // One turn's slice is unitsOrdered / BUILD_TURNS, added before depreciation.
    const slice = ord.unitsOrdered / BUILD_TURNS;
    expect(update.capitalStock as number).toBeCloseTo(
      (stock + slice) * (1 - CAPITAL_DEPRECIATION_PER_TURN),
      1
    );
    // The order stays in the queue — it is only partly built.
    expect((doc.buildQueue as SectorBuildOrder[]).length).toBe(1);
    // CIP falls by this turn's slice of cost, not the whole order.
    const cipSlice = ord.costPaidAnchor / BUILD_TURNS;
    expect(doc.constructionInProgressAnchor as number).toBeCloseTo(
      ord.costPaidAnchor - cipSlice,
      0
    );
  });

  it("emits an $inc but no $pull while a smooth order is mid-build", () => {
    const env = makeEnv("plants", 900 + Math.floor(BUILD_TURNS / 2));
    processSector(
      env,
      makeCorp(),
      makeSector({
        capitalStock: 5_000,
        plantsStartTurn: 900,
        buildQueue: [smoothOrder()],
        constructionInProgressAnchor: 480_000,
      }),
      1,
      undefined,
      1
    );
    const u = (env.sectorOps[0] as { updateOne: { update: TurnUpdate } }).updateOne.update;
    expect(u.$pull).toBeUndefined();
    expect(u.$inc?.constructionInProgressAnchor).toBeLessThan(0);
  });

  it("lands and drops the order on its online turn", () => {
    const ord = smoothOrder();
    const { doc } = run(
      "plants",
      makeSector({
        capitalStock: 5_000,
        plantsStartTurn: 900,
        buildQueue: [ord],
        constructionInProgressAnchor: ord.costPaidAnchor,
      }),
      ord.onlineTurn
    );
    expect(doc.buildQueue as SectorBuildOrder[]).toEqual([]);
  });

  it("accumulates to the full order across the whole window", () => {
    // Step the sector turn by turn from just after placement to the online turn
    // and confirm the capacity built (net of depreciation each turn) tracks the
    // whole order — no lump, no shortfall.
    const ord = smoothOrder({ unitsOrdered: 4_800, costPaidAnchor: 480_000 });
    let stock = 5_000;
    let delivered = 0;
    for (let t = 901; t <= ord.onlineTurn; t++) {
      const { update, doc } = run(
        "plants",
        makeSector({
          capitalStock: stock,
          plantsStartTurn: 900,
          // The order is delivered statelessly, so it persists untouched in the
          // queue until it lands — pass the same order every turn.
          buildQueue: [ord],
          constructionInProgressAnchor: ord.costPaidAnchor,
        }),
        t
      );
      const before = stock;
      stock = update.capitalStock as number;
      // Undo this turn's depreciation to isolate the delivered slice.
      const grossThisTurn = stock / (1 - CAPITAL_DEPRECIATION_PER_TURN) - before;
      delivered += grossThisTurn;
      if (t === ord.onlineTurn) expect((doc.buildQueue as SectorBuildOrder[]).length).toBe(0);
    }
    expect(delivered).toBeCloseTo(ord.unitsOrdered, 0);
  });
});

describe("plants — growth-ramp flip conversion", () => {
  const RAMPING = makeSector({
    capitalStock: IMPLIED_UNITS * CAPITAL_SEED_HEADROOM,
    currentGrowthCost: 60_000,
    targetGrowthRate: GROWTH_RATE,
  });

  it("credits accrued growth spend as a free half-time build order", () => {
    const { update, doc } = run("plants", RAMPING, 1000);
    const queue = doc.buildQueue as SectorBuildOrder[];
    expect(queue.length).toBe(1);
    const price = capacityPricePerUnit("manufacturing", CAPACITY_ANCHOR_YEAR, 1);
    expect(queue[0].unitsOrdered).toBeCloseTo(60_000 / price, 6);
    // Free: the corp already paid via the growth slider. Also un-refundable,
    // which is exactly what costPaidAnchor 0 buys.
    expect(queue[0].costPaidAnchor).toBe(0);
    expect(queue[0].onlineTurn).toBe(1000 + Math.ceil(BUILD_TURNS / 2));
    // A free order adds nothing to CIP, so the turn emits no $inc at all.
    expect(doc.constructionInProgressAnchor ?? 0).toBe(0);
    expect(update.constructionInProgressAnchor).toBeUndefined();
  });

  it("retires the vestigial growth fields under plants", () => {
    const { update } = run("plants", RAMPING, 1000);
    expect(update.targetGrowthRate).toBe(0);
    expect(update.currentGrowthCost).toBe(0);
  });

  it("credits nothing when no paid ramp was in flight", () => {
    const { doc } = run("plants", makeSector({ currentGrowthCost: 0 }), 1000);
    expect(doc.buildQueue).toEqual([]);
  });

  it("converts once — a post-flip sector gets no further credit", () => {
    const { doc } = run(
      "plants",
      makeSector({ plantsStartTurn: 900, currentGrowthCost: 60_000 }),
      1000
    );
    expect(doc.buildQueue).toEqual([]);
  });

  it("lands the credited capacity when its half-time elapses", () => {
    const flip = run("plants", RAMPING, 1000);
    const credited = (flip.doc.buildQueue as SectorBuildOrder[])[0];
    const later = run(
      "plants",
      makeSector({
        capitalStock: flip.update.capitalStock as number,
        plantsStartTurn: 1000,
        buildQueue: [credited],
      }),
      credited.onlineTurn
    );
    expect(later.update.capitalStock as number).toBeGreaterThan(flip.update.capitalStock as number);
  });
});

describe("plants — mothball (D12)", () => {
  // Sized at the sector's implied units so the running comparison below is
  // apples-to-apples: a wildly over-built sector has its RUNNING revenue clamped
  // by the launch governor while its upkeep basis (capacity at nominal mix
  // prices) is not, which would make the ratio a statement about the governor.
  const CAPACITY = IMPLIED_UNITS;
  const active = () =>
    run("plants", makeSector({ capitalStock: CAPACITY, plantsStartTurn: 100 }), 5000);
  const cold = () =>
    run(
      "plants",
      makeSector({ capitalStock: CAPACITY, plantsStartTurn: 100, mothballed: true }),
      5000
    );

  it("produces nothing, sells nothing and earns nothing", () => {
    const { result, update } = cold();
    expect(update.producedUnits).toBe(0);
    // Under plants the clearing pre-pass offers `producedUnits`, so 0 produced
    // is 0 offered next turn — no separate offer suppression needed.
    expect(update.soldUnits).toBe(0);
    expect(result.hourlyRevenue).toBe(0);
    expect(update.realizedRevenue).toBe(0);
  });

  it("charges MOTHBALL_UPKEEP_FRACTION of full-capacity maintenance", () => {
    const { result } = cold();
    const capacity = CAPACITY * (1 - CAPITAL_DEPRECIATION_PER_TURN);
    const unitUpkeep = (MIX_PRICE / TURNS_PER_DAY) * (1 - result.effectiveMargin / 100);
    expect(result.plantsUpkeepCost).toBeCloseTo(
      unitUpkeep * capacity * MOTHBALL_UPKEEP_FRACTION,
      4
    );
    expect(result.costs).toBeCloseTo(result.plantsUpkeepCost, 6);
  });

  it("costs far less than running the plants", () => {
    expect(cold().result.costs).toBeLessThan(active().result.costs * 0.5);
  });

  it("keeps the capacity (and its nameplate) so reactivation is free", () => {
    const { update } = cold();
    expect(update.capitalStock as number).toBeCloseTo(
      CAPACITY * (1 - CAPITAL_DEPRECIATION_PER_TURN),
      1
    );
    expect(update.revenue as number).toBeGreaterThan(0);
    // Reactivating restores production with no penalty and no cooldown.
    expect(active().result.hourlyRevenue).toBeGreaterThan(0);
  });

  it("is inert outside plants mode", () => {
    const { result } = run(
      "capital",
      makeSector({ capitalStock: CAPACITY, mothballed: true }),
      5000
    );
    expect(result.hourlyRevenue).toBeGreaterThan(0);
    expect(result.plantsUpkeepCost).toBe(0);
  });
});

describe("plants — idle-capacity upkeep", () => {
  it("charges IDLE_UPKEEP_FRACTION on capacity that did not produce", () => {
    // Over-built sector: capacity well above what the market lets it sell is
    // still capacity it must hold. Ramp exhausted so the charge is at full rate.
    const env = makeEnv("plants", 5000);
    env.market = { ...env.market, governorCap: 1_000, governorRampTurns: 1 };
    const sector = makeSector({ capitalStock: IMPLIED_UNITS * 2, plantsStartTurn: 100 });
    const result = processSector(env, makeCorp(), sector, 1, undefined, 1);
    const update = sectorUpdateOf(env);
    const capacity = update.capitalStock as number;
    const produced = update.producedUnits as number;
    const unitUpkeep = (MIX_PRICE / TURNS_PER_DAY) * (1 - result.effectiveMargin / 100);
    // Every production leg is neutral here, so produced == capacity and there is
    // no idle charge; the mechanism bites when a leg throttles output.
    expect(produced).toBeCloseTo(capacity, 0);
    expect(result.plantsUpkeepCost).toBeCloseTo(
      unitUpkeep * Math.max(0, capacity - produced) * IDLE_UPKEEP_FRACTION,
      6
    );
  });

  it("charges idle upkeep when a production leg throttles output", () => {
    // Production policy below neutral cuts the production factor, so part of
    // the capacity sits idle — and now costs something.
    const env = makeEnv("plants", 5000);
    env.market = { ...env.market, governorCap: 1_000, governorRampTurns: 1 };
    const sector = makeSector({
      capitalStock: 5_000,
      plantsStartTurn: 100,
      productionPolicy: -10,
      productionPolicyLevel: -10,
    });
    const result = processSector(env, makeCorp(), sector, 1, undefined, 1);
    const update = sectorUpdateOf(env);
    const capacity = update.capitalStock as number;
    const produced = update.producedUnits as number;
    expect(produced).toBeLessThan(capacity);
    const unitUpkeep = (MIX_PRICE / TURNS_PER_DAY) * (1 - result.effectiveMargin / 100);
    expect(result.plantsUpkeepCost).toBeCloseTo(
      unitUpkeep * (capacity - produced) * IDLE_UPKEEP_FRACTION,
      4
    );
    expect(result.plantsUpkeepCost).toBeGreaterThan(0);
  });

  it("is exactly zero on the flip turn — the flip identity survives", () => {
    // The flip seeds capacity at 1.1× implied units, so ~9% is idle. The charge
    // is ramped from the plants anchor, so λ = 0 on the flip turn.
    const flip = run("plants", makeSector(), 1000);
    expect(flip.result.plantsUpkeepCost).toBe(0);
    const capital = run("capital", makeSector(), 1000);
    expect(flip.result.costs).toBeCloseTo(capital.result.costs, 8);
    const profit = (r: { hourlyRevenue: number; costs: number }) => r.hourlyRevenue - r.costs;
    expect(profit(flip.result)).toBeCloseTo(profit(capital.result), 8);
  });

  it("fades the charge in over the governor ramp", () => {
    const at = (turn: number) => {
      const env = makeEnv("plants", turn);
      env.market = { ...env.market, governorCap: 1_000, governorRampTurns: 100 };
      const sector = makeSector({
        capitalStock: 5_000,
        plantsStartTurn: 1000,
        productionPolicy: -10,
        productionPolicyLevel: -10,
      });
      return processSector(env, makeCorp(), sector, 1, undefined, 1).plantsUpkeepCost;
    };
    expect(at(1000)).toBe(0);
    const half = at(1050);
    const full = at(1100);
    expect(half).toBeGreaterThan(0);
    expect(half).toBeCloseTo(full * 0.5, 6);
    // Ramp saturates — it does not keep growing past the window.
    expect(at(2000)).toBeCloseTo(full, 6);
  });

  /**
   * THE LIVE DEFECT (sandbox turn 293, 675 sectors): `throughputFactor` was
   * exactly 0.85 — the launch governor's floor — for EVERY sector in the world.
   * Not one plant's idleness was an over-build; all of it was input starvation,
   * and each sector had already lost that 15% off its top line before being
   * billed idle upkeep on the same 15% of units again.
   */
  describe("owner-idle base (throughput starvation is not over-building)", () => {
    /** A world where the sector's scarcest input supplies only `avail` of demand. */
    function starvedEnv(avail: number, currentTurn: number) {
      const env = makeEnv("plants", currentTurn);
      env.market = { ...env.market, governorCap: 1_000, governorRampTurns: 1 };
      const demand = getEffectiveStrategyRates("manufacturing", "standard", undefined, undefined, 0)
        .demand as Partial<Record<CommodityType, number>>;
      const balances = new Map<CommodityType, { supply: number; demand: number }>();
      for (const key of Object.keys(demand) as CommodityType[]) {
        if ((demand[key] ?? 0) > 0) balances.set(key, { supply: avail, demand: 1 });
      }
      (env.lookups as { globalCommodityBalances: unknown }).globalCommodityBalances = balances;
      return env;
    }

    it("charges nothing when the ONLY thing idling the plant is input scarcity", () => {
      const env = starvedEnv(0.7, 1_400);
      const sector = makeSector({
        capitalStock: 5_000,
        plantsStartTurn: 1_000,
        throughputStartTurn: 1_000,
      });
      const result = processSector(env, makeCorp(), sector, 1, undefined, 1);
      const update = sectorUpdateOf(env);
      // The plant really is running short — this is the case that used to bill.
      expect(update.throughputFactor as number).toBeLessThan(1);
      expect(update.producedUnits as number).toBeLessThan(update.capitalStock as number);
      expect(result.plantsUpkeepCost).toBe(0);
    });

    it("still bills the OWNER's share when both throttles are present", () => {
      // Production policy at −10 (an owner decision) on top of the same input
      // shortage: the owner-chosen idleness is charged, the starvation is not.
      const both = starvedEnv(0.7, 1_400);
      const ownerOnly = makeEnv("plants", 1_400);
      ownerOnly.market = { ...ownerOnly.market, governorCap: 1_000, governorRampTurns: 1 };
      const mk = () =>
        makeSector({
          capitalStock: 5_000,
          plantsStartTurn: 1_000,
          throughputStartTurn: 1_000,
          productionPolicy: -10,
          productionPolicyLevel: -10,
          // Same held unit price on both sides, so the comparison isolates the
          // BASE (an input shortage also moves the live margin, which is the
          // separate coupling the anchor exists to cut).
          plantsUpkeepMarginBasisAnchor: 0.8,
        });
      const starved = processSector(both, makeCorp(), mk(), 1, undefined, 1);
      const clear = processSector(ownerOnly, makeCorp(), mk(), 1, undefined, 1);
      expect(starved.plantsUpkeepCost).toBeGreaterThan(0);
      // Dividing the involuntary leg back out makes the charge INDEPENDENT of
      // how badly the world is starving the plant: same owner decision, same
      // bill. That is the whole claim.
      expect(starved.plantsUpkeepCost).toBeCloseTo(clear.plantsUpkeepCost, 4);
    });
  });

  /**
   * THE PERVERSE TERM: the unit price was `mixPrice × (1 − margin_now)`, so the
   * idle bill GREW as the margin fell — hardest on the sectors closest to
   * insolvency. It is now stamped once and held.
   */
  describe("anchored upkeep price (no growth as the margin falls)", () => {
    const priceAt = (margin: number, anchor: number | undefined) => {
      const env = makeEnv("plants", 1_100);
      env.market = { ...env.market, governorCap: 1_000, governorRampTurns: 100 };
      const sector = makeSector({
        capitalStock: 5_000,
        plantsStartTurn: 1_000,
        productionPolicy: -10,
        productionPolicyLevel: -10,
        profitMargin: margin,
        ...(anchor === undefined ? {} : { plantsUpkeepMarginBasisAnchor: anchor }),
      });
      return processSector(env, makeCorp(), sector, 1, undefined, 1).plantsUpkeepCost;
    };

    it("does not rise when the sector's margin collapses", () => {
      const anchor = 1 - 20 / 100;
      const healthy = priceAt(20, anchor);
      const distressed = priceAt(-40, anchor);
      expect(healthy).toBeGreaterThan(0);
      expect(distressed).toBeCloseTo(healthy, 6);
    });

    it("WOULD have risen without the anchor — the bug this pins", () => {
      // Same two sectors, no stamped anchor: the live basis drives the price and
      // the collapsing sector is charged strictly more.
      expect(priceAt(-40, undefined)).toBeGreaterThan(priceAt(20, undefined));
    });

    it("stamps the anchor from the live margin, so the stamping turn is unchanged", () => {
      const env = makeEnv("plants", 1_100);
      env.market = { ...env.market, governorCap: 1_000, governorRampTurns: 100 };
      const sector = makeSector({ capitalStock: 5_000, plantsStartTurn: 1_000 });
      const result = processSector(env, makeCorp(), sector, 1, undefined, 1);
      const stamped = sectorUpdateOf(env).plantsUpkeepMarginBasisAnchor as number;
      expect(stamped).toBeGreaterThan(0);
      expect(stamped).toBeLessThanOrEqual(1);
      // The value stamped IS what the old expression used that turn.
      expect(stamped).toBeCloseTo(Math.max(0, 1 - result.effectiveMargin / 100), 6);
    });

    it("does not rewrite an anchor a sector already carries", () => {
      const env = makeEnv("plants", 1_100);
      const sector = makeSector({
        capitalStock: 5_000,
        plantsStartTurn: 1_000,
        plantsUpkeepMarginBasisAnchor: 0.42,
      });
      processSector(env, makeCorp(), sector, 1, undefined, 1);
      expect(sectorUpdateOf(env).plantsUpkeepMarginBasisAnchor).toBeUndefined();
    });
  });
});

/**
 * C4 REGRESSION (ship-blocker).
 *
 * The turn processor used to persist `buildQueue` with a whole-array `$set`
 * built from a snapshot taken at the START of the turn. The sector-compute
 * phase is long, and `POST .../build` is live throughout it, so a CEO could
 * place an order, be charged in full, and have the order erased seconds later
 * by a bulkWrite carrying a queue that predates it. The command's own CAS could
 * not help: the command had already written and succeeded — it was the TURN
 * that clobbered, and the turn wrote unconditionally.
 *
 * The fix is that the turn only writes the delta it owns: `$pull` the orders
 * that landed (`onlineTurn <= currentTurn`, a predicate a fresh order can never
 * match) and `$inc` CIP by the amount those orders released. These tests apply
 * a command write to the document BETWEEN `processSector` and the bulkWrite and
 * assert the order survives with CIP intact.
 */
describe("plants build queue — a command racing the turn (C4)", () => {
  const landed = order({ unitsOrdered: 1_200, costPaidAnchor: 500_000, onlineTurn: 1000 });
  const snapshot = () =>
    makeSector({
      capitalStock: 5_000,
      plantsStartTurn: 900,
      buildQueue: [landed],
      constructionInProgressAnchor: 500_000,
    });

  /** What `buildCapacity` writes: append the order, restate CIP absolutely. */
  function commandPlaceOrder(doc: Record<string, unknown>, o: SectorBuildOrder) {
    const queue = [...((doc.buildQueue as SectorBuildOrder[]) ?? []), o];
    return {
      ...doc,
      buildQueue: queue,
      constructionInProgressAnchor: Math.round(queue.reduce((sum, q) => sum + q.costPaidAnchor, 0)),
    };
  }

  it("keeps an order placed after the snapshot, and lands the due one", () => {
    const sector = snapshot();
    const env = makeEnv("plants", 1000);
    processSector(env, makeCorp(), sector, 1, undefined, 1);

    // …meanwhile the CEO buys 300 more units for 900k. This write commits
    // BEFORE the turn's bulkWrite.
    const fresh: SectorBuildOrder = {
      unitsOrdered: 300,
      costPaidAnchor: 900_000,
      startTurn: 1000,
      onlineTurn: 1000 + BUILD_TURNS,
    };
    const live = commandPlaceOrder(sector as unknown as Record<string, unknown>, fresh);
    expect(live.constructionInProgressAnchor).toBe(1_400_000);

    const after = applySectorOps(live, env);

    // The charged order is still there…
    expect(after.buildQueue).toEqual([fresh]);
    // …the landed one is gone…
    expect((after.buildQueue as SectorBuildOrder[]).some((o) => o.onlineTurn <= 1000)).toBe(false);
    // …and CIP holds exactly the fresh order's cost: 1.4m − the 500k released.
    expect(after.constructionInProgressAnchor).toBe(900_000);
  });

  it("never emits a whole-array buildQueue $set", () => {
    const env = makeEnv("plants", 1000);
    processSector(env, makeCorp(), snapshot(), 1, undefined, 1);
    for (const op of env.sectorOps) {
      const u = (op as unknown as { updateOne: { update: TurnUpdate } }).updateOne.update;
      expect(u.$set?.buildQueue).toBeUndefined();
      expect(u.$set?.constructionInProgressAnchor).toBeUndefined();
    }
  });

  it("leaves a concurrent CANCEL's result intact (CIP moves by delta, not restatement)", () => {
    // Two outstanding orders plus one landing; the CEO cancels one outstanding
    // order mid-turn.
    const outA = order({ unitsOrdered: 100, costPaidAnchor: 200_000, onlineTurn: 1100 });
    const outB = order({ unitsOrdered: 100, costPaidAnchor: 300_000, onlineTurn: 1200 });
    const sector = makeSector({
      capitalStock: 5_000,
      plantsStartTurn: 900,
      buildQueue: [landed, outA, outB],
      constructionInProgressAnchor: 1_000_000,
    });
    const env = makeEnv("plants", 1000);
    processSector(env, makeCorp(), sector, 1, undefined, 1);

    // Command cancels outA and restates CIP over what IT read.
    const live = {
      ...(sector as unknown as Record<string, unknown>),
      buildQueue: [landed, outB],
      constructionInProgressAnchor: 800_000,
    };
    const after = applySectorOps(live, env);
    expect(after.buildQueue).toEqual([outB]);
    // 800k − the 500k the landing order released.
    expect(after.constructionInProgressAnchor).toBe(300_000);
  });

  it("emits no queue ops at all when nothing landed", () => {
    const env = makeEnv("plants", 1000);
    processSector(
      env,
      makeCorp(),
      makeSector({
        capitalStock: 5_000,
        plantsStartTurn: 900,
        buildQueue: [order({ onlineTurn: 1100 })],
        constructionInProgressAnchor: 500_000,
      }),
      1,
      undefined,
      1
    );
    for (const op of env.sectorOps) {
      const u = (op as unknown as { updateOne: { update: TurnUpdate } }).updateOne.update;
      expect(u.$pull).toBeUndefined();
      expect(u.$inc).toBeUndefined();
    }
  });
});
