/**
 * P3b: NPP founding parity under plants.
 *
 * Under plants both sides price the founding build through `computeBuildCost`
 * with the founding discount, size it to one facility (`foundingStarterUnits`),
 * and draw that headroom down instead of minting it.
 *
 * The non-plants path (no plants context) must be byte-identical to before.
 */
import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  makeNppCorpDecision,
  NPP_FOUNDING_HEADROOM_SHARE,
  type CommodityPriceRatioFn,
  type NppPlantsContext,
} from "./nppCorporationBehavior";
import { ceoArchetypeModifiers } from "./ceoArchetype";
import type { Corporation, CorporateSector, UnownedSector } from "@/lib/db/types";
import {
  CAPACITY_ANCHOR_YEAR,
  CAPACITY_BUILD_TURNS,
  computeBuildCost,
} from "@/lib/constants/capacityEconomy";
import { foundingStarterUnits, sectorEntryFeeAnchor } from "@/lib/corporations/foundingPlant";
import { computeUnownedHeadroomUnits } from "@/lib/market/unownedHeadroom";
import { getEraUnitScale } from "@/lib/constants/sectorSeedEra";

const noPrices: CommodityPriceRatioFn = () => null;
const noState = new Set<string>();
const TURN = 100;

/** The unowned market the corp will expand into. Manufacturing, in-country. */
const POOL_REVENUE = 40_000_000;
const POOL_UNITS = computeUnownedHeadroomUnits("manufacturing", POOL_REVENUE, 1);

function unownedPool(overrides: Partial<UnownedSector> = {}): UnownedSector {
  return {
    _id: new ObjectId(),
    stateId: "CA",
    countryId: "US",
    sectorType: "manufacturing",
    revenue: POOL_REVENUE,
    headroomUnits: POOL_UNITS,
    ...overrides,
  } as unknown as UnownedSector;
}

function unownedByCountry(pools: UnownedSector[]) {
  return new Map<string, UnownedSector[]>([["US", pools]]);
}

/**
 * A corp healthy enough to clear every generic expansion gate (profitable,
 * strong margin, cash well above the floor) whose ONLY sector is `technology`,
 * so `manufacturing` is a non-overlapping expansion target.
 */
function corp(overrides: Partial<Corporation> = {}): Corporation {
  return {
    _id: new ObjectId(),
    countryId: "US",
    type: "manufacturing",
    headquartersState: "CA",
    liquidCapital: 500_000_000,
    ceoType: "npp",
    ...overrides,
  } as unknown as Corporation;
}

function sector(overrides: Partial<CorporateSector> = {}): CorporateSector {
  return {
    _id: new ObjectId(),
    sectorType: "technology",
    countryId: "US",
    stateId: "CA",
    revenue: 10_000_000,
    profitMargin: 30,
    effectiveProfitMargin: 30,
    targetGrowthRate: 2,
    ...overrides,
  } as unknown as CorporateSector;
}

const plantsCtx: NppPlantsContext = {
  enabled: true,
  eraUnitScale: 1,
  year: CAPACITY_ANCHOR_YEAR,
  preset: "2019-default",
  primeRateOf: () => 0,
  costOfLivingOf: () => null,
};

const plants1953Ctx: NppPlantsContext = {
  enabled: true,
  eraUnitScale: getEraUnitScale("1953-default"),
  year: 1960,
  preset: "1953-default",
  primeRateOf: () => 5,
  costOfLivingOf: () => 100,
};

function decide(
  c: Corporation,
  sectors: CorporateSector[],
  pools: UnownedSector[],
  plants?: NppPlantsContext
) {
  return makeNppCorpDecision(
    {
      corp: c,
      sectors,
      turn: TURN,
      now: new Date(),
      modifiers: ceoArchetypeModifiers("cautious"),
    },
    unownedByCountry(pools),
    noState,
    noPrices,
    plants
  );
}

/**
 * Founding build a neutral, cash-ample NPP should be charged. Deployment now
 * scales to available capital, so with the default 500M-liquid corp the bind is
 * the founding headroom share, not a single facility. Floored at one facility.
 */
