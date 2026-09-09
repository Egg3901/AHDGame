import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { bankBalanceSheet } from "@/lib/banking/balanceSheet";
import { executeMonetaryOperation } from "./operations";

describe("liquidity injections reach the bank balance sheet", () => {
  it("adds lending reserves and matching debt without paying the holding company", async () => {
    const db = createInMemoryDb();
    const id = new ObjectId();
    db.seed("gameConfig", [{ _id: "default", privateBankingEnabled: true }]);
    db.seed("centralBanks", [{ _id: "US", countryId: "US", externalBroadMoney: 10000 }]);
    const charter = {
      type: "retail" as const,
      status: "active" as const,
      currency: "USD" as const,
      cashReserves: 1000,
      totalDeposits: 500,
      npcDeposits: 500,
      totalLoans: 0,
      cbMarginDebt: 0,
      capitalStanding: "adequate" as const,
    };
    db.seed("corporations", [
      {
        _id: id,
        name: "Test Bank",
        countryId: "US",
        liquidCapital: 2000,
        bankCharter: charter,
      },
    ]);
    const before = bankBalanceSheet({ charter, reserveRatio: 0.1 });
    await executeMonetaryOperation(db as unknown as Db, {
      countryId: "US",
      type: "liquidity_injection",
      amount: 400,
      turn: 12,
      actorName: "Chair",
    });
    const after = db.collection("corporations").docs[0] as {
      liquidCapital: number;
      bankCharter: typeof charter;
    };
    expect(after.liquidCapital).toBe(2000);
    const sheet = bankBalanceSheet({ charter: after.bankCharter, reserveRatio: 0.1 });
    expect(sheet.cashReserves).toBe(before.cashReserves + 400);
    expect(sheet.reserveSurplus).toBe(before.reserveSurplus + 400);
    expect(sheet.bookEquity).toBe(before.bookEquity);
    expect(after.bankCharter.cbMarginDebt).toBe(400);
  });
});
