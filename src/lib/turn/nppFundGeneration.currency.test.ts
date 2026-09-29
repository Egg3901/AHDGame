import { expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { processNppFundGeneration } from "./nppFundGeneration";
import { projectNppGeneration } from "@/lib/utils/fundGeneration";
vi.mock("@/lib/financialTxLog/emit", () => ({
  loadTxThresholds: async () => ({}),
  emitTxBulk: vi.fn(),
}));
vi.mock("@/lib/treasury/emit", () => ({ emitTreasuryTransactionsBulk: vi.fn() }));

it.each([1, 0.03673, 0.35808, 1.28579])(
  "generates and caps NGN funds at the world price basis %s",
  async (priceLevel) => {
    const db = createInMemoryDb();
    db.seed("gameConfig", [
      { _id: "default", nppEconomyEnabled: true, campaignEraPriceLevelEnabled: priceLevel !== 1 },
    ]);
    const preset =
      priceLevel === 0.03673
        ? "1953-default"
        : priceLevel === 0.35808
          ? "1991-default"
          : "2027-default";
    db.seed("gameState", [{ _id: "current", preset }]);
    db.seed("states", [{ _id: "NG-test", countryId: "NG", population: 1_000_000 }]);
    db.seed("exchangeRates", [
      { _id: "NG", countryId: "NG", currencyCode: "NGN", baseRate: 0.357, rate: 0.1 },
    ]);
    db.seed("npps", [
      {
        _id: new ObjectId(),
        countryId: "NG",
        homeState: "NG-test",
        funds: 1_000_000 * 0.357 * priceLevel,
        donorBaseLevel: 0,
        party: "independent",
        actionPoints: 0,
        retiredAt: null,
      },
    ]);
    const npps = db.collection("npps");
    const find = npps.find.bind(npps);
    vi.spyOn(npps, "find").mockImplementation((filter) => {
      const cursor = find(filter);
      return Object.assign(cursor, {
        [Symbol.asyncIterator]: async function* () {
          yield* await cursor.toArray();
        },
      });
    });
    const expected = Math.round(
      projectNppGeneration({
        population: 1_000_000,
        donorBaseLevel: 0,
        currentFundsLocal: 1_000_000,
        nppEconomyEnabled: true,
      }) *
        0.357 *
        priceLevel
    );
    const result = await processNppFundGeneration(db as unknown as Db, 2);
    expect(result.totalGenerated).toBe(expected);
    expect(npps.docs[0].funds).toBe(1_000_000 * 0.357 * priceLevel + expected);
  }
);
