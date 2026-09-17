import { describe, it, expect } from "vitest";
import {
  SECTOR_STRATEGIES,
  STRATEGY_TRANSITION_TURNS,
  getEffectiveStrategyRates,
  getStrategy,
} from "@/lib/constants/sectorStrategies";
import type { CorporationType } from "@/lib/constants/corporations";
import type { CommodityType } from "@/lib/constants/commodities";
import {
  capacityRescaleRatio,
  revenuePerCapacityUnitForStrategy,
  unitYieldForSupply,
} from "@/lib/constants/capacityEconomy";
import {
  needsRetoolStockCatchup,
  retoolBlendRatio,
  retoolOperatingCapacityRatio,
  transitionalOperatingCapacity,
} from "./rules";
import { healRetoolStockBasis } from "../retoolRescale";
import { computePlantsCapacity } from "@/lib/turn/corporation/sectorTurn/plantsCapacity";

/**
 * Issue #2009 - extraction auto-retool unit-basis collapse.
 *
 * A transition committed pre-rescale (or under capital mode) surfaces under
 * plants with source-basis capitalStock and no rescale flag. Applying the
 * transitional blend ratio to that unconverted stock minted ~390x operating
 * capacity (2,314.82 owned -> 903,166 operating units, oil_gas to
 * rare_earth_mining, four turns in), flooding supply and collapsing the sector
 * into a loss spiral at 100% sell-through.
 *
 * This suite proves the fix from the destination technology's productivity
 * (unit yields / RPU), not from hardcoded snapshots: every extraction
 * strategy pair, every transition step, every legacy document shape.
 */

const SECTOR_TYPE = "extraction" as const;
type StrategyId = string;
type Pair = [StrategyId, StrategyId];

/** The complete matrix, derived from the canonical strategy registry. */
function extractionIds(): StrategyId[] {
  return (SECTOR_STRATEGIES[SECTOR_TYPE] ?? []).map((s) => s.id);
}

function extractionPairs(): Pair[] {
  const ids = extractionIds();
  const pairs: Pair[] = [];
  for (const from of ids) for (const to of ids) if (from !== to) pairs.push([from, to]);
  return pairs;
}

function supplyOf(strategyId: string): Partial<Record<CommodityType, number>> {
  return getStrategy(SECTOR_TYPE, strategyId).supply as Partial<Record<CommodityType, number>>;
}

/** Destination-technology price of one operating unit at this transition step. */
function effectiveMixPrice(to: string, from: string, startTurn: number, turn: number): number {
  const effective = getEffectiveStrategyRates(SECTOR_TYPE, to, from, startTurn, turn);
  const yield_ = unitYieldForSupply(effective.supply, 1);
  return yield_ > 0 ? 1 / yield_ : 0;
}

const START = 95;
const STEPS = Array.from({ length: STRATEGY_TRANSITION_TURNS + 2 }, (_, i) => i).concat([
  STRATEGY_TRANSITION_TURNS + 8,
]);

/** Pairs exercised by the table tests below; the completeness test pins this. */
const exercisedPairs: Pair[] = [];

describe("issue #2009 - the pair matrix is complete and registry-derived", () => {
  it("derives every ordered extraction pair from SECTOR_STRATEGIES", () => {
    const ids = extractionIds();
    expect(ids.length).toBeGreaterThanOrEqual(2);
    const pairs = extractionPairs();
    // Ordered pairs without replacement: n * (n - 1). Six strategies today,
    // so thirty pairs; a future strategy expands this automatically.
    expect(pairs.length).toBe(ids.length * (ids.length - 1));
    expect(pairs.length).toBe(30);
    expect([...ids].sort()).toEqual(
      [
        "coal_mining",
        "iron_mining",
        "oil_gas",
        "rare_earth_mining",
        "standard",
        "timber_logging",
      ].sort()
    );
    const seen = new Set(pairs.map(([f, t]) => `${f}->${t}`));
    expect(seen.size).toBe(pairs.length);
    for (const [from, to] of pairs) expect(from).not.toBe(to);
  });

  it("excludes self-pairs because a same-strategy retool is a no-op by definition", () => {
    for (const id of extractionIds()) {
      expect(capacityRescaleRatio(SECTOR_TYPE, id, id)).toBe(1);
      expect(
        retoolOperatingCapacityRatio({
          sectorType: SECTOR_TYPE,
          strategyId: id,
          transitionFromStrategyId: id,
          transitionStartTurn: START,
          retoolRescaleApplied: true,
          currentTurn: START + 4,
        })
      ).toBe(1);
    }
  });
});

