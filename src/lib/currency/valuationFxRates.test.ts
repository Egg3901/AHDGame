import { describe, expect, it, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

/**
 * Two FX maps, deliberately different, and the difference is load-bearing.
 *
 * `loadFxRatesByCurrency` is the LIVE map. A currency with no `exchangeRates`
 * row must stay absent from it, because settlement paths — share-listing
 * refunds and the like — read that absence as "no live rate" and fail closed
 * rather than move money at a turn-0 anchor.
 *
 * `loadValuationFxRates` back-fills those currencies from the preset's authored
 * table, because the alternative for a display or a cross-corp ranking is 1.0 —
 * a definitely-wrong number. MEASURED before it existed: 62 of the exchange's
 * 136 listings were bloc-currency and every one had anchor === local.
 */
describe("valuation vs live FX maps", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.resetModules();
    db = createMockDb();
    // The preset is read through the CALLER'S `db` handle rather than the
    // `@/lib/db/collections/gameState` helper — importing that helper drags
    // `mongodb` into every client component that transitively reaches
    // `corporationCapital`, which broke `next build`. Same read, same fallback;
    // the stub just moves from the module to the database.
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      preset: "1953-default",
    });
    db.collection("exchangeRates");
    // Only the forex-active currencies get rows, exactly as seedExchangeRates does.
    db.collectionMocks.exchangeRates.find.mockReturnValue({
      toArray: async () => [
        { currencyCode: "USD", rate: 1 },
        { currencyCode: "GBP", rate: 0.357 },
      ],
    });
  });

  it("leaves a currency with no rate row ABSENT from the live map", async () => {
    const { loadFxRatesByCurrency } = await import("@/lib/currency/corporationCapital");
    const live = await loadFxRatesByCurrency(db as never);
    expect(live.has("GBP")).toBe(true);
    // PLZ is budget-only — no row, and settlement must be able to see that.
    expect(live.has("PLZ")).toBe(false);
  });

  it("back-fills it in the valuation map from the authored era table", async () => {
    const { loadValuationFxRates } = await import("@/lib/currency/corporationCapital");
    const valuation = await loadValuationFxRates(db as never);
    expect(valuation.get("PLZ")).toBe(24);
    expect(valuation.get("CSK")).toBe(27);
  });

  it("never overrides a live rate with the authored one", async () => {
    // The live rate drifts every turn; the authored rate is the turn-0 anchor.
    // Where both exist, live wins.
    const { loadValuationFxRates } = await import("@/lib/currency/corporationCapital");
    const valuation = await loadValuationFxRates(db as never);
    expect(valuation.get("GBP")).toBe(0.357);
  });
});
