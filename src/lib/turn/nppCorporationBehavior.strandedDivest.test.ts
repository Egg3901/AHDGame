/**
 * Section 1b — stranded-plant divest and state-resolution growth tilt
 * (supply-dislocation remediation phase 2).
 *
 * Pins: the chronic lowFillTurns divest gate and its protections (core type,
 * last sector, profitability, one per turn, mothball exemption), and that the
 * section 2a growth tilt reads the sector's OWN state price ratio when
 * placement signals are provided.
 */
import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  makeNppCorpDecision,
  type CommodityPriceRatioFn,
  type NppPlantsContext,
} from "./nppCorporationBehavior";
import { ceoArchetypeModifiers } from "./ceoArchetype";
import { CAPACITY_ANCHOR_YEAR } from "@/lib/constants/capacityEconomy";
import { STRANDED_DIVEST_TURNS } from "@/lib/corporations/strandedPlant";
import type { PlacementSignals } from "@/lib/turn/npp/marketSignals";
import type { Corporation, CorporateSector, UnownedSector } from "@/lib/db/types";

const noState = new Set<string>();
const TURN = 100;
const atBase: CommodityPriceRatioFn = () => 1;

const plantsCtx: NppPlantsContext = {
  enabled: true,
  eraUnitScale: 1,
  year: CAPACITY_ANCHOR_YEAR,
  preset: "2019-default",
  primeRateOf: () => 0,
  costOfLivingOf: () => null,
};

function corp(overrides: Partial<Corporation> = {}): Corporation {
  return {
    _id: new ObjectId(),
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
    soldFraction: 0.9,
    ...over,
  } as unknown as CorporateSector;
}

function decide(
  c: Corporation,
  sectors: CorporateSector[],
  priceRatioOf: CommodityPriceRatioFn = atBase,
  signals?: PlacementSignals
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
    plantsCtx,
    signals
  );
}

const stranded = (over: Partial<CorporateSector> = {}) =>
  sector({
    sectorType: "manufacturing",
    lowFillTurns: STRANDED_DIVEST_TURNS,
    soldFraction: 0.1,
    ...over,
  });

describe("NPP stranded-plant divest (section 1b)", () => {
  it("divests a non-core plant stranded for STRANDED_DIVEST_TURNS", () => {
    const bad = stranded();
    const d = decide(corp(), [bad, sector()]);
    expect(d.divestedSectorIds).toContainEqual(bad._id);
  });

  it("does not divest below the turn threshold", () => {
    const almost = stranded({ lowFillTurns: STRANDED_DIVEST_TURNS - 1 });
    const d = decide(corp(), [almost, sector()]);
    expect(d.divestedSectorIds ?? []).not.toContainEqual(almost._id);
  });

  it("never divests the corp's core type, no matter how stranded", () => {
    const coreButStranded = stranded({ sectorType: "chemical_industries" });
    const d = decide(corp(), [coreButStranded, sector({ sectorType: "manufacturing" })]);
    expect(d.divestedSectorIds ?? []).not.toContainEqual(coreButStranded._id);
  });

  it("caps stranded divests at one per turn, exiting the longest-stranded plant", () => {
    const worst = stranded({
      sectorType: "manufacturing",
      lowFillTurns: STRANDED_DIVEST_TURNS + 8,
    });
    const alsoBad = stranded({ sectorType: "agriculture" });
    const d = decide(corp(), [worst, alsoBad, sector()]);
    const divested = d.divestedSectorIds ?? [];
    expect(divested).toContainEqual(worst._id);
    expect(divested).not.toContainEqual(alsoBad._id);
  });

  it("leaves a mothballed plant alone — deliberately idle is the glut response, not stranding", () => {
    const cold = stranded({ mothballed: true });
    const d = decide(corp(), [cold, sector()]);
    expect(d.divestedSectorIds ?? []).not.toContainEqual(cold._id);
  });

  it("never divests the last remaining sector", () => {
    const only = stranded();
    const d = decide(corp(), [only]);
    expect(d.divestedSectorIds ?? []).not.toContainEqual(only._id);
  });
});

describe("state-resolution growth tilt (section 2a via placement signals)", () => {
  const growthSetFor = (d: ReturnType<typeof decide>, id: ObjectId) =>
    d.sectorUpdates.find(
      (u) =>
        u.filter._id === id &&
        "targetGrowthRate" in ((u.update.$set ?? {}) as Record<string, unknown>)
    );

  it("a glut in the sector's OWN state cuts growth even when the country reads balanced", () => {
    // Thin margin (5) holds the ladder at the current target, so the only
    // mover is the shortage tilt — the thing under test.
    const inGlutState = sector({
      stateId: "TX",
      targetGrowthRate: 2,
      profitMargin: 5,
      effectiveProfitMargin: 5,
    });
    const signals: PlacementSignals = {
      statePriceRatioOf: (_c, stateId) => (stateId === "TX" ? 0.6 : 1.0),
    };
    const withSignals = decide(corp(), [inGlutState, sector({ stateId: "NY" })], atBase, signals);
    const set = growthSetFor(withSignals, inGlutState._id);
    expect(set).toBeDefined();
    expect(
      ((set!.update.$set ?? {}) as Record<string, unknown>).targetGrowthRate as number
    ).toBeLessThan(2);
  });

  it("without signals the same sector keeps its country-scope behavior", () => {
    const inGlutState = sector({
      stateId: "TX",
      targetGrowthRate: 2,
      profitMargin: 5,
      effectiveProfitMargin: 5,
    });
    const noSignals = decide(corp(), [inGlutState, sector({ stateId: "NY" })], atBase);
    const set = growthSetFor(noSignals, inGlutState._id);
    const target = set
      ? (((set.update.$set ?? {}) as Record<string, unknown>).targetGrowthRate as number)
      : 2;
    expect(target).toBeGreaterThanOrEqual(2);
  });
});