describe.each(extractionPairs())("extraction retool %s -> %s (issue #2009)", (from, to) => {
  const stockRatio = capacityRescaleRatio(SECTOR_TYPE, from, to);
  const rpuFrom = revenuePerCapacityUnitForStrategy(SECTOR_TYPE, from, 1);
  const rpuTo = revenuePerCapacityUnitForStrategy(SECTOR_TYPE, to, 1);

  it("covers this pair exactly once", () => {
    exercisedPairs.push([from, to]);
  });

  it("gates the blend ratio on proof of conversion: no flag, no mint", () => {
    for (const elapsed of [0, 4, 11]) {
      const turn = START + elapsed;
      const basis = {
        sectorType: SECTOR_TYPE as CorporationType,
        strategyId: to,
        transitionFromStrategyId: from,
        transitionStartTurn: START,
        currentTurn: turn,
      };
      // Missing flag (pre-rescale legacy) and explicit false (capital-mode
      // commit) both read as unconverted: the ratio stays 1, a smaller
      // truthful plant instead of a capital grant.
      expect(retoolOperatingCapacityRatio({ ...basis, retoolRescaleApplied: undefined })).toBe(1);
      expect(retoolOperatingCapacityRatio({ ...basis, retoolRescaleApplied: false })).toBe(1);
      expect(
        transitionalOperatingCapacity({ ...basis, ownedCapacity: 1000, basisConverted: false })
      ).toBe(1000);
    }
  });

  it("holds the nameplate invariant at every transition step through completion", () => {
    const source = 1000;
    const converted = source * stockRatio;
    for (const elapsed of STEPS) {
      const turn = START + elapsed;
      const blend = retoolBlendRatio({
        sectorType: SECTOR_TYPE as CorporationType,
        strategyId: to,
        transitionFromStrategyId: from,
        transitionStartTurn: START,
        currentTurn: turn,
      });
      expect(Number.isFinite(blend)).toBe(true);
      expect(blend).toBeGreaterThan(0);
      const opCap = transitionalOperatingCapacity({
        sectorType: SECTOR_TYPE as CorporationType,
        strategyId: to,
        transitionFromStrategyId: from,
        transitionStartTurn: START,
        currentTurn: turn,
        ownedCapacity: converted,
        basisConverted: true,
      });
      expect(opCap).toBeCloseTo(converted * blend, 10);
      // THE invariant, priced by destination technology productivity:
      // operating capacity x effective mix price == converted stock x RPU(to).
      const mix = effectiveMixPrice(to, from, START, turn);
      expect(mix).toBeGreaterThan(0);
      expect(opCap * mix).toBeCloseTo(converted * rpuTo, 6);
    }
  });

  it("keeps the boundary rescale value-neutral: retooling is a re-aim, never a grant", () => {
    const source = 1000;
    const converted = source * stockRatio;
    // Nameplate before (source units at source productivity) equals nameplate
    // after (converted units at destination productivity) in both directions.
    expect(converted * rpuTo).toBeCloseTo(source * rpuFrom, 6);
    if (stockRatio < 1) {
      // Legitimate downsizing: the unit COUNT drops, the value does not.
      expect(converted).toBeLessThan(source);
    } else if (stockRatio > 1) {
      expect(converted).toBeGreaterThan(source);
    }
  });

  it("bounds operating capacity by source/destination productivity, never by snapshot", () => {
    const sourceYield = unitYieldForSupply(supplyOf(from), 1);
    const targetYield = unitYieldForSupply(supplyOf(to), 1);
    // Blended rates interpolate linearly, so the effective yield never exceeds
    // the richer endpoint: blend(p) <= max(source/target, 1).
    const bound = Math.max(sourceYield / targetYield, 1);
    const converted = 1000 * stockRatio;
    for (const elapsed of STEPS) {
      const turn = START + elapsed;
      const opCap = transitionalOperatingCapacity({
        sectorType: SECTOR_TYPE as CorporationType,
        strategyId: to,
        transitionFromStrategyId: from,
        transitionStartTurn: START,
        currentTurn: turn,
        ownedCapacity: converted,
        basisConverted: true,
      });
      expect(opCap).toBeLessThanOrEqual(converted * bound * 1.000001);
    }
  });

  it("heals legacy stock and opex anchor together with anchor x units fixed", () => {
    const source = 1000;
    const anchor = 7.5;
    expect(
      needsRetoolStockCatchup({
        transitionFromStrategyId: from,
        retoolRescaleApplied: undefined,
        transitionStartTurn: START,
        plantsStartTurn: START + 5,
      })
    ).toBe(true);
    const heal = healRetoolStockBasis({
      plantsEnabled: true,
      isAutoRetool: true,
      sectorType: SECTOR_TYPE as CorporationType,
      strategyId: to,
      transitionFromStrategyId: from,
      transitionStartTurn: START,
      plantsStartTurn: START + 5,
      retoolRescaleApplied: undefined,
      capitalStock: source,
      otherOpexPerUnitAnchor: anchor,
    });
    expect(heal).not.toBeNull();
    expect(heal!.capitalStock).toBeCloseTo(source * stockRatio, 8);
    if (stockRatio !== 1) expect(heal!.otherOpexPerUnitAnchor).toBeCloseTo(anchor / stockRatio, 8);
    expect(heal!.otherOpexPerUnitAnchor! * heal!.capitalStock!).toBeCloseTo(anchor * source, 6);
    expect(heal!.retoolRescaleApplied).toBe(true);
  });

  it("is retry-stable: persisting the heal ends the catch-up, never double-converts", () => {
    const heal = healRetoolStockBasis({
      plantsEnabled: true,
      isAutoRetool: true,
      sectorType: SECTOR_TYPE as CorporationType,
      strategyId: to,
      transitionFromStrategyId: from,
      transitionStartTurn: START,
      plantsStartTurn: START + 5,
      retoolRescaleApplied: undefined,
      capitalStock: 1000,
      otherOpexPerUnitAnchor: 7.5,
    })!;
    // Second turn runs off the persisted heal: flag true means no catch-up.
    expect(
      needsRetoolStockCatchup({
        transitionFromStrategyId: from,
        retoolRescaleApplied: true,
        transitionStartTurn: START,
        plantsStartTurn: START + 5,
      })
    ).toBe(false);
    expect(
      healRetoolStockBasis({
        plantsEnabled: true,
        isAutoRetool: true,
        sectorType: SECTOR_TYPE as CorporationType,
        strategyId: to,
        transitionFromStrategyId: from,
        transitionStartTurn: START,
        plantsStartTurn: START + 5,
        retoolRescaleApplied: true,
        capitalStock: heal.capitalStock,
        otherOpexPerUnitAnchor: heal.otherOpexPerUnitAnchor,
      })
    ).toBeNull();
  });

  it("preserves full-sell-through economics at every step: conversion alone cannot spiral", () => {
    const source = 1000;
    const anchor = 7.5;
    const converted = source * stockRatio;
    const anchorHealed = anchor / stockRatio;
    let firstMargin: number | null = null;
    for (const elapsed of STEPS) {
      const turn = START + elapsed;
      const blend = retoolBlendRatio({
        sectorType: SECTOR_TYPE as CorporationType,
        strategyId: to,
        transitionFromStrategyId: from,
        transitionStartTurn: START,
        currentTurn: turn,
      });
      // Full utilization, 100% sell-through: produced and sold in blended units.
      const produced = converted * blend;
      const revenue = produced * effectiveMixPrice(to, from, START, turn);
      // Produced units convert back to the destination basis before the held
      // per-unit anchor is charged, so the bill is step-invariant too.
      const bill = anchorHealed * (produced / blend);
      expect(revenue).toBeCloseTo(converted * rpuTo, 6);
      expect(bill).toBeCloseTo(anchor * source, 6);
      expect(revenue).toBeGreaterThan(0);
      const margin = (revenue - bill) / revenue;
      if (firstMargin == null) firstMargin = margin;
      else expect(margin).toBeCloseTo(firstMargin, 10);
    }
  });
});

