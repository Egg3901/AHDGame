/** Treasury cash, receipt and snapshot must share their valuation denominator. */
import { describe, it, expect, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { getDb } from "@/lib/mongodb";
import { processTreasuryTurn } from "@/lib/turn/treasuryTurn";
import {
  collectBalances,
  writeBalanceSnapshot,
  writePreForexBalanceCheckpoint,
} from "../balanceSnapshot";
import { reconcileTurn } from "../reconcile";
import type { BalanceSnapshot } from "../types";
import type { FederalBudget } from "@/lib/db/types/budget";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function world() {
  const memory = createInMemoryDb();
  const db = memory as unknown as Db;
  vi.mocked(getDb).mockResolvedValue(db);
  memory.seed("gameConfig", [{ _id: "default", ledgerShadow: true }]);
  memory.seed("gameState", [{ _id: "current", preset: "1991-default" }]);
  memory.seed("federalBudget", [
    {
      _id: new ObjectId(),
      countryId: "BG",
      currencyCode: "BGL",
      treasuryBalance: 2825,
      revenue: { total: 135600 },
      spending: { total: 0, debtInterest: 0 },
      debt: { principal: 0, interestRate: 0 },
    },
  ]);
  return { memory, db };
}
describe("government snapshot valuation", () => {
  it.each([false, true])("matches authored receipt with legacy opening %s", async (legacy) => {
    const { memory, db } = world();
    const originalNative = memory.collection("federalBudget").docs[0].treasuryBalance;
    expect((await collectBalances(db))["government:BG:BGL"]).toBe(100);
    expect(memory.collection("federalBudget").docs[0].treasuryBalance).toBe(originalNative);
    expect(memory.collection("exchangeRates").docs).toEqual([]);
    if (legacy)
      memory.seed("balanceSnapshots", [
        { _id: new ObjectId(), turn: 9, balances: { "government:BG:BGL": 2825 }, anchorRates: {} },
      ]);
    else await writeBalanceSnapshot(db, 9);
    await processTreasuryTurn(10);
    await writePreForexBalanceCheckpoint(db, 10);
    await writeBalanceSnapshot(db, 10);
    const budget = (await db
      .collection<FederalBudget>("federalBudget")
      .findOne({ countryId: "BG" }))!;
    const closing = (await db
      .collection<BalanceSnapshot>("balanceSnapshots")
      .findOne({ turn: 10 }))!;
    expect(budget.treasuryBalance).toBe(5650);
    expect(closing.balances["government:BG:BGL"]).toBe(200);
    expect(closing.accountValuations!["government:BG:BGL"]).toEqual({
      anchorRate: budget.treasuryAccrual!.anchorRate,
      anchorRateSource: "authored_budget_only",
      anchorRatePreset: "1991-default",
    });
    expect(closing.anchorRates).toEqual({});
    const report = await reconcileTurn(db, 10);
    expect(report?.stockVsFlow.divergentCount).toBe(0);
    expect(report?.trialBalance.status).toBe("green");
    expect(report?.unattributed).toEqual([]);
  });
  it("prefers an observed rate and rejects explicit corrupt quotes", async () => {
    const { memory, db } = world();
    memory.seed("exchangeRates", [{ _id: "BG", currencyCode: "BGL", rate: 56.5 }]);
    expect((await collectBalances(db))["government:BG:BGL"]).toBe(50);
    await db.collection("exchangeRates").updateOne({ currencyCode: "BGL" }, { $set: { rate: 0 } });
    await expect(collectBalances(db)).rejects.toThrow(
      "Missing valid treasury-accrual exchange rate"
    );
  });
  it("does not value an active currency from an authored budget-only rate", async () => {
    const { db } = world();
    await db
      .collection("federalBudget")
      .updateMany({}, { $set: { countryId: "UK", currencyCode: "GBP" } });
    await expect(collectBalances(db)).rejects.toThrow(
      "Missing valid treasury-accrual exchange rate"
    );
  });
});
