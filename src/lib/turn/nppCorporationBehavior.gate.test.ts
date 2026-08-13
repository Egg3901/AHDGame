/**
 * REGRESSION: the v5 strategy loop must have a working kill switch.
 *
 * The loop shipped to a live world at turn 98 with no gate, so the only way to
 * turn it off was a revert PR and a redeploy. `nppCorpStrategyEnabled` is the
 * switch. Two properties matter and both are easy to get wrong:
 *
 *   1. ABSENT MEANS ON. Every other flag on the feature-gates surface reads
 *      `doc[key] === true`, so a field never written reads false. Adding this
 *      one that way would have reported OFF on every existing world while the
 *      engine ran it. Only an explicit `false` disables.
 *   2. OFF IS THE OLD BRAIN EXACTLY. Disabled pins the corp to the `expand`
 *      levers, which are byte-identical to pre-v5, so the switch is a true
 *      revert rather than a fifth behaviour.
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

function corp(): Corporation {
  return {
    _id: new ObjectId(),
    countryId: "US",
    type: "manufacturing",
    headquartersState: "NY",
    liquidCurrencyCode: "USD",
    liquidCapital: 10_000_000,
    ceoType: "npp",
  } as unknown as Corporation;
}

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

function decide(strategyLoopEnabled: boolean | undefined, strategy?: NppStrategyState) {
  return makeNppCorpDecision(
    {
      corp: corp(),
      sectors: [sector()],
      turn: TURN,
      now: new Date(),
      fxRate: 1,
      modifiers: ceoArchetypeModifiers("cautious"),
      strategy,
      strategyEligible: true,
      strategyLoopEnabled,
    },
    new Map<string, UnownedSector[]>([["US", [pool()]]]),
    noState,
    noPrices,
    plantsCtx
  );
}

// A corp that is HOLDING harvest: the baseline is one it clears, so the loop
// leaves it alone. Sized deliberately, because a baseline it fails would make
// the loop switch away and these cases would be testing the switching logic
// (covered in corpStrategy.test.ts) rather than the levers.
const harvesting: NppStrategyState = {
  id: "harvest",
  adoptedTurn: TURN - 100,
  baselineScore: 0,
};

describe("nppCorpStrategyEnabled kill switch", () => {
  it("treats an absent flag as enabled", () => {
    // The whole point: existing worlds were promoted with the loop ON and must
    // keep it without an admin write.
    expect(decide(undefined).strategy?.id).toBe("expand");
    expect(decide(undefined).strategy).toBeDefined();
  });

  it("pins a corp to the expand levers when disabled", () => {
    // A corp mid-harvest, which forbids expansion and raises payout, must fall
    // straight back to the pre-v5 behaviour rather than stay harvesting.
    const off = decide(false, harvesting);
    const on = decide(true, harvesting);
    expect(on.newSectors).toBeUndefined();
    expect(off.newSectors).toHaveLength(1);
    expect(off.updates.dividendRate as number).toBeLessThan(on.updates.dividendRate as number);
  });

  it("stops writing strategy memory when disabled", () => {
    // No stale state to resume from if the switch is flipped back, and nothing
    // accumulating in the corp doc while the feature is off.
    expect(decide(false, harvesting).strategy).toBeUndefined();
  });

  it("is byte-identical to the pre-v5 brain when off", () => {
    // Disabled must equal expand exactly, not merely resemble it.
    const off = decide(false, harvesting);
    const expandOn = decide(true, {
      id: "expand",
      adoptedTurn: TURN - 100,
      baselineScore: 0,
    });
    expect(off.updates.marketingBudget).toBe(expandOn.updates.marketingBudget);
    expect(off.updates.rdBudget).toBe(expandOn.updates.rdBudget);
    expect(off.updates.dividendRate).toBe(expandOn.updates.dividendRate);
  });
});
