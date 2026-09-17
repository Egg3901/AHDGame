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
