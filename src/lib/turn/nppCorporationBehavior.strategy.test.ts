/**
 * Integration: the v5 strategy loop must actually reach the brain's decisions.
 *
 * `corpStrategy.test.ts` proves the loop picks the right strategy. This file
 * proves the pick changes what the corp DOES, which is the part that can rot
 * silently: a lever wired into four of six sites still looks green in unit
 * tests while the corp keeps expanding.
 */
import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  makeNppCorpDecision,
  type CommodityPriceRatioFn,
  type NppPlantsContext,
} from "./nppCorporationBehavior";
import { ceoArchetypeModifiers } from "@/lib/npp/ceoArchetype";
import type { NppStrategyState } from "@/lib/turn/npp/corpStrategy";
import type { Corporation, CorporateSector, UnownedSector } from "@/lib/db/types";
import { CAPACITY_ANCHOR_YEAR } from "@/lib/constants/capacityEconomy";
import { computeUnownedHeadroomUnits } from "@/lib/market/unownedHeadroom";

const noPrices: CommodityPriceRatioFn = () => null;
const noState = new Set<string>();
const TURN = 1000;

const POOL_REVENUE_ANCHOR = 40_000_000;
const POOL_UNITS = computeUnownedHeadroomUnits("manufacturing", POOL_REVENUE_ANCHOR, 1);

const plantsCtx: NppPlantsContext = {
  enabled: true,
  eraUnitScale: 1,
  year: CAPACITY_ANCHOR_YEAR,
  preset: "2019-default",
  primeRateOf: () => 0,
  costOfLivingOf: () => null,
};

function pool(): UnownedSector {
  return {
    _id: new ObjectId(),
    stateId: "NY",
    countryId: "US",
    sectorType: "manufacturing",
    revenue: POOL_REVENUE_ANCHOR,
    headroomUnits: POOL_UNITS,
  } as unknown as UnownedSector;
}

function corp(overrides: Partial<Corporation> = {}): Corporation {
  return {
    _id: new ObjectId(),
    countryId: "US",
    type: "manufacturing",
    headquartersState: "NY",
    liquidCurrencyCode: "USD",
    liquidCapital: 10_000_000,
    ceoType: "npp",
    ...overrides,
  } as unknown as Corporation;
}

/** Healthy, sold out, 30% margin: a corp with every reason to be left alone. */
function sector(): CorporateSector {
  return {
    _id: new ObjectId(),
    sectorType: "technology",
    countryId: "US",
    stateId: "NY",
    revenue: 1_000_000,
    realizedRevenue: 1_000_000,
    profitMargin: 30,
    effectiveProfitMargin: 30,
    targetGrowthRate: 2,
    capitalStock: 1000,
    producedUnits: 1000,
    soldUnits: 1000,
    soldFraction: 1,
  } as unknown as CorporateSector;
}

function decide(strategy?: NppStrategyState, over: Partial<Corporation> = {}) {
  return makeNppCorpDecision(
    {
      corp: corp(over),
      sectors: [sector()],
      turn: TURN,
      now: new Date(),
      fxRate: 1,
      modifiers: ceoArchetypeModifiers("cautious"),
      strategy,
      // Off the stagger slot, so these tests exercise the LEVERS of a given
      // strategy rather than the switching logic.
      strategyEligible: false,
    },
    new Map<string, UnownedSector[]>([["US", [pool()]]]),
    noState,
    noPrices,
    plantsCtx
  );
}

const held = (id: NppStrategyState["id"]): NppStrategyState => ({
  id,
  adoptedTurn: TURN - 1,
  baselineScore: 0,
});

describe("strategy levers reach the decision", () => {
  it("adopts expand on first sight and persists it", () => {
    const d = decide(undefined);
    expect(d.strategy?.id).toBe("expand");
    expect(d.strategy?.adoptedTurn).toBe(TURN);
  });

  it("leaves a healthy corp's behaviour unchanged under expand", () => {
    // THE SHIP-SAFETY PROPERTY, end to end. Every corp adopts expand on first
    // sight, so if this diverges, introducing the loop changes behaviour for
    // every healthy corp in a live world.
    const withLoop = decide(held("expand"));
    const firstSight = decide(undefined);
    expect(withLoop.updates.marketingBudget).toBe(firstSight.updates.marketingBudget);
    expect(withLoop.updates.rdBudget).toBe(firstSight.updates.rdBudget);
    expect(withLoop.updates.dividendRate).toBe(firstSight.updates.dividendRate);
    expect(!!withLoop.newSectors).toBe(!!firstSight.newSectors);
  });

  it("stops a harvesting corp expanding, and raises its payout", () => {
    const expand = decide(held("expand"));
    const harvest = decide(held("harvest"));
    expect(expand.newSectors).toHaveLength(1);
    expect(harvest.newSectors).toBeUndefined();
    expect(harvest.updates.dividendRate as number).toBeGreaterThan(
      expand.updates.dividendRate as number
    );
    expect(harvest.updates.marketingBudget as number).toBeLessThan(
      expand.updates.marketingBudget as number
    );
  });

  it("cuts a retrenching corp to the bone and pays nothing", () => {
    const retrench = decide(held("retrench"));
    expect(retrench.updates.dividendRate ?? 0).toBe(0);
    expect(retrench.updates.rdBudget ?? 0).toBe(0);
    expect(retrench.newSectors).toBeUndefined();
    const expand = decide(held("expand"));
    expect(retrench.updates.marketingBudget as number).toBeLessThan(
      expand.updates.marketingBudget as number
    );
  });

  it("raises marketing when defending instead of buying capacity", () => {
    const defend = decide(held("defend"));
    const expand = decide(held("expand"));
    expect(defend.updates.marketingBudget as number).toBeGreaterThan(
      expand.updates.marketingBudget as number
    );
    expect(defend.newSectors).toBeUndefined();
  });

  it("lets a pivoting corp enter a new market", () => {
    // Pivot is the one non-expand strategy that may still spend on entry: that
    // combination IS the pivot.
    expect(decide(held("pivot")).newSectors).toHaveLength(1);
  });

  it("holds a caretaker to the value-preserving menu", () => {
    // An NPP minding a player's company must not gamble with it. A caretaker
    // carrying a strategy it is no longer allowed to run is moved off it.
    const d = decide(held("pivot"), {
      caretakerCeo: { underlyingCharacterId: new ObjectId(), appointedTurn: 1 },
    } as unknown as Partial<Corporation>);
    expect(d.strategy?.id).not.toBe("pivot");
    expect(d.newSectors).toBeUndefined();
  });

  it("keeps the growth target down while harvesting", () => {
    // Section 2 is per-sector and separate from the budget/dividend sites, so
    // it needs its own check: a lever wired into most sites still looks green.
    const harvest = decide(held("harvest"));
    const expand = decide(held("expand"));
    const growthOf = (d: ReturnType<typeof decide>) =>
      d.sectorUpdates
        .map((u) => u.update.$set?.targetGrowthRate)
        .find((v) => typeof v === "number") as number | undefined;
    const h = growthOf(harvest);
    const e = growthOf(expand);
    // Expand raises the healthy sector's target; harvest must not.
    expect(e ?? 2).toBeGreaterThan(h ?? 0);
  });
});
