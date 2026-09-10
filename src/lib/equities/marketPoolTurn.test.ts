import { beforeEach, describe, expect, it, vi } from "vitest";
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
  it("never credits a pool that is below its target", () => {
    // Was `{ inflow: 1, sweep: 0 }` — 2% of the shortfall, funded by nothing.
    expect(planEquityPoolCashMove({ cashLocal: 50, targetCashLocal: 100 })).toEqual({ sweep: 0 });
  });

  it("never credits a fully drained pool either", () => {
    expect(planEquityPoolCashMove({ cashLocal: 0, targetCashLocal: 50_000 })).toEqual({ sweep: 0 });
  });

  it("still sweeps a pool above twice its target, down to 1.5x", () => {
    expect(planEquityPoolCashMove({ cashLocal: 300, targetCashLocal: 100 }).sweep).toBeCloseTo(
      150,
      2
    );
  });

  it("does not sweep a pool sitting between target and 2x target", () => {
    expect(planEquityPoolCashMove({ cashLocal: 150, targetCashLocal: 100 })).toEqual({ sweep: 0 });
  });

  it("treats a non-positive target as nothing to do", () => {
    expect(planEquityPoolCashMove({ cashLocal: 100, targetCashLocal: 0 })).toEqual({ sweep: 0 });
    expect(planEquityPoolCashMove({ cashLocal: 100, targetCashLocal: Number.NaN })).toEqual({
      sweep: 0,
    });
  });

  it("resizes from M2 without crediting the pool", async () => {
    db.collectionMocks.equityMarketPools.find.mockReturnValue({
      toArray: async () => [{ _id: "USD", cashLocal: 100, targetCashLocal: 5, lifetime: {} }],
    });
    db.collectionMocks.moneySupplySnapshots.find.mockReturnValue({
      toArray: async () => [{ currencyCode: "USD", m2: 10_000, turn: 583 }],
    });
    const result = await processEquityMarketPoolTurn(db as unknown as Db, 584, new Date());
    expect(result.activeCurrencies).toEqual(["USD"]);
    expect(result.sweptLocalByCurrency).toEqual({});
    expect(db.collectionMocks.equityMarketPools.updateOne).toHaveBeenLastCalledWith(
      { _id: "USD" },
      expect.objectContaining({
        $set: expect.objectContaining({ targetCashLocal: 500, m2Local: 10_000, lastTurn: 584 }),
      })
    );
  });

  it("warns when a backfilled pool holds more than it is entitled to", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    db.collectionMocks.equityMarketPools.find.mockReturnValue({
      toArray: async () => [
        {
          _id: "USD",
          cashLocal: 5_000,
          targetCashLocal: 10_000,
          seedLocal: 1_000,
          lifetime: { inflowIn: 4_000 },
        },
      ],
    });
    db.collectionMocks.moneySupplySnapshots.find.mockReturnValue({ toArray: async () => [] });
    await processEquityMarketPoolTurn(db as unknown as Db, 584, new Date());
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("conservation breach on USD"));
    warn.mockRestore();
  });

  it("stays quiet for a pool with no recorded seed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    db.collectionMocks.equityMarketPools.find.mockReturnValue({
      toArray: async () => [
        { _id: "USD", cashLocal: 5_000, targetCashLocal: 10_000, lifetime: { inflowIn: 4_000 } },
      ],
    });
    db.collectionMocks.moneySupplySnapshots.find.mockReturnValue({ toArray: async () => [] });
    await processEquityMarketPoolTurn(db as unknown as Db, 584, new Date());
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