describe("issue #2009 - exact oil_gas to rare_earth_mining reproduction", () => {
  const FROM = "oil_gas";
  const TO = "rare_earth_mining";
  const OWNED = 2314.82;
  const REPORTED_BROKEN = 903166.24;
  const T0 = 95;
  const OBSERVED_TURN = 99;

  it("reproduces the reported blow-up arithmetically on the unconverted path", () => {
    const blend = retoolBlendRatio({
      sectorType: SECTOR_TYPE as CorporationType,
      strategyId: TO,
      transitionFromStrategyId: FROM,
      transitionStartTurn: T0,
      currentTurn: OBSERVED_TURN,
    });
    // Four of twelve transition turns in: the blend alone is ~390x.
    expect(blend).toBeGreaterThan(300);
    const broken = OWNED * blend;
    expect(broken).toBeCloseTo(REPORTED_BROKEN, -3);
    expect(broken / OWNED).toBeGreaterThan(100);
  });

  it("no longer mints that capacity once the gate and catch-up apply", () => {
    const basis = {
      sectorType: SECTOR_TYPE as CorporationType,
      strategyId: TO,
      transitionFromStrategyId: FROM,
      transitionStartTurn: T0,
      currentTurn: OBSERVED_TURN,
    };
    // Pre-fix behavior applied this ratio to source-basis stock.
    const gatedOff = retoolOperatingCapacityRatio({ ...basis, retoolRescaleApplied: undefined });
    expect(gatedOff).toBe(1);
    const stockRatio = capacityRescaleRatio(SECTOR_TYPE, FROM, TO);
    // Legacy row: committed pre-rescale with no flag and no plants anchor
    // (a missing anchor reads as pre-plants per the catch-up contract).
    const heal = healRetoolStockBasis({
      plantsEnabled: true,
      isAutoRetool: true,
      sectorType: SECTOR_TYPE as CorporationType,
      strategyId: TO,
      transitionFromStrategyId: FROM,
      transitionStartTurn: T0,
      plantsStartTurn: null,
      retoolRescaleApplied: undefined,
      capitalStock: OWNED,
      otherOpexPerUnitAnchor: 5,
    })!;
    const fixed = transitionalOperatingCapacity({
      ...basis,
      ownedCapacity: heal.capitalStock!,
      basisConverted: true,
    });
    expect(heal.capitalStock!).toBeCloseTo(OWNED * stockRatio, 8);
    expect(fixed).toBeLessThan(REPORTED_BROKEN / 100);
    // Same order as one honest plant, not three orders above it.
    expect(fixed).toBeGreaterThan(0);
    expect(fixed).toBeLessThan(OWNED);
  });
});

