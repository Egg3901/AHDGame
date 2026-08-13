/**
 * REGRESSION — the NPP cash rails must be reachable in a 1953-scale world.
 *
 * `CASH_FLOOR` / `SAFE_CASH_FLOOR_MIN` / `EXPANSION_MIN_CASH` gate EVERY
 * discretionary decision the brain makes: dividends (section 4), expansion
 * (section 5) and the growth leg of capacity reinvestment (section 6). They
 * were authored at a modern-era money scale (₳2,000,000 floor) and never
 * re-based for the 1953 worlds that actually run.
 *
 * Measured on prod at turn 79, across a 200-corp sample of the 476 NPP-run
 * corps: median liquid capital ₳1,724,110, and 105 of 200 BELOW the floor. Over
 * half the AI cohort was locked out of expanding, paying a dividend or buying
 * growth capacity — permanently, since a corp under the floor cannot spend to
 * earn its way back over it. The visible symptom was a corp with healthy
 * sectors (20-35% margins, selling out) whose share price fell for twenty turns
 * while it sat on idle cash doing nothing. Meyer Logistics, prod corp 446, is
 * the worked example: ₳1,199,942 of cash, six sectors at 21.9-37.6% margin,
 * share price 17.35 → 4.38 over turns 59-79.
 *
 * These tests pin corp-cash levels that were frozen under the old constants and
 * must now act. The `aggressive` case is the important one: `SAFE_CASH_FLOOR_MIN`
 * is a MAX() rail, so leaving it at ₳1,000,000 while lowering `CASH_FLOOR` would
 * have clamped the floor straight back up and made the whole change inert.
 */
import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  makeNppCorpDecision,
  type CommodityPriceRatioFn,
  type NppPlantsContext,
} from "./nppCorporationBehavior";
import { ceoArchetypeModifiers } from "@/lib/npp/ceoArchetype";
import type { CeoArchetype } from "@/lib/npp/ceoArchetype";
import type { Corporation, CorporateSector, UnownedSector } from "@/lib/db/types";
import { CAPACITY_ANCHOR_YEAR } from "@/lib/constants/capacityEconomy";
import { computeUnownedHeadroomUnits } from "@/lib/market/unownedHeadroom";

const noPrices: CommodityPriceRatioFn = () => null;
const noState = new Set<string>();
const TURN = 100;

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

/** Anchor-currency corp, so every figure below reads directly in ₳. */
function corp(liquidCapital: number): Corporation {
  return {
    _id: new ObjectId(),
    countryId: "US",
    type: "manufacturing",
    headquartersState: "NY",
    liquidCurrencyCode: "USD",
    liquidCapital,
    ceoType: "npp",
  } as unknown as Corporation;
}

/** One healthy sector: 30% margin, selling into a real market. */
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
  } as unknown as CorporateSector;
}

function decide(liquidCapital: number, archetype: CeoArchetype) {
  return makeNppCorpDecision(
    {
      corp: corp(liquidCapital),
      sectors: [sector()],
      turn: TURN,
      now: new Date(),
      fxRate: 1,
      modifiers: ceoArchetypeModifiers(archetype),
    },
    new Map<string, UnownedSector[]>([["US", [pool()]]]),
    noState,
    noPrices,
    plantsCtx
  );
}

describe("NPP cash rails at 1953 scale", () => {
  it("pays a dividend at a cash level the old ₳2,000,000 floor froze", () => {
    // cautious floor = max(SAFE_CASH_FLOOR_MIN, CASH_FLOOR × 1.5) = ₳375,000.
    // Under the old constants that was max(1,000,000, 3,000,000) = ₳3,000,000,
    // so this corp — profitable, 30% margin — paid nothing.
    const decision = decide(1_000_000, "cautious");
    expect(decision.updates.dividendRate).toBeGreaterThan(0);
  });

  it("keeps the safety rail from clamping the floor back up", () => {
    // THE INERT-CHANGE GUARD. aggressive floor = max(SAFE_CASH_FLOOR_MIN,
    // CASH_FLOOR × 0.6) = max(125,000, 150,000) = ₳150,000. If
    // SAFE_CASH_FLOOR_MIN were still ₳1,000,000 the MAX() would return that
    // instead and this corp would be frozen exactly as before.
    const decision = decide(200_000, "aggressive");
    expect(decision.updates.dividendRate).toBeGreaterThan(0);
  });

  it("still refuses a corp genuinely below its floor", () => {
    // The rail must keep doing its job — ₳50,000 is under every archetype's
    // floor, so no dividend and no expansion.
    const decision = decide(50_000, "aggressive");
    expect(decision.updates.dividendRate ?? 0).toBe(0);
    expect(decision.newSectors).toBeUndefined();
  });

  it("lets a mid-size corp reach the expansion gate", () => {
    // cautious expansion needs surplus > EXPANSION_MIN_CASH × 1.5 = ₳937,500
    // on top of the ₳375,000 floor. Under the old constants that was ₳7,500,000
    // of surplus over a ₳3,000,000 floor — unreachable for most of the cohort.
    const decision = decide(4_000_000, "cautious");
    expect(decision.newSectors).toHaveLength(1);
  });
});
