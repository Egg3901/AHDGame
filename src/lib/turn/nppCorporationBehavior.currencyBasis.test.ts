/**
 * REGRESSION — NPP money decisions are made in the corp's OWN currency.
 *
 * Confirmed by a controlled 96-turn 1953 A/B (identical seed `ab2`, capital vs
 * plants). Total realized revenue came out 6.1x the control, and the excess was
 * NOT per-unit price (matched sector types priced within 3%), NOT volume (sold
 * units were 7% LOWER), and NOT the launch governor (realized ÷ nameplate was
 * bounded: p50 0.92, p99 1.39). It was concentrated in exactly the countries
 * whose currency is far from the ₳ anchor:
 *
 *     country  fx (local/₳)   sectors capital → plants
 *     US        1.00           51 → 51      (unchanged)
 *     UK        0.37           63 → 63      (unchanged)
 *     RU        9.0           136 → 136     (unchanged)
 *     DE        4.23           51 → 114
 *     BR       20.3            51 → 255
 *     JP      360.2            60 → 255     ← 79% of all realized revenue
 *
 * Cause: every money constant in `nppCorporationBehavior` (CASH_FLOOR,
 * EXPANSION_MIN_CASH, EXPANSION_COST) and the `computeBuildCost` result are ₳
 * figures, while `corp.liquidCapital` is stored in the corp's currency. They
 * were compared and subtracted directly, so a JPY corp read its cash floor and
 * its expansion price as ~1/360 of their real size and expanded until it hit
 * MAX_SECTORS. The player-facing paths (`expandSector`, `buildCapacity`) have
 * always converted; the AI did not.
 *
 * These tests pin the conversion in both directions AND pin that an anchor
 * currency (fxRate 1 / no rate supplied) is byte-identical to the old
 * behaviour, so the fix cannot silently re-scale existing worlds.
 */
import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  makeNppCorpDecision,
  type CommodityPriceRatioFn,
  type NppPlantsContext,
} from "./nppCorporationBehavior";
import { ceoArchetypeModifiers } from "./ceoArchetype";
import type { Corporation, CorporateSector, UnownedSector } from "@/lib/db/types";
import { CAPACITY_ANCHOR_YEAR, computeBuildCost } from "@/lib/constants/capacityEconomy";
import { foundingStarterUnits, sectorEntryFeeAnchor } from "@/lib/corporations/foundingPlant";
import { computeUnownedHeadroomUnits } from "@/lib/market/unownedHeadroom";

const noPrices: CommodityPriceRatioFn = () => null;
const noState = new Set<string>();
const TURN = 100;

/** JPY in 1953. The A/B's worst offender, and the reason this file exists. */
const JPY_RATE = 360;

const POOL_REVENUE_ANCHOR = 40_000_000;
const POOL_UNITS = computeUnownedHeadroomUnits("manufacturing", POOL_REVENUE_ANCHOR, 1);
const EXPECTED_UNITS = foundingStarterUnits("manufacturing");
const EXPECTED_BUILD_ANCHOR = computeBuildCost({
  eraUnitScale: 1,
  sectorType: "manufacturing",
  units: EXPECTED_UNITS,
  year: CAPACITY_ANCHOR_YEAR,
  marketSharePercent: 0,
  primeRate: 0,
  founding: true,
}).totalAnchor;
const FOUNDING_COST_ANCHOR = sectorEntryFeeAnchor("2019-default") + EXPECTED_BUILD_ANCHOR;

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
    stateId: "KAN",
    countryId: "JP",
    sectorType: "manufacturing",
    // The unowned pool is ₳-denominated (see UnownedSector), which is precisely
    // why its revenue may not be copied into a sector's local-currency
    // nameplate without conversion.
    revenue: POOL_REVENUE_ANCHOR,
    headroomUnits: POOL_UNITS,
  } as unknown as UnownedSector;
}

