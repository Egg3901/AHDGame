import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { planEquityPoolCashMove, processEquityMarketPoolTurn } from "./marketPoolTurn";

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  db.collection("equityMarketPools");
  db.collection("moneySupplySnapshots");
});

describe("equity market pool turn", () => {
  it("lets two percent of a target shortfall flow in", () => {
    expect(planEquityPoolCashMove({ cashLocal: 50, targetCashLocal: 100 })).toEqual({
      inflow: 1,
      sweep: 0,
    });
  });

  it("resizes from M2 and records a controlled inflow", async () => {
    db.collectionMocks.equityMarketPools.find.mockReturnValue({
      toArray: async () => [{ _id: "USD", cashLocal: 100, targetCashLocal: 5 }],
    });
    db.collectionMocks.moneySupplySnapshots.find.mockReturnValue({
      toArray: async () => [{ currencyCode: "USD", m2: 10_000, turn: 583 }],
    });
    const result = await processEquityMarketPoolTurn(db as unknown as Db, 584, new Date());
    expect(result.activeCurrencies).toEqual(["USD"]);
    expect(result.inflowLocalByCurrency.USD).toBe(8);
    expect(db.collectionMocks.equityMarketPools.updateOne).toHaveBeenLastCalledWith(
      { _id: "USD" },
      expect.objectContaining({
        $set: expect.objectContaining({ targetCashLocal: 500, m2Local: 10_000, lastTurn: 584 }),
      })
    );
  });
});
