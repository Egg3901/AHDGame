/**
 * Section 2e — input-squeeze strategy shift.
 *
 * A sector can bleed not because its market is glutted (2c) but because its
 * RECIPE is wrong for the price regime: farms on `standard` paying 2x for
 * fertilizers while low-input strategies exist, chemical plants making cheap
 * industrial chemicals while fertilizers run 2.3x. These tests pin the
 * margin trigger, the price-score advantage threshold, the one-shift-per-corp
 * limit, the cooldown/transition guards, and the SOE exemption.
 */
import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  glutStaggerEligible,
  makeNppCorpDecision,
  strategyPriceScore,
  type CommodityPriceRatioFn,
} from "./nppCorporationBehavior";
import { ceoArchetypeModifiers } from "./ceoArchetype";
import { SECTOR_STRATEGIES, STRATEGY_COOLDOWN_TURNS } from "@/lib/constants/sectorStrategies";
import type { CommodityType } from "@/lib/constants/commodities";
import type { Corporation, CorporateSector, UnownedSector } from "@/lib/db/types";

const noState = new Set<string>();
const TURN = 100;

/** Fertilizers expensive (2.3x), industrial chemicals glutted (0.8x), rest flat. */
const fertilizerSqueeze: CommodityPriceRatioFn = (commodity: CommodityType) => {
  if (commodity === "fertilizers") return 2.3;
  if (commodity === "chemicals") return 0.8;
  return 1;
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
    profitMargin: 5,
    effectiveProfitMargin: -10,
    targetGrowthRate: 2,
    ...over,
  } as unknown as CorporateSector;
}

function decide(c: Corporation, sectors: CorporateSector[], ratios: CommodityPriceRatioFn) {
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
    ratios
  );
}

const strategySets = (d: ReturnType<typeof decide>) =>
  d.sectorUpdates.filter((u) => "strategyId" in ((u.update.$set ?? {}) as Record<string, unknown>));

describe("strategyPriceScore", () => {
  const strategies = SECTOR_STRATEGIES.chemical_industries;
  const standard = strategies.find((s) => s.id === "standard")!;
  const fertilizers = strategies.find((s) => s.id === "fertilizers")!;

  it("scores a fertilizer recipe above industrial chemicals under a fertilizer squeeze", () => {
    const std = strategyPriceScore(standard, "US", fertilizerSqueeze)!;
    const fert = strategyPriceScore(fertilizers, "US", fertilizerSqueeze)!;
    expect(fert).toBeGreaterThan(std);
    expect(fert - std).toBeGreaterThan(0.5);
  });

  it("returns null when no commodity on either side has ever priced", () => {
    expect(strategyPriceScore(standard, "US", () => null)).toBeNull();
  });
});

describe("NPP input-squeeze strategy shift (section 2e)", () => {
  it("switches a bleeding chemical sector onto the fertilizer recipe with transition + cooldown", () => {
    const s = sector();
    const d = decide(corp(), [s], fertilizerSqueeze);
    const sets = strategySets(d);
    expect(sets).toHaveLength(1);
    const $set = sets[0].update.$set as Record<string, unknown>;
    expect($set.strategyId).toBe("fertilizers");
    expect($set.transitionFromStrategyId).toBe("standard");
    expect($set.transitionStartTurn).toBe(TURN);
    expect($set.transitionCooldownUntilTurn).toBe(TURN + STRATEGY_COOLDOWN_TURNS);
  });

  it("one shift per corp per turn — picks the largest advantage", () => {
    const a = sector();
    const b = sector();
    const d = decide(corp(), [a, b], fertilizerSqueeze);
    expect(strategySets(d)).toHaveLength(1);
  });

  it("retools even a PROFITABLE sector when the advantage clears the profit-seek bar", () => {
    // The fertilizer squeeze scores ~0.5+ advantage for chemicals — above the
    // 0.25 profit-seek bar, so a +12% sector still switches.
    const profitable = sector({ effectiveProfitMargin: 12 });
    const d = decide(corp(), [profitable], fertilizerSqueeze);
    const sets = strategySets(d);
    expect(sets).toHaveLength(1);
    expect((sets[0].update.$set as Record<string, unknown>).strategyId).toBe("fertilizers");
  });

  it("leaves profitable sectors below the profit-seek bar, cooling-down and mid-transition sectors alone", () => {
    // Mild squeeze: advantage above the distress bar but below profit-seek.
    const mildSqueeze: CommodityPriceRatioFn = (commodity: CommodityType) =>
      commodity === "fertilizers" ? 1.25 : 1;
    const profitable = sector({ effectiveProfitMargin: 12 });
    const cooling = sector({ transitionCooldownUntilTurn: TURN + 5 });
    const transitioning = sector({
      transitionFromStrategyId: "standard",
      strategyId: "fertilizers",
    });
    const d = decide(corp(), [profitable, cooling, transitioning], mildSqueeze);
    expect(strategySets(d)).toHaveLength(0);
  });

  it("does not shift when no candidate beats the current recipe by the threshold", () => {
    const flat: CommodityPriceRatioFn = () => 1;
    const d = decide(corp(), [sector()], flat);
    expect(strategySets(d)).toHaveLength(0);
  });

  it("exempts SOEs and off-slot corps", () => {
    const soe = corp({ countryOwnerId: "US" } as Partial<Corporation>);
    expect(strategySets(decide(soe, [sector()], fertilizerSqueeze))).toHaveLength(0);
    const offSlot = corp({ _id: idWithEligibility(false) });
    expect(strategySets(decide(offSlot, [sector()], fertilizerSqueeze))).toHaveLength(0);
  });
});
