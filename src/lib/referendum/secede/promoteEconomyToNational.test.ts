import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { promoteEconomyToNational } from "./promoteEconomyToNational";

const cursorOf = <T>(docs: T[]) => ({ toArray: vi.fn().mockResolvedValue(docs) });

describe("promoteEconomyToNational", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    // States: SCO gdp 200, rump-UK gdp 800 → weight 0.2.
    db.collection("states").find.mockReturnValue(
      cursorOf([
        { _id: "LOT", countryId: "SCO", gdp: 200 },
        { _id: "LON", countryId: "UK", gdp: 800 },
      ])
    );
  });

  function seedUkBudget() {
    db.collection("federalBudget").findOne.mockImplementation(async (q: { _id: string }) =>
      q._id === "UK"
        ? {
            _id: "UK",
            countryId: "UK",
            fiscalYear: 2020,
            taxBases: { income: 1000, corporate: 500 },
            taxRates: { income: 20 }, // rate — must NOT scale
            treasuryBalance: -500,
            debt: { principal: 500, interestRate: 3, ceiling: 9000 },
            gdp: 1000,
            currencyCode: "GBP",
          }
        : null
    );
  }

  it("stands up the new budget at the GDP-share weight and debits the UK", async () => {
    seedUkBudget();
    await promoteEconomyToNational(db as unknown as Db, "UK", "SCO");

    const newBudget = db.collectionMocks["federalBudget"]!.insertOne.mock.calls[0][0] as {
      _id: string;
      countryId: string;
      currencyCode: string;
      taxBases: { income: number; corporate: number };
      taxRates: { income: number };
      treasuryBalance: number;
      debt: { principal: number; interestRate: number };
    };
    expect(newBudget._id).toBe("SCO");
    expect(newBudget.currencyCode).toBe("GBP");
    expect(newBudget.taxBases.income).toBeCloseTo(200, 6); // 0.2 × 1000
    expect(newBudget.taxBases.corporate).toBeCloseTo(100, 6);
    expect(newBudget.treasuryBalance).toBeCloseTo(-100, 6);
    expect(newBudget.debt.principal).toBeCloseTo(100, 6);
    expect(newBudget.debt.interestRate).toBe(3); // copied, not scaled
    expect(newBudget.taxRates.income).toBe(20); // rate copied

    const [, update] = db.collectionMocks["federalBudget"]!.updateOne.mock.calls[0];
    const set = (update as { $set: Record<string, unknown> }).$set;
    expect((set.taxBases as { income: number }).income).toBeCloseTo(800, 6); // UK keeps 0.8
    expect(set.treasuryBalance).toBeCloseTo(-400, 6);
    expect(set["debt.principal"]).toBeCloseTo(400, 6);
  });

  it("conserves each magnitude: Σ(UK_after, new) === UK_before", async () => {
    seedUkBudget();
    await promoteEconomyToNational(db as unknown as Db, "UK", "SCO");
    const newB = db.collectionMocks["federalBudget"]!.insertOne.mock.calls[0][0] as {
      taxBases: { income: number };
      treasuryBalance: number;
      debt: { principal: number };
    };
    const set = (
      db.collectionMocks["federalBudget"]!.updateOne.mock.calls[0][1] as {
        $set: Record<string, unknown>;
      }
    ).$set;
    expect(newB.taxBases.income + (set.taxBases as { income: number }).income).toBeCloseTo(1000, 6);
    expect(newB.treasuryBalance + (set.treasuryBalance as number)).toBeCloseTo(-500, 6);
    expect(newB.debt.principal + (set["debt.principal"] as number)).toBeCloseTo(500, 6);
  });

  it("is a no-op when the new country's budget already exists", async () => {
    db.collection("federalBudget").findOne.mockResolvedValue({ _id: "SCO", countryId: "SCO" });
    await promoteEconomyToNational(db as unknown as Db, "UK", "SCO");
    expect(db.collectionMocks["federalBudget"]!.insertOne).not.toHaveBeenCalled();
  });
});
