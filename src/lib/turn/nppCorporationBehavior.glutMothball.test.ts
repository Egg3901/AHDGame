/**
 * Section 2c — glut mothballing (plants only), ticket #1027.
 *
 * Growth/policy governors only STOP a glutted NPP sector from expanding;
 * nothing ever took its capacity off the market, so plants seeded at
 * national-economy scale kept flooding markets clearing at soldFraction
 * 0.01-0.08. These tests pin the shedding gate (fill AND price), the
 * one-state-change-per-corp-per-turn rate limit, the last-active-sector and
 * SOE exemptions, the restart hysteresis, and that the whole section is a
 * no-op below plants.
 */
import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  glutStaggerEligible,
  makeNppCorpDecision,
  type CommodityPriceRatioFn,
  type NppPlantsContext,
} from "./nppCorporationBehavior";
import { ceoArchetypeModifiers } from "./ceoArchetype";
import { CAPACITY_ANCHOR_YEAR } from "@/lib/constants/capacityEconomy";
import type { Corporation, CorporateSector, UnownedSector } from "@/lib/db/types";

const noState = new Set<string>();
const TURN = 100;

/** Every priced output deep in glut — the live #1027 posture (~0.58 of base). */
const glutPrices: CommodityPriceRatioFn = () => 0.58;
/** Every priced output recovered to near balance. */
const recoveredPrices: CommodityPriceRatioFn = () => 0.95;

const plantsCtx: NppPlantsContext = {
  enabled: true,
  eraUnitScale: 1,
  year: CAPACITY_ANCHOR_YEAR,
  preset: "2019-default",
  primeRateOf: () => 0,
  costOfLivingOf: () => null,
};

/** ObjectId whose stagger slot does (or does not) land on TURN. */
function idWithEligibility(eligible: boolean): ObjectId {
  for (;;) {
    const id = new ObjectId();
    if (glutStaggerEligible(id.toString(), TURN) === eligible) return id;
  }
}

function corp(overrides: Partial<Corporation> = {}): Corporation {
  return {
    _id: idWithEligibility(true),
    countryId: "US",
    type: "chemical_industries",
    headquartersState: "TX",
    liquidCapital: 50_000_000,
    ceoType: "npp",
    ...overrides,
  } as unknown as Corporation;
}

function sector(over: Partial<CorporateSector> = {}): CorporateSector {
  return {
    _id: new ObjectId(),
    sectorType: "chemical_industries",
    countryId: "US",
    stateId: "TX",
    revenue: 10_000_000,
    profitMargin: 20,
    effectiveProfitMargin: 20,
    targetGrowthRate: 2,
    ...over,
  } as unknown as CorporateSector;
}

function decide(
  c: Corporation,
  sectors: CorporateSector[],
  priceRatioOf: CommodityPriceRatioFn,
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
    new Map<string, UnownedSector[]>(),
    noState,
    priceRatioOf,
    plants
  );
}

const mothballSets = (d: ReturnType<typeof decide>) =>
  d.sectorUpdates.filter((u) => "mothballed" in ((u.update.$set ?? {}) as Record<string, unknown>));

describe("NPP glut mothballing (plants section 2c)", () => {
  it("mothballs the worst-fill sector when fill and price both read deep glut — one per turn", () => {
    const worst = sector({ soldFraction: 0.03 });
    const alsoBad = sector({ soldFraction: 0.2 });
    const healthy = sector({ soldFraction: 0.9 });
    const d = decide(corp(), [worst, alsoBad, healthy], glutPrices, plantsCtx);
    const sets = mothballSets(d);
    expect(sets).toHaveLength(1);
    expect(sets[0].filter._id).toBe(worst._id);
    expect((sets[0].update.$set as Record<string, unknown>).mothballed).toBe(true);
  });

  it("does not mothball on low fill alone when the price signal reads recovered", () => {
    const d = decide(
      corp(),
      [sector({ soldFraction: 0.03 }), sector({ soldFraction: 0.9 })],
      recoveredPrices,
      plantsCtx
    );
    expect(mothballSets(d)).toHaveLength(0);
  });

  it("a single-sector corp may go fully cold — exempting last sectors would exempt the whole glut", () => {
    const only = sector({ soldFraction: 0.03 });
    const d = decide(corp(), [only], glutPrices, plantsCtx);
    const sets = mothballSets(d);
    expect(sets).toHaveLength(1);
    expect((sets[0].update.$set as Record<string, unknown>).mothballed).toBe(true);
  });

  it("a corp outside its stagger slot makes no state change in either direction", () => {
    const offSlot = corp({ _id: idWithEligibility(false) } as Partial<Corporation>);
    const shed = decide(offSlot, [sector({ soldFraction: 0.03 })], glutPrices, plantsCtx);
    expect(mothballSets(shed)).toHaveLength(0);
    const cold = sector({ soldFraction: 0.03, mothballed: true } as Partial<CorporateSector>);
    const restart = decide(offSlot, [cold], recoveredPrices, plantsCtx);
    expect(mothballSets(restart)).toHaveLength(0);
  });

  it("skips sectors that have never cleared (no soldFraction) and extraction sectors", () => {
    const unclearedSector = sector({ soldFraction: undefined });
    const extraction = sector({ sectorType: "extraction", soldFraction: 0.03 });
    const other = sector({ soldFraction: 0.9 });
    const d = decide(corp(), [unclearedSector, extraction, other], glutPrices, plantsCtx);
    expect(mothballSets(d)).toHaveLength(0);
  });

  it("restarts a mothballed sector once its market prices near balance, and prefers restart over shedding", () => {
    const cold = sector({ soldFraction: 0.03, mothballed: true } as Partial<CorporateSector>);
    const stillBad = sector({ soldFraction: 0.03 });
    const other = sector({ soldFraction: 0.9 });
    const d = decide(corp(), [cold, stillBad, other], recoveredPrices, plantsCtx);
    const sets = mothballSets(d);
    // one state change: the restart — no simultaneous mothball
    expect(sets).toHaveLength(1);
    expect(sets[0].filter._id).toBe(cold._id);
    expect((sets[0].update.$set as Record<string, unknown>).mothballed).toBe(false);
  });

  it("does not restart while prices still read glut (hysteresis band)", () => {
    const cold = sector({ soldFraction: 0.03, mothballed: true } as Partial<CorporateSector>);
    const healthy = sector({ soldFraction: 0.9 });
    const d = decide(corp(), [cold, healthy], glutPrices, plantsCtx);
    expect(mothballSets(d)).toHaveLength(0);
  });

  it("exempts state-owned corps (SOEs are policy instruments)", () => {
    const soe = corp({ countryOwnerId: "US" } as Partial<Corporation>);
    const d = decide(
      soe,
      [sector({ soldFraction: 0.03 }), sector({ soldFraction: 0.9 })],
      glutPrices,
      plantsCtx
    );
    expect(mothballSets(d)).toHaveLength(0);
  });

  it("is a pure no-op below plants", () => {
    const d = decide(
      corp(),
      [sector({ soldFraction: 0.03 }), sector({ soldFraction: 0.9 })],
      glutPrices,
      undefined
    );
    expect(mothballSets(d)).toHaveLength(0);
  });
});
