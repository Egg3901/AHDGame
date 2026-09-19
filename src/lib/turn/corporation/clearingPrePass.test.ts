/**
 * Boundary tests for runClearingPrePass, the extracted corporation-turn
 * clearing pre-pass (offer-book construction, clearing-factors run, book
 * invariant diagnostics, delivered advertising value, loyalty rollup).
 *
 * The extraction moved the `if (market.clearingEnabled)` block out of
 * index.ts verbatim, so these tests pin the new call boundary: a disabled
 * clearing tier must leave the market context and the contract maps exactly
 * as they arrived, with empty breach and loyalty outputs.
 */
import { describe, it, expect } from "vitest";
import { runClearingPrePass, type ClearingPrePassInput } from "./clearingPrePass";
import type { MarketContext } from "@/lib/market/marketContext";
import type { buildCorporationLookups } from "./buildLookups";

type Lookups = Awaited<ReturnType<typeof buildCorporationLookups>>;

function makeInput(overrides: Partial<ClearingPrePassInput> = {}): ClearingPrePassInput {
  return {
    lookups: {} as Lookups,
    market: { clearingEnabled: false } as MarketContext,
    turn: 12,
    currentYear: 1953,
    commandEconomyEnabled: false,
    freightSettlementActive: false,
    supplyAgreementsEnabled: false,
    settleableAgreements: undefined,
    contractedByCorpCommodity: undefined,
    contractSettlementByCorp: new Map(),
    producedByCorpCommodity: new Map(),
    achievableByCorpCommodity: new Map(),
    stateLocalClearingBlockedByLegacyAgreement: false,
    brandLoyaltyEnabled: false,
    brandLoyaltySliceEnabled: false,
    qualityPremiumPricingEnabled: false,
    ...overrides,
  };
}

describe("runClearingPrePass with clearing disabled", () => {
  it("returns empty breaches and loyalty updates without touching the market", () => {
    const market = { clearingEnabled: false } as MarketContext;
    const before = { ...market };
    const result = runClearingPrePass(makeInput({ market }));

    expect(result.clearingInvariantBreaches).toEqual([]);
    expect(result.brandLoyaltyUpdates).toEqual([]);
    expect(result.buyerDemandByCorpCommodity).toBeUndefined();
    expect(result.contractedByCorpCommodity).toBeUndefined();
    expect(market).toEqual(before);
  });

  it("passes the incoming contract reservation map through untouched", () => {
    const contractedByCorpCommodity = new Map([["corpA", new Map([["steel", 42]])]]);
    const result = runClearingPrePass(makeInput({ contractedByCorpCommodity }));

    expect(result.contractedByCorpCommodity).toBe(contractedByCorpCommodity);
    expect(result.contractedByCorpCommodity?.get("corpA")?.get("steel")).toBe(42);
  });
});

function makeSectorWorld() {
  const corp = { _id: "corp1", brandLoyalty: 0.5, brandPostureNorm: 0 };
  const sector = {
    _id: "sector1",
    corporationId: "corp1",
    sectorType: "manufacturing",
    strategyId: "standard",
    revenue: 1_000_000,
    producedUnits: 100,
    contractAchievableUnits: 100,
  };
  const lookups = {
    sectorsByCorp: new Map([["corp1", [sector]]]),
    corpById: new Map([["corp1", corp]]),
    globalCommodityBalances: new Map(),
    priceRatioByCommodity: new Map(),
    eraUnitScale: 1,
    exchangeRatesByCurrency: new Map(),
    stateResourceCapacityByState: new Map(),
    countryClearingBooks: undefined,
    rawStateBalances: new Map(),
    statePriceRatioByState: new Map(),
    reachablePriceRatioByCountry: new Map(),
  } as unknown as Lookups;
  return { corp, lookups };
}

describe("runClearingPrePass with clearing enabled", () => {
  it("populates clearing results on the market and reports deterministic breaches", () => {
    const { lookups } = makeSectorWorld();
    const market = { clearingEnabled: true, plantsEnabled: false } as MarketContext;
    const result = runClearingPrePass(makeInput({ lookups, market }));

    expect(market.clearingBySectorId?.has("sector1")).toBe(true);
    expect(market.advertisingSellerDeliveredValueAnchorByCorpId).toBeDefined();
    expect(result.clearingInvariantBreaches.length).toBeGreaterThan(0);
    for (const breach of result.clearingInvariantBreaches) {
      expect(breach.startsWith("corporationTurn: ")).toBe(true);
    }
    expect(result.brandLoyaltyUpdates).toEqual([]);
    expect(result.buyerDemandByCorpCommodity).toBeUndefined();
    expect(result.contractedByCorpCommodity).toBeUndefined();
  });

  it("rolls loyalty up and keeps the in-memory corp docs consistent", () => {
    const { corp, lookups } = makeSectorWorld();
    const market = { clearingEnabled: true, plantsEnabled: false } as MarketContext;
    const result = runClearingPrePass(makeInput({ lookups, market, brandLoyaltyEnabled: true }));

    expect(result.brandLoyaltyUpdates.length).toBeGreaterThan(0);
    for (const lu of result.brandLoyaltyUpdates) {
      expect(lookups.corpById.get(lu.corpId)).toBe(corp);
      expect(corp.brandLoyalty).toBe(Math.round(lu.loyalty * 100) / 100);
      expect(corp.brandPostureNorm).toBe(Math.round(lu.postureNorm * 10000) / 10000);
    }
  });

  it("returns buyer demand and reservation maps on the agreements path", () => {
    const { lookups } = makeSectorWorld();
    const market = { clearingEnabled: true, plantsEnabled: false } as MarketContext;
    const result = runClearingPrePass(
      makeInput({
        lookups,
        market,
        supplyAgreementsEnabled: true,
        settleableAgreements: [],
        contractedByCorpCommodity: new Map(),
      })
    );

    expect(result.buyerDemandByCorpCommodity).toBeDefined();
    expect(result.contractedByCorpCommodity).toBeDefined();
    expect(result.contractedByCorpCommodity?.size).toBe(0);
  });
});
