/**
 * Section 2c extension — cost mothballing + ordinary-entry glut floor
 * (demand audit step 5).
 *
 * Live, 248 of 254 losing plants clear ABOVE the glut-mothball fill gate:
 * they sell everything yet bleed on costs, so fill-based machinery (mothball,
 * stranded divest) cannot see them. These tests pin the P&L-chronicity
 * counter, the cost-mothball trigger and its guard rails, and the ordinary
 * founding glut floor.
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
import { computeUnownedHeadroomUnits } from "@/lib/market/unownedHeadroom";
import type { Corporation, CorporateSector, UnownedSector } from "@/lib/db/types";

const noState = new Set<string>();
const TURN = 100;
const healthyPrices: CommodityPriceRatioFn = () => 1.0;
const glutPrices: CommodityPriceRatioFn = () => 0.5;

const plantsCtx: NppPlantsContext = {
  enabled: true,
  eraUnitScale: 1,
  year: CAPACITY_ANCHOR_YEAR,
  preset: "2019-default",
  primeRateOf: () => 0,
  costOfLivingOf: () => null,
};

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
    type: "telecommunications",
    headquartersState: "NY",
    liquidCapital: 50_000_000,
    ceoType: "npp",
    ...overrides,
  } as unknown as Corporation;
}

/** A telecom plant selling nearly everything, losing money on costs. */
function costLoser(over: Partial<CorporateSector> = {}): CorporateSector {
  return {
    _id: new ObjectId(),
    sectorType: "telecommunications",
    countryId: "US",
    stateId: "NY",
    revenue: 1_000_000,
    realizedRevenue: 1_000_000,
    profitMargin: 35,
    effectiveProfitMargin: 35,
    targetGrowthRate: 2,
    soldFraction: 0.95,
    plantsPnl: { revenue: 1_000_000, profit: -50_000 } as CorporateSector["plantsPnl"],
    ...over,
  } as unknown as CorporateSector;
}

function decide(
  c: Corporation,
  sectors: CorporateSector[],
  priceRatioOf: CommodityPriceRatioFn,
  plants?: NppPlantsContext,
  unowned: Map<string, UnownedSector[]> = new Map()
) {
  return makeNppCorpDecision(
    {
      corp: c,
      sectors,
      turn: TURN,
      now: new Date(),
      modifiers: ceoArchetypeModifiers("cautious"),
    },
    unowned,
    noState,
    priceRatioOf,
    plants
  );
}

const pnlSets = (d: ReturnType<typeof decide>) =>
  d.sectorUpdates.filter(
    (u) => "pnlLossTurns" in ((u.update.$set ?? {}) as Record<string, unknown>)
  );
const mothballSets = (d: ReturnType<typeof decide>) =>
  d.sectorUpdates.filter((u) => "mothballed" in ((u.update.$set ?? {}) as Record<string, unknown>));

describe("NPP P&L-loss chronicity counter", () => {
  it("increments on a losing turn and resets on a profitable one", () => {
    const losing = costLoser({ pnlLossTurns: 5 });
    const d = decide(corp(), [losing], healthyPrices, plantsCtx);
    const sets = pnlSets(d);
    expect(sets).toHaveLength(1);
    expect((sets[0].update.$set as Record<string, unknown>).pnlLossTurns).toBe(6);

    const recovered = costLoser({
      pnlLossTurns: 5,
      plantsPnl: { revenue: 1_000_000, profit: 10_000 } as CorporateSector["plantsPnl"],
    });
    const d2 = decide(corp(), [recovered], healthyPrices, plantsCtx);
    const sets2 = pnlSets(d2);
    expect(sets2).toHaveLength(1);
    expect((sets2[0].update.$set as Record<string, unknown>).pnlLossTurns).toBe(0);
  });

  it("holds the count while mothballed and writes nothing below plants", () => {
    // Glut prices so the restart pass stays quiet: the ONLY acceptable write
    // touching this sector would be a counter change, of which there is none.
    const cold = costLoser({ mothballed: true, pnlLossTurns: 12 });
    expect(pnlSets(decide(corp(), [cold], glutPrices, plantsCtx))).toHaveLength(0);

    const losing = costLoser({ pnlLossTurns: 5 });
    expect(pnlSets(decide(corp(), [losing], healthyPrices, undefined))).toHaveLength(0);
  });
});

