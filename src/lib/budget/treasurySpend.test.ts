import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";
import { spendFromTreasury, creditTreasury } from "./treasurySpend";

let db: MockDb;

function seedBudget(treasuryBalance: number) {
  const doc = {
    _id: "US",
    countryId: "US",
    treasuryBalance,
    gdp: 1000,
    debt: { principal: Math.max(0, -treasuryBalance), ceiling: 10_000, interestRate: 0.03 },
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
  it("spends from surplus without creating debt", async () => {
    seedBudget(1000);
    const impact = await spendFromTreasury(db as unknown as Db, "US", 400);
    expect(impact).toMatchObject({
      fromSurplus: 400,
      addedToDebt: 0,
      newTreasuryBalance: 600,
      newDebtPrincipal: 0,
    });
  });

  it("straddles zero and resyncs debt.principal to the new debt", async () => {
    seedBudget(300);
    const impact = await spendFromTreasury(db as unknown as Db, "US", 500);
    expect(impact).toMatchObject({
      fromSurplus: 300,
      addedToDebt: 200,
      newTreasuryBalance: -200,
      newDebtPrincipal: 200,
    });
    const setOp = (db.collection("federalBudget").updateOne as ReturnType<typeof vi.fn>).mock
      .calls[0][1].$set;
    expect(setOp["debt.principal"]).toBe(200);
  });

  it("creditTreasury is the inverse and clears debt as the balance recovers", async () => {
    seedBudget(-200);
    const impact = await creditTreasury(db as unknown as Db, "US", 500);
    expect(impact).toMatchObject({ newTreasuryBalance: 300, newDebtPrincipal: 0 });
  });
});