describe("issue #2009 - legacy document shapes", () => {
  const shape = {
    plantsEnabled: true,
    sectorType: SECTOR_TYPE as CorporationType,
    strategyId: "rare_earth_mining",
    transitionFromStrategyId: "oil_gas",
    capitalStock: 1000,
    otherOpexPerUnitAnchor: 7.5,
  };

  it("catches up a capital-mode commit (explicit false flag, auto or player: basis is physical)", () => {
    for (const isAutoRetool of [true, false]) {
      expect(
        needsRetoolStockCatchup({
          transitionFromStrategyId: shape.transitionFromStrategyId,
          retoolRescaleApplied: false,
          transitionStartTurn: 95,
          plantsStartTurn: 100,
        })
      ).toBe(true);
      const heal = healRetoolStockBasis({
        ...shape,
        isAutoRetool,
        transitionStartTurn: 95,
        plantsStartTurn: 100,
        retoolRescaleApplied: false,
      });
      expect(heal).not.toBeNull();
      expect(heal!.capitalStock).toBeCloseTo(
        1000 * capacityRescaleRatio(SECTOR_TYPE, "oil_gas", "rare_earth_mining"),
        8
      );
    }
  });

  it("catches up a pre-rescale legacy row (missing flag, missing turns)", () => {
    expect(
      needsRetoolStockCatchup({
        transitionFromStrategyId: "oil_gas",
        retoolRescaleApplied: undefined,
        transitionStartTurn: null,
        plantsStartTurn: 100,
      })
    ).toBe(true);
    expect(
      needsRetoolStockCatchup({
        transitionFromStrategyId: "oil_gas",
        retoolRescaleApplied: undefined,
        transitionStartTurn: 95,
        plantsStartTurn: null,
      })
    ).toBe(true);
    const heal = healRetoolStockBasis({
      ...shape,
      isAutoRetool: true,
      transitionStartTurn: null,
      plantsStartTurn: null,
      retoolRescaleApplied: undefined,
    });
    expect(heal).not.toBeNull();
    expect(heal!.retoolRescaleApplied).toBe(true);
  });

  it("leaves a plants-era pre-flag commit to the anchor-only heal (stock already converted)", () => {
    // Committed under plants without a flag: pre-flag writers converted the
    // stock but recorded nothing, so no catch-up is owed.
    expect(
      needsRetoolStockCatchup({
        transitionFromStrategyId: "oil_gas",
        retoolRescaleApplied: undefined,
        transitionStartTurn: 105,
        plantsStartTurn: 100,
      })
    ).toBe(false);
    const autoHeal = healRetoolStockBasis({
      ...shape,
      isAutoRetool: true,
      transitionStartTurn: 105,
      plantsStartTurn: 100,
      retoolRescaleApplied: undefined,
    });
    expect(autoHeal).not.toBeNull();
    expect(autoHeal).not.toHaveProperty("capitalStock");
    expect(autoHeal!.retoolRescaleApplied).toBe(true);
    // A player row in the same shape is never reinterpreted.
    expect(
      healRetoolStockBasis({
        ...shape,
        isAutoRetool: false,
        transitionStartTurn: 105,
        plantsStartTurn: 100,
        retoolRescaleApplied: undefined,
      })
    ).toBeNull();
  });

  it("pins the contract boundary: a plants-era no-flag row is assumed already converted", () => {
    // Committed under plants (both turns set, start at or after plants start)
    // with no flag: the fix's model is that pre-flag writers converted the
    // stock but recorded nothing, so only the anchor leg is owed. This test
    // pins that assumption - weakening it must confront the double-conversion
    // hazard on genuinely converted pre-flag rows documented in
    // healRetoolStockBasis.
    const heal = healRetoolStockBasis({
      ...shape,
      isAutoRetool: true,
      transitionStartTurn: 105,
      plantsStartTurn: 100,
      retoolRescaleApplied: undefined,
      capitalStock: 1000,
      otherOpexPerUnitAnchor: 7.5,
    })!;
    expect(heal.capitalStock).toBeUndefined();
    expect(heal.retoolRescaleApplied).toBe(true);
  });

  it("never touches a flagged-true row, a non-transition, or a plants-off turn", () => {
    expect(
      healRetoolStockBasis({ ...shape, isAutoRetool: true, retoolRescaleApplied: true })
    ).toBeNull();
    expect(
      healRetoolStockBasis({
        ...shape,
        isAutoRetool: true,
        transitionFromStrategyId: null,
        retoolRescaleApplied: undefined,
      })
    ).toBeNull();
    expect(healRetoolStockBasis({ ...shape, isAutoRetool: true, plantsEnabled: false })).toBeNull();
  });
});