describe("NPP cost mothballing", () => {
  it("mothballs a chronic cost-loser with healthy fill and price", () => {
    const loser = costLoser({ pnlLossTurns: 12 });
    const d = decide(corp(), [loser], healthyPrices, plantsCtx);
    const sets = mothballSets(d);
    expect(sets).toHaveLength(1);
    expect(sets[0].filter._id).toBe(loser._id);
    expect((sets[0].update.$set as Record<string, unknown>).mothballed).toBe(true);
  });

  it("leaves a sub-chronic loser and a profitable plant alone", () => {
    const young = costLoser({ pnlLossTurns: 11 });
    expect(mothballSets(decide(corp(), [young], healthyPrices, plantsCtx))).toHaveLength(0);

    const profitable = costLoser({
      pnlLossTurns: 30,
      plantsPnl: { revenue: 1_000_000, profit: 10_000 } as CorporateSector["plantsPnl"],
    });
    expect(mothballSets(decide(corp(), [profitable], healthyPrices, plantsCtx))).toHaveLength(0);
  });

  it("sheds fill first: one state change per corp per turn", () => {
    const fillLoser = costLoser({ soldFraction: 0.03 });
    const costLoserOld = costLoser({ pnlLossTurns: 40, soldFraction: 0.95 });
    // Deep-glut prices so the fill trigger fires for fillLoser.
    const d = decide(corp(), [fillLoser, costLoserOld], glutPrices, plantsCtx);
    const sets = mothballSets(d);
    expect(sets).toHaveLength(1);
    expect(sets[0].filter._id).toBe(fillLoser._id);
  });

  it("exempts SOEs and extraction, and resets the count on restart", () => {
    const soeLoser = costLoser({ pnlLossTurns: 40 });
    const soe = corp({ countryOwnerId: "US" } as Partial<Corporation>);
    expect(mothballSets(decide(soe, [soeLoser], healthyPrices, plantsCtx))).toHaveLength(0);

    const mine = costLoser({ sectorType: "extraction", pnlLossTurns: 40 });
    expect(mothballSets(decide(corp(), [mine], healthyPrices, plantsCtx))).toHaveLength(0);

    const cold = costLoser({ mothballed: true, pnlLossTurns: 40 });
    const d = decide(corp(), [cold], healthyPrices, plantsCtx);
    const sets = mothballSets(d).filter(
      (u) => (u.update.$set as Record<string, unknown>).mothballed === false
    );
    expect(sets).toHaveLength(1);
    expect((sets[0].update.$set as Record<string, unknown>).pnlLossTurns).toBe(0);
  });
});

const POOL_UNITS = computeUnownedHeadroomUnits("manufacturing", 40_000_000, 1);

function manufacturingCorp(): Corporation {
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

function healthySector(): CorporateSector {
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

function manufacturingPool(): Map<string, UnownedSector[]> {
  return new Map([
    [
      "US",
      [
        {
          _id: new ObjectId(),
          stateId: "NY",
          countryId: "US",
          sectorType: "manufacturing",
          revenue: 40_000_000,
          headroomUnits: POOL_UNITS,
        } as unknown as UnownedSector,
      ],
    ],
  ]);
}

describe("ordinary-entry glut floor", () => {
  it("blocks founding into a glutted market but allows a balanced one", () => {
    const blocked = decide(
      manufacturingCorp(),
      [healthySector()],
      glutPrices,
      plantsCtx,
      manufacturingPool()
    );
    expect(blocked.newSectors ?? []).toHaveLength(0);

    const allowed = decide(
      manufacturingCorp(),
      [healthySector()],
      healthyPrices,
      plantsCtx,
      manufacturingPool()
    );
    expect(allowed.newSectors ?? []).toHaveLength(1);
  });

  it("fails open when no leg is priced", () => {
    const d = decide(
      manufacturingCorp(),
      [healthySector()],
      () => null,
      plantsCtx,
      manufacturingPool()
    );
    expect(d.newSectors ?? []).toHaveLength(1);
  });
});