function corp(overrides: Partial<Corporation> = {}): Corporation {
  return {
    _id: new ObjectId(),
    countryId: "JP",
    type: "manufacturing",
    headquartersState: "KAN",
    liquidCurrencyCode: "JPY",
    // Comfortably above the JPY-denominated floor + min-cash, so the ONLY thing
    // these tests vary is the currency basis.
    liquidCapital: 500_000_000 * JPY_RATE,
    ceoType: "npp",
    ...overrides,
  } as unknown as Corporation;
}

function sector(): CorporateSector {
  return {
    _id: new ObjectId(),
    sectorType: "technology",
    countryId: "JP",
    stateId: "KAN",
    revenue: 10_000_000 * JPY_RATE,
    profitMargin: 30,
    effectiveProfitMargin: 30,
    targetGrowthRate: 2,
  } as unknown as CorporateSector;
}

function decide(c: Corporation, fxRate: number | undefined, plants?: NppPlantsContext) {
  return makeNppCorpDecision(
    {
      corp: c,
      sectors: [sector()],
      turn: TURN,
      now: new Date(),
      fxRate,
      modifiers: ceoArchetypeModifiers("cautious"),
    },
    new Map<string, UnownedSector[]>([["JP", [pool()]]]),
    noState,
    noPrices,
    plants
  );
}

describe("NPP decisions in a non-anchor currency", () => {
  it("charges the founding build in the corp's currency, not in ₳", () => {
    const c = corp();
    const decision = decide(c, JPY_RATE, plantsCtx);

    expect(decision.newSectors).toHaveLength(1);
    const spentLocal = (c.liquidCapital ?? 0) - (decision.updates.liquidCapital as number);
    expect(spentLocal).toBeCloseTo(FOUNDING_COST_ANCHOR * JPY_RATE, 2);
    // The bug: the anchor figure charged verbatim, i.e. a 360x discount.
    expect(spentLocal / FOUNDING_COST_ANCHOR).toBeCloseTo(JPY_RATE, 6);
  });

  it("charges the legacy flat expansion cost in the corp's currency too", () => {
    const c = corp();
    const decision = decide(c, JPY_RATE, undefined);
    const spentLocal = (c.liquidCapital ?? 0) - (decision.updates.liquidCapital as number);
    expect(spentLocal).toBeCloseTo(500_000 * JPY_RATE, 2);
  });

  it("stores the new sector's nameplate in the corp's currency", () => {
    // `sectorTurn` reads `revenue` through `readCorpEconomicAnchor` and writes
    // it back through `writeCorpEconomicLocal`. An ₳ value stored here is read
    // as 1/fx of its true size, and the plants restatement then writes the
    // capacity-derived nameplate back at full local scale — a one-turn ×fx step
    // in the sector's top line. That step is the 6.1x aggregate.
    const decision = decide(corp(), JPY_RATE, plantsCtx);
    const nameplateShare = Math.min(1, EXPECTED_UNITS / POOL_UNITS);
    expect(decision.newSectors![0].revenue).toBe(
      Math.round(POOL_REVENUE_ANCHOR * nameplateShare * JPY_RATE)
    );
  });

  it("blocks a founding the corp cannot actually afford in local terms", () => {
    // Local cash that LOOKS like plenty against ₳ constants (500M) but is only
    // ~1.4M ₳ once converted — below the ₳ cash floor + min-cash gate.
    const broke = corp({ liquidCapital: 500_000_000 } as Partial<Corporation>);
    expect(decide(broke, JPY_RATE, plantsCtx).newSectors).toBeUndefined();
    // Same corp, same numbers, in an anchor-rate currency: it can afford it.
    expect(decide(broke, 1, plantsCtx).newSectors).toHaveLength(1);
  });

  it("is byte-identical for an anchor-rate corp whether or not fxRate is given", () => {
    const c = corp();
    const withRate = decide(c, 1, plantsCtx);
    const withoutRate = decide(c, undefined, plantsCtx);
    expect(withoutRate.updates.liquidCapital).toBe(withRate.updates.liquidCapital);
    expect(withoutRate.newSectors![0].revenue).toBe(withRate.newSectors![0].revenue);
    expect((c.liquidCapital ?? 0) - (withRate.updates.liquidCapital as number)).toBeCloseTo(
      FOUNDING_COST_ANCHOR,
      2
    );
  });
});
