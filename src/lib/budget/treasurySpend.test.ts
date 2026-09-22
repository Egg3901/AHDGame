import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";
import { spendFromTreasury, creditTreasury } from "./treasurySpend";

let db: MockDb;

// Cash and bond debt are separate positions (refs #1975): the seeded
// principal is the bond-ledger stock and is deliberately independent of the
// cash balance, so the tests prove cash moves never rewrite it.
function seedBudget(treasuryBalance: number, principal = 0) {
  const doc = {
    _id: "US",
    countryId: "US",
    treasuryBalance,
    gdp: 1000,
    debt: { principal, ceiling: 10_000, interestRate: 0.03 },
    debtToGdpRatio: 0,
    creditRating: "AAA",
  };
  db.collection("federalBudget").insertOne(doc);
  // Wire findOne so the implementation can read the seeded balance.
  db.collectionMocks["federalBudget"]!.findOne.mockResolvedValue(doc);
}

beforeEach(() => {
  db = createMockDb();
  db.collection("federalBudget");
  vi.clearAllMocks();
});

describe("spendFromTreasury", () => {
  it("spends from surplus without touching the bond-owned principal", async () => {
    seedBudget(1000, 250);
    const impact = await spendFromTreasury(db as unknown as Db, "US", 400);
    expect(impact).toMatchObject({
      fromSurplus: 400,
      addedToDebt: 0,
      newTreasuryBalance: 600,
      newDebtPrincipal: 250,
    });
    const setOp = (db.collection("federalBudget").updateOne as ReturnType<typeof vi.fn>).mock
      .calls[0][1].$set;
    expect(setOp.treasuryBalance).toBe(600);
    expect(setOp).not.toHaveProperty("debt.principal");
  });

  it("spending past zero moves cash only; the stored stock still comes from the ledger", async () => {
    seedBudget(300, 250);
    const impact = await spendFromTreasury(db as unknown as Db, "US", 500);
    expect(impact).toMatchObject({
      fromSurplus: 300,
      addedToDebt: 200,
      newTreasuryBalance: -200,
      newDebtPrincipal: 250,
    });
    const setOp = (db.collection("federalBudget").updateOne as ReturnType<typeof vi.fn>).mock
      .calls[0][1].$set;
    expect(setOp.treasuryBalance).toBe(-200);
    expect(setOp).not.toHaveProperty("debt.principal");
  });

  it("creditTreasury moves cash only and never clears bond debt on recovery", async () => {
    seedBudget(-200, 500);
    const impact = await creditTreasury(db as unknown as Db, "US", 500);
    expect(impact).toMatchObject({ newTreasuryBalance: 300, newDebtPrincipal: 500 });
    const setOp = (db.collection("federalBudget").updateOne as ReturnType<typeof vi.fn>).mock
      .calls[0][1].$set;
    expect(setOp.treasuryBalance).toBe(300);
    expect(setOp).not.toHaveProperty("debt.principal");
  });
});