const EXPECTED_UNITS = Math.max(
  foundingStarterUnits("manufacturing"),
  Math.floor(POOL_UNITS * NPP_FOUNDING_HEADROOM_SHARE)
);
const EXPECTED_FEE = sectorEntryFeeAnchor("2019-default");
const EXPECTED_BUILD = computeBuildCost({
  eraUnitScale: 1,
  sectorType: "manufacturing",
  units: EXPECTED_UNITS,
  year: CAPACITY_ANCHOR_YEAR,
  marketSharePercent: 0,
  primeRate: 0,
  founding: true,
}).totalAnchor;

describe("NPP expansion under plants — price parity", () => {
  it("uses the real era-priced founding quote instead of a modern flat cash gate", () => {
    const c = corp({ liquidCapital: 10_000 });
    const decision = decide(
      c,
      [sector({ revenue: 1_000, realizedRevenue: 1_000 })],
      [unownedPool()],
      plants1953Ctx
    );

    expect(decision.newSectors).toHaveLength(1);
    const spent = (c.liquidCapital ?? 0) - (decision.updates.liquidCapital as number);
    // Era-real pricing keeps a 1953 founding cheap. Deployment now scales to
    // capital, so a 10k treasury funds several facilities rather than one — but
    // it stays a bounded share of that treasury and nowhere near the old flat
    // 500k modern cash gate.
    expect(spent).toBeGreaterThan(0);
    expect(spent).toBeLessThan(c.liquidCapital as number);
    expect(spent).toBeLessThan(50_000);
  });

  it("uses canonical physical P&L to block a loss-making expansion", () => {
    const losing = sector({
      plantsPnl: {
        revenue: 1_000,
        inventoryRevenue: 0,
        inventoryCarry: 0,
        inputs: 700,
        labour: 300,
        upkeep: 100,
        compliance: 0,
        otherOpex: 0,
        financialLegs: 0,
        policyCredit: 0,
        policyPp: 0,
        operatingCost: 1_000,
        totalCost: 1_100,
        profit: -100,
        turn: TURN - 1,
      },
    });
    const decision = decide(corp(), [losing], [unownedPool()], plantsCtx);

    expect(decision.newSectors).toBeUndefined();
  });

  it("retains earnings on a turn that commits new productive investment", () => {
    const decision = decide(corp({ dividendRate: 8 }), [sector()], [unownedPool()], plantsCtx);

    expect(decision.newSectors).toHaveLength(1);
    expect(decision.updates.dividendRate).toBe(0);
  });

  it("charges the entry fee plus a real founding build, not a flat 500k", () => {
    const c = corp();
    const decision = decide(c, [sector()], [unownedPool()], plantsCtx);

    expect(decision.newSectors).toHaveLength(1);
    const spent = (c.liquidCapital ?? 0) - (decision.updates.liquidCapital as number);
    expect(spent).toBeCloseTo(EXPECTED_FEE + EXPECTED_BUILD, 2);
    expect(spent).not.toBeCloseTo(500_000, 2);
  });

  it("queues the capacity instead of granting it", () => {
    const decision = decide(corp(), [sector()], [unownedPool()], plantsCtx);
    const order = decision.newSectors![0].starterOrder!;
    expect(order.unitsOrdered).toBeCloseTo(EXPECTED_UNITS, 6);
    expect(order.costPaidAnchor).toBeCloseTo(EXPECTED_BUILD, 2);
    expect(order.startTurn).toBe(TURN);
    expect(order.onlineTurn).toBe(TURN + Math.ceil(CAPACITY_BUILD_TURNS("manufacturing") / 2));
  });

  it("draws the founded capacity out of the unowned pool", () => {
    const decision = decide(corp(), [sector()], [unownedPool()], plantsCtx);
    expect(decision.unownedDraws).toEqual([
      // `countryId` rides along so the drawdown can UPSERT a pool row that does
      // not exist yet — without it the draw matched nothing and the NPP took its
      // starter capacity for free.
      { stateId: "CA", sectorType: "manufacturing", units: EXPECTED_UNITS, countryId: "US" },
    ]);
  });

  it("scales the founding build to capital instead of a single facility (the $2M-one-plant fix)", () => {
    // The bug: an NPP sitting on cash founded a new sector with exactly one
    // facility and idled the rest, while a player deploys their treasury into
    // dozens of plants. Founding now sizes to a bounded share of surplus.
    const c = corp({ liquidCapital: 2_000_000 });
    const decision = decide(c, [sector()], [unownedPool()], plantsCtx);
    const order = decision.newSectors![0].starterOrder!;
    // Many facilities, not one.
    expect(order.unitsOrdered).toBeGreaterThan(foundingStarterUnits("manufacturing"));
    // Bounded by the founding headroom share so it cannot vacuum a fresh market.
    expect(order.unitsOrdered).toBeLessThanOrEqual(
      Math.floor(POOL_UNITS * NPP_FOUNDING_HEADROOM_SHARE)
    );
    // Never spent below the cash floor.
    expect(decision.updates.liquidCapital as number).toBeGreaterThan(0);
  });

  it("pays the same price a player's founding build pays for the same units", () => {
    // Parity with `expandSector`: same function, same discount, same inputs.
    const decision = decide(corp(), [sector()], [unownedPool()], plantsCtx);
    const order = decision.newSectors![0].starterOrder!;
    const playerPrice = computeBuildCost({
      eraUnitScale: 1,
      sectorType: "manufacturing",
      units: order.unitsOrdered,
      year: CAPACITY_ANCHOR_YEAR,
      marketSharePercent: 0,
      primeRate: 0,
      founding: true,
    }).totalAnchor;
    expect(order.costPaidAnchor).toBeCloseTo(playerPrice, 6);
  });

  it("refuses when the market has no room for one facility", () => {
    const emptyPool = unownedPool({ revenue: 0, headroomUnits: 0 });
    const decision = decide(corp(), [sector()], [emptyPool], plantsCtx);

    expect(decision.newSectors).toBeUndefined();
    expect(decision.unownedDraws).toBeUndefined();
    expect(decision.updates.liquidCapital).toBeUndefined();
  });

  it("ranks candidate markets by headroom units, not by ₳ revenue", () => {
    // Two markets whose ₳ revenue ordering is the OPPOSITE of their unit
    // ordering (a stale/hand-set headroom figure, exactly what a drawn-down pool
    // looks like). Plants must follow the units.
    const richRevenueThinPool = unownedPool({
      _id: new ObjectId(),
      stateId: "NY",
      revenue: POOL_REVENUE * 10,
      headroomUnits: POOL_UNITS * 0.1,
    });
    const leanRevenueDeepPool = unownedPool({
      _id: new ObjectId(),
      stateId: "TX",
      revenue: POOL_REVENUE,
      headroomUnits: POOL_UNITS * 50,
    });
    // HQ state is CA, and neither candidate is there, so ranking decides.
    const c = corp({ headquartersState: "WA" });
    const decision = decide(c, [sector()], [richRevenueThinPool, leanRevenueDeepPool], plantsCtx);
    expect(decision.newSectors![0].stateId).toBe("TX");
  });
});

