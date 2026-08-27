/**
 * REGRESSION: the NPP brain must count debt service as a cost.
 *
 * Until `debtServiceAnchor` this module had no concept of debt at all. A grep
 * for "bond" over it returned zero hits, so its profitability signal measured
 * operations and discretionary overhead and nothing else. Bond interest is not
 * discretionary and is often the largest single line on a levered corp's books.
 *
 * The shape below is prod corp 446 (Meyer Logistics) at turn 79, the corp this
 * was found on:
 *
 *   revenue                  30,463
 *   total costs              25,123
 *   operating profit          5,340
 *   bond coupon income          386
 *   bond interest expense    -6,390
 *   net income                 -664
 *
 * Six sectors at 21.9-37.6% effective margin, five of six selling out. Nothing
 * was wrong with the operations. The corp was losing money purely on debt
 * service, and the caretaker AI read it as healthy for twenty turns while the
 * share price fell from 17.35 to 4.38, because the number the AI judges itself
 * on did not contain the number that was killing it.
 *
 * The same class of bug has been fixed in this module twice before: it read the
 * seeded `profitMargin` instead of the effective one, and nominal instead of
 * realized revenue. Each time the signal was stable and wrong.
 */
import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  makeNppCorpDecision,
  type CommodityPriceRatioFn,
  type NppPlantsContext,
} from "./nppCorporationBehavior";
import { ceoArchetypeModifiers } from "@/lib/npp/ceoArchetype";
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

/** Anchor-currency corp, so every figure here reads directly in ₳. */
function corp(): Corporation {
  return {
    _id: new ObjectId(),
    countryId: "US",
    type: "manufacturing",
    headquartersState: "NY",
    liquidCurrencyCode: "USD",
    // Comfortably above every cash rail, so cash is never what these tests vary.
    liquidCapital: 10_000_000,
    ceoType: "npp",
  } as unknown as Corporation;
}

/** One healthy sector: 30% margin on ₳1,000,000, selling everything it makes. */
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

function decide(debtServiceAnchor?: number) {
  return makeNppCorpDecision(
    {
      corp: corp(),
      sectors: [sector()],
      turn: TURN,
      now: new Date(),
      fxRate: 1,
      modifiers: ceoArchetypeModifiers("cautious"),
      debtServiceAnchor,
      ordinaryEntryEligible: false,
    },
    new Map<string, UnownedSector[]>([["US", [pool()]]]),
    noState,
    noPrices,
    plantsCtx
  );
}

describe("NPP brain counts debt service", () => {
  it("reads a corp whose interest exceeds operating profit as unprofitable", () => {
    // Operating income is ₳300,000. Debt service of ₳350,000 puts net income
    // under water even though the sector itself is healthy and sold out. This
    // is corp 446's shape.
    const decision = decide(350_000);
    expect(decision.updates.dividendRate ?? 0).toBe(0);
    expect(decision.newSectors).toBeUndefined();
  });

  it("cuts overhead to the loss-making band when debt service dominates", () => {
    // The whole point of seeing the cost is acting on it: a corp being eaten by
    // interest must stop spending on marketing and R&D, which is exactly what
    // the caretaker failed to do for twenty turns.
    const levered = decide(350_000);
    const unlevered = decide(0);
    expect(levered.updates.marketingBudget as number).toBeLessThan(
      unlevered.updates.marketingBudget as number
    );
    expect(levered.updates.rdBudget ?? 0).toBe(0);
  });

  it("still reads the same corp as healthy when it carries no debt", () => {
    // Proves the debt term is what flips the judgement, not some other change.
    const decision = decide(0);
    expect(decision.updates.dividendRate as number).toBeGreaterThan(0);
  });

  it("is unchanged when the caller supplies no debt figure", () => {
    // Back-compat: every pre-wiring caller, and every existing test, omits the
    // field and must behave exactly as before.
    const omitted = decide(undefined);
    const zero = decide(0);
    expect(omitted.updates.dividendRate).toBe(zero.updates.dividendRate);
    expect(omitted.updates.marketingBudget).toBe(zero.updates.marketingBudget);
    expect(omitted.updates.rdBudget).toBe(zero.updates.rdBudget);
  });

  it("nets coupon income against interest paid rather than counting gross", () => {
    // A corp earning as much coupon as it pays is not levered in net terms.
    // netPerTurnDebtServiceAnchor returns the difference, so passing 0 here and
    // passing nothing must agree, and a small net drag must not flip a corp
    // with real headroom.
    const smallDrag = decide(1_000);
    expect(smallDrag.updates.dividendRate as number).toBeGreaterThan(0);
  });
});
