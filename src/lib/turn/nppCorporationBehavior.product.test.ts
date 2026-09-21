/**
 * Seam coverage for NPP product autonomy wiring (#2236/#2238).
 *
 * The pure policy lives in `nppProductDecision.test.ts`. These cases prove
 * the integration seam: without product context (every caller before this
 * slice) and at V0-V3 with the flag on, the decision carries no
 * `productDecision` field at all, so old tiers serialize exactly as before.
 * At V4+ with the flag on, eligible corps carry an actionable intent and
 * corps with an active product carry a continue intent.
 */
import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  makeNppCorpDecision,
  type CommodityPriceRatioFn,
  type NppPlantsContext,
} from "./nppCorporationBehavior";
import type { NppCorpDecisionContext } from "@/lib/turn/npp/corpDecisionTypes";
import { ceoArchetypeModifiers } from "@/lib/npp/ceoArchetype";
import type { Corporation, CorporateSector, UnownedSector } from "@/lib/db/types";
import type { CorporationProduct } from "@/lib/products/types";
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
    sectorType: "manufacturing",
    strategyId: "electronics_manufacturing",
    capacity: 100,
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

function activeProduct(corporationId: string): CorporationProduct {
  return {
    id: "prod-1",
    corporationId,
    kindId: "passenger_car",
    name: "Passenger Car",
    stage: "development",
    startedTurn: 900,
    developmentSpendAnchor: 0,
    developmentAdvertisingAnchor: 0,
    developmentAdvertisingTurns: 0,
  };
}

const NOW = new Date("2026-01-01T00:00:00.000Z");

function decide(extraContext: Partial<NppCorpDecisionContext> = {}) {
  const c = corp();
  const s = sector();
  return makeNppCorpDecision(
    {
      corp: c,
      sectors: [s],
      turn: TURN,
      now: NOW,
      fxRate: 1,
      modifiers: ceoArchetypeModifiers("cautious"),
      currentYear: 2027,
      strategyEligible: true,
      strategyLoopEnabled: true,
      ...extraContext,
    },
    new Map<string, UnownedSector[]>([["US", [pool()]]]),
    noState,
    noPrices,
    plantsCtx
  );
}

describe("npp product autonomy seam", () => {
  it("carries no product field without product context", () => {
    const decision = decide();
    expect("productDecision" in decision).toBe(false);
  });

  it("carries no product field at V3 with the flag on", () => {
    const decision = decide({ productsEnabled: true, autonomyLevel: "v3" });
    expect("productDecision" in decision).toBe(false);
  });

  it("carries no product field when the flag is off at V4", () => {
    const decision = decide({ productsEnabled: false, autonomyLevel: "v4" });
    expect("productDecision" in decision).toBe(false);
  });

  it("leaves every legacy field identical between flag-off and V3 flag-on", () => {
    // Fresh fixtures per call, so fresh ObjectIds differ by construction.
    // Strip id-typed fields before comparing: every economic value must match.
    const stripIds = (value: unknown): unknown =>
      JSON.parse(
        JSON.stringify(value, (key, v) =>
          key === "sectorId" ||
          key === "corpId" ||
          key === "_id" ||
          key === "corporationId" ||
          key === "productId"
            ? "<id>"
            : v
        )
      );
    const off = stripIds(decide()) as ReturnType<typeof decide>;
    const v3 = stripIds(decide({ productsEnabled: true, autonomyLevel: "v3" })) as ReturnType<
      typeof decide
    >;
    expect(v3.updates).toEqual(off.updates);
    expect(v3.liquidCapitalDelta).toBe(off.liquidCapitalDelta);
    expect(v3.cashFloorLocal).toBe(off.cashFloorLocal);
    expect(v3.strategy).toEqual(off.strategy);
    expect(v3.newSectors).toEqual(off.newSectors);
    expect(v3.divestedSectorIds).toEqual(off.divestedSectorIds);
    expect(v3.reinvestments).toEqual(off.reinvestments);
    expect(v3.sectorUpdates).toEqual(off.sectorUpdates);
    expect(v3).toEqual(off);
  });

  it("emits a start intent at V4 for an eligible industrial corp", () => {
    const decision = decide({ productsEnabled: true, autonomyLevel: "v4" });
    expect(decision.productDecision?.kind).toBe("start_product");
    if (decision.productDecision?.kind !== "start_product") return;
    expect(decision.productDecision.kindId).toBe("consumer_electronics");
    expect(Number.isFinite(decision.productDecision.maxSpendLocal)).toBe(true);
  });

  it("emits a continue intent at V4 when the corp has an active product", () => {
    const c = corp();
    const decision = makeNppCorpDecision(
      {
        corp: c,
        sectors: [sector()],
        turn: TURN,
        now: new Date(),
        fxRate: 1,
        modifiers: ceoArchetypeModifiers("cautious"),
        strategyEligible: true,
        strategyLoopEnabled: true,
        productsEnabled: true,
        autonomyLevel: "v5",
        activeProduct: activeProduct(c._id.toString()),
      },
      new Map<string, UnownedSector[]>([["US", [pool()]]]),
      noState,
      noPrices,
      plantsCtx
    );
    expect(decision.productDecision).toEqual({
      kind: "continue_product",
      productId: "prod-1",
    });
  });

  it("never starts a second product through the behavior seam", () => {
    const c = corp();
    const decision = makeNppCorpDecision(
      {
        corp: c,
        sectors: [sector()],
        turn: TURN,
        now: new Date(),
        fxRate: 1,
        modifiers: ceoArchetypeModifiers("cautious"),
        strategyEligible: true,
        strategyLoopEnabled: true,
        productsEnabled: true,
        autonomyLevel: "v4",
        activeProduct: activeProduct(c._id.toString()),
      },
      new Map<string, UnownedSector[]>([["US", [pool()]]]),
      noState,
      noPrices,
      plantsCtx
    );
    expect(decision.productDecision?.kind).not.toBe("start_product");
    expect(decision.productDecision?.kind).not.toBe("acquire_operating_model");
  });
});
