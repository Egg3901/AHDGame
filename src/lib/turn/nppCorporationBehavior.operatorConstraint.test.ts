/**
 * Binding-constraint telemetry at the behavior boundary (#2122).
 *
 * `rules.test.ts` pins the first-rejecting-gate precedence in isolation. What
 * it cannot prove is that `makeNppCorpDecision` actually flags the leg that bit
 * — that a loss sector trips the growth leg before the budget/dividend legs, a
 * protected core loser trips the divest leg before everything, and a healthy
 * corp reports NO constraint at all. These tests drive real decisions through
 * the brain and assert the resolved `operatorObservation.bindingConstraint`,
 * while the coarse `bindingGate` stays untouched.
 */
import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { makeNppCorpDecision, type CommodityPriceRatioFn } from "./nppCorporationBehavior";
import { ceoArchetypeModifiers } from "./ceoArchetype";
import type { NppCorpDecision, NppCorpDecisionContext } from "./npp/corpDecisionTypes";
import type { Corporation, CorporateSector, UnownedSector } from "@/lib/db/types";

const noPrices: CommodityPriceRatioFn = () => null;
const noState = new Set<string>();
const TURN = 100;

function corp(type: Corporation["type"], liquidCapital: number): Corporation {
  return {
    _id: new ObjectId(),
    name: "Constraint Probe",
    countryId: "US",
    type,
    headquartersState: "NY",
    liquidCurrencyCode: "USD",
    liquidCapital,
    ceoType: "npp",
  } as unknown as Corporation;
}

/** One sector at a fixed realized margin; income = revenue × margin/100. */
function sector(
  sectorType: Corporation["type"],
  margin: number,
  revenue = 1_000_000
): CorporateSector {
  return {
    _id: new ObjectId(),
    sectorType,
    countryId: "US",
    stateId: "NY",
    revenue,
    realizedRevenue: revenue,
    profitMargin: margin,
    effectiveProfitMargin: margin,
    targetGrowthRate: 2,
  } as unknown as CorporateSector;
}

function decide(
  corpType: Corporation["type"],
  liquidCapital: number,
  sectors: CorporateSector[]
): NppCorpDecision {
  const ctx: NppCorpDecisionContext = {
    corp: corp(corpType, liquidCapital),
    sectors,
    turn: TURN,
    now: new Date(),
    fxRate: 1,
    modifiers: ceoArchetypeModifiers("innovator"),
    // Freeze the strategy levers at the identity so the divest floor and
    // growth deltas are exactly the archetype's, not a persisted-strategy
    // artifact.
    strategyLoopEnabled: false,
  };
  return makeNppCorpDecision(ctx, new Map<string, UnownedSector[]>(), noState, noPrices);
}

describe("NPP operator binding constraint", () => {
  it("reports no binding constraint for a healthy, profitable, cash-rich corp", () => {
    const decision = decide("manufacturing", 5_000_000, [sector("manufacturing", 30)]);
    expect(decision.operatorObservation?.bindingConstraint).toBeNull();
  });

  it("names the growth leg above the dividend leg when the growth bill eats the margin", () => {
    const decision = decide("manufacturing", 5_000_000, [
      sector("technology", -5),
      sector("manufacturing", 30),
    ]);
    // Sector realized margin is -5% ⇒ loss, but above the -15 divest floor, so
    // it is retained; the growth governor still back off (growth bill ≥ margin).
    expect(decision.operatorObservation?.bindingConstraint).toBe("growth_unaffordable");
  });

  it("names the budget cash crisis before the dividend cash floor", () => {
    const decision = decide("manufacturing", 100_000, [sector("manufacturing", 30)]);
    expect(decision.operatorObservation?.bindingConstraint).toBe("budget_cash_crisis");
    // The coarse gate is unchanged and still names the cash floor.
    expect(decision.operatorObservation?.bindingGate).toBe("cash_floor");
  });

  it("names the dividend leg when only the payout margin withholds", () => {
    const decision = decide("manufacturing", 5_000_000, [sector("manufacturing", 12)]);
    expect(decision.operatorObservation?.bindingConstraint).toBe("dividend_margin_below_min");
  });

  it("names a protected core loser on the divest leg, before every downstream leg", () => {
    const decision = decide("manufacturing", 100_000, [
      sector("manufacturing", -20),
      sector("technology", 30),
    ]);
    // Core sector at -20% is a divest candidate the brain will not shed, and
    // the corp is also in cash crisis — the first leg still wins.
    expect(decision.operatorObservation?.bindingConstraint).toBe("divest_core_protected");
  });

  it("records a completed shed on the divest leg, before the growth leg", () => {
    const decision = decide("manufacturing", 5_000_000, [
      sector("manufacturing", 30),
      sector("technology", -20),
    ]);
    expect(decision.divestedSectorIds).toHaveLength(1);
    expect(decision.operatorObservation?.bindingConstraint).toBe("divested");
  });
});