describe("NPP expansion without plants — unchanged", () => {
  it("still pays the flat 500k and receives free revenue", () => {
    const c = corp();
    const decision = decide(c, [sector()], [unownedPool()]);

    expect(decision.newSectors).toHaveLength(1);
    expect(decision.newSectors![0].starterOrder).toBeUndefined();
    expect(decision.newSectors![0].revenue).toBe(Math.round(POOL_REVENUE * 0.25));
    expect((c.liquidCapital ?? 0) - (decision.updates.liquidCapital as number)).toBe(500_000);
    expect(decision.unownedDraws).toBeUndefined();
  });

  it("still ranks candidate markets by ₳ revenue", () => {
    const richRevenueThinPool = unownedPool({
      _id: new ObjectId(),
      stateId: "NY",
      revenue: POOL_REVENUE * 10,
      headroomUnits: POOL_UNITS * 0.1,
    });
    const leanRevenueDeepPool = unownedPool({
      _id: new ObjectId(),
      stateId: "TX",
      revenue: POOL_REVENUE,
      headroomUnits: POOL_UNITS * 50,
    });
    const decision = decide(
      corp({ headquartersState: "WA" }),
      [sector()],
      [richRevenueThinPool, leanRevenueDeepPool]
    );
    expect(decision.newSectors![0].stateId).toBe("NY");
  });
});