describe("issue #2009 - bounded production-path multi-turn (computePlantsCapacity)", () => {
  const FROM = "oil_gas";
  const TO = "rare_earth_mining";
  const OWNED = 2314.82;
  const ANCHOR = 5;
  // Capital-mode commit at T0, flipped to plants at PLANTS_START: the legacy
  // shape the catch-up contract covers (commit predates plants).
  const T0 = 86;
  const PLANTS_START = 90;
  const FIRST_TURN = 90;
  const stockRatio = capacityRescaleRatio(SECTOR_TYPE, FROM, TO);
  const rpuFrom = revenuePerCapacityUnitForStrategy(SECTOR_TYPE, FROM, 1);
  const preRetoolNameplate = OWNED * rpuFrom;

  function legacyInput(turn: number, persisted: { stock: number; flag?: boolean; anchor: number }) {
    // Production passes the EFFECTIVE blended supply (sectorTurn resolves
    // getEffectiveStrategyRates once and threads it in), so the mix price is
    // the transitional mix price - that is what keeps the nameplate invariant.
    const effective = getEffectiveStrategyRates(SECTOR_TYPE, TO, FROM, T0, turn);
    return {
      sector: {
        capitalStock: persisted.stock,
        mothballed: false,
        activeCapacityPercent: undefined,
        capacityBookAnchor: undefined,
        plantsStartTurn: PLANTS_START,
        transitionFromStrategyId: FROM,
        strategyId: TO,
        sectorType: SECTOR_TYPE,
        transitionStartTurn: T0,
        retoolRescaleApplied: persisted.flag,
        operatingCapacityTurn: undefined,
        autoStrategyAdoptedAtTurn: T0,
        otherOpexPerUnitAnchor: persisted.anchor,
      },
      corp: { ceoType: "npp" as const },
      plantsEnabled: true,
      isFlipTurn: false,
      preFlipNameplateRevenue: preRetoolNameplate,
      strategySupply: { ...effective.supply },
      eraUnitScale: 1,
      landedBuildUnits: 0,
      landedBuildCostAnchor: 0,
      capacityUnitPriceAnchor: 100,
      newRevenue: preRetoolNameplate,
      currentTurn: turn,
      governorRampTurns: 240,
      embargoLegacyMothball: false,
    } as Parameters<typeof computePlantsCapacity>[0];
  }

  it("heals on the first production turn and stays bounded through completion", () => {
    // First turn under plants carrying the capital-mode commit, four turns
    // into the transition: the issue's observation point (blend ~390x).
    const first = computePlantsCapacity(legacyInput(FIRST_TURN, { stock: OWNED, anchor: ANCHOR }));
    expect(first.healedOpex).not.toBeNull();
    expect(first.healedOpex!.capitalStock).toBeCloseTo(OWNED * stockRatio, 4);
    // No 390x mint: capacity sits at converted scale, three orders down.
    expect(first.plantsCapacity).toBeLessThan(OWNED);
    expect(first.plantsCapacity).toBeGreaterThan(0);

    // Persist the heal the way the sector turn does, then run every turn
    // through completion (turn 107) and beyond.
    let stock = first.healedOpex!.capitalStock!;
    const anchor = first.healedOpex!.otherOpexPerUnitAnchor!;
    let prevCapacity = first.plantsCapacity;
    let prevRevenue = first.plantsNameplateRevenue;
    const firstBillRatio = (anchor * stock) / first.plantsNameplateRevenue;
    // Through completion (T0 + 12 = 98) and beyond.
    for (let turn = FIRST_TURN + 1; turn <= FIRST_TURN + 14; turn++) {
      const r = computePlantsCapacity(legacyInput(turn, { stock, flag: true, anchor }));
      expect(r.healedOpex).toBeNull();
      // Continuity: retool alone never creates an order-of-magnitude
      // discontinuity between adjacent turns. Raw operating UNITS are
      // continuous only while the blend runs; at completion they change
      // basis to destination units by design, so across that boundary only
      // VALUE (nameplate) and the input bill must be continuous - and they
      // are, by the invariant.
      const completing = turn >= T0 + STRATEGY_TRANSITION_TURNS;
      if (!completing) {
        expect(r.plantsCapacity / prevCapacity).toBeGreaterThan(0.5);
        expect(r.plantsCapacity / prevCapacity).toBeLessThan(2);
      }
      expect(r.plantsNameplateRevenue / prevRevenue).toBeGreaterThan(0.5);
      expect(r.plantsNameplateRevenue / prevRevenue).toBeLessThan(2);
      // At 100% sell-through the realized revenue is the nameplate, and the
      // destination-basis input bill cannot detach from it by conversion.
      const billRatio = (anchor * r.plantsOwnedCapacity) / r.plantsNameplateRevenue;
      expect(billRatio / firstBillRatio).toBeGreaterThan(0.5);
      expect(billRatio / firstBillRatio).toBeLessThan(2);
      expect(r.plantsNameplateRevenue).toBeGreaterThan(0);
      prevCapacity = r.plantsCapacity;
      prevRevenue = r.plantsNameplateRevenue;
      stock = r.plantsOwnedCapacity;
    }
    // After completion the blend is gone: capacity is owned converted stock.
    const done = computePlantsCapacity(legacyInput(FIRST_TURN + 14, { stock, flag: true, anchor }));
    expect(done.retoolCapacityRatio).toBe(1);
    expect(done.plantsCapacity).toBeCloseTo(done.plantsOwnedCapacity, 8);
  });

  it("keeps the healed nameplate on the pre-retool basis (no grant, no haircut)", () => {
    const first = computePlantsCapacity(legacyInput(FIRST_TURN, { stock: OWNED, anchor: ANCHOR }));
    // Nameplate continuity modulo depreciation: the plant is worth what it
    // was worth, re-aimed - within a few percent, not orders of magnitude.
    expect(first.plantsNameplateRevenue / preRetoolNameplate).toBeGreaterThan(0.9);
    expect(first.plantsNameplateRevenue / preRetoolNameplate).toBeLessThan(1.1);
  });
});

describe("issue #2009 - every derived pair is exercised", () => {
  it("leaves no registry pair without table coverage", () => {
    const expected = new Set(extractionPairs().map(([f, t]) => `${f}->${t}`));
    const tested = new Set(exercisedPairs.map(([f, t]) => `${f}->${t}`));
    expect(tested).toEqual(expected);
  });
});
