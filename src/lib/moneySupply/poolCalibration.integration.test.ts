import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { snapshotMoneySupply } from "./snapshot";
import { processEquityMarketPoolTurn } from "@/lib/equities/marketPoolTurn";
import { processBondMarketPoolTurn } from "@/lib/bonds/marketPoolTurn";

vi.mock("@/lib/sovereignDefault/snapshotLoader", () => ({
  loadCountrySovereignSnapshot: vi.fn().mockResolvedValue(null),
}));

describe("market liquidity across money accounting changes", () => {
  it.each([
    ["equityMarketPools", processEquityMarketPoolTurn],
    ["bondMarketPools", processBondMarketPoolTurn],
  ] as const)(
    "keeps %s cash and calibration through reclassification then follows true growth",
    async (collection, processPool) => {
      const memory = createInMemoryDb();
      const db = memory as unknown as Db;
      const snapshots = memory.collection("moneySupplySnapshots");
      const find = snapshots.find.bind(snapshots);
      Object.assign(snapshots, {
        find: (
          filter: Record<string, unknown>,
          options?: { sort?: Record<string, 1 | -1>; limit?: number }
        ) => {
          const cursor = find(filter);
          return {
            ...cursor,
            toArray: async () => {
              const rows = await cursor.toArray();
              if (options?.sort?.turn)
                rows.sort((a, b) => (Number(a.turn) - Number(b.turn)) * options.sort!.turn);
              return options?.limit ? rows.slice(0, options.limit) : rows;
            },
          };
        },
        replaceOne: (
          filter: Record<string, unknown>,
          doc: Record<string, unknown>,
          options: { upsert?: boolean }
        ) => snapshots.updateOne(filter, { $set: doc }, options),
      });
      memory.seed("gameConfig", [{ _id: "default", moneySupplyEnabled: true }]);
      memory.seed("centralBanks", [{ _id: "US", countryId: "US", externalBroadMoney: 1000 }]);
      memory.seed(collection, [
        {
          _id: "USD",
          cashLocal: 1000,
          targetCashLocal: 1000,
          m2Local: 100_000_000,
          liquidityTargetLocal: 1000,
          lifetime: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      await snapshotMoneySupply(db, 100);
      const observed = Number(snapshots.docs.find((row) => row._id === "100:USD")!.m2);
      await processPool(db, 100, new Date());
      expect(memory.collection(collection).docs[0]).toMatchObject({
        cashLocal: 1000,
        targetCashLocal: 1000,
        m2Local: observed,
        poolAccountingVersion: 2,
      });
      // Adding an equal amount of external cash doubles actual measured M2.
      await memory
        .collection("centralBanks")
        .updateOne({ _id: "US" }, { $inc: { externalBroadMoney: observed } });
      await snapshotMoneySupply(db, 101);
      await processPool(db, 101, new Date());
      expect(memory.collection(collection).docs[0].targetCashLocal).toBe(2000);
    }
  );
  it("does not turn a temporary bond rollover floor into permanent liquidity", async () => {
    const memory = createInMemoryDb();
    const db = memory as unknown as Db;
    memory.seed("bondMarketPools", [
      { _id: "USD", cashLocal: 1000, targetCashLocal: 6000, m2Local: 20000, lifetime: {} },
    ]);
    memory.seed("moneySupplySnapshots", [
      { currencyCode: "USD", turn: 100, m2: 50, accountingVersion: 2 },
    ]);
    memory.seed("bonds", [
      {
        issuerType: "sovereign",
        currencyCode: "USD",
        matured: false,
        defaulted: false,
        maturityTurn: 105,
        totalIssued: 6000,
      },
    ]);
    await processBondMarketPoolTurn(db, 100, new Date());
    expect(memory.collection("bondMarketPools").docs[0]).toMatchObject({
      targetCashLocal: 6000,
      liquidityTargetLocal: 1000,
    });
    await processBondMarketPoolTurn(db, 106, new Date());
    expect(memory.collection("bondMarketPools").docs[0]).toMatchObject({
      targetCashLocal: 1000,
      liquidityTargetLocal: 1000,
    });
  });
});
