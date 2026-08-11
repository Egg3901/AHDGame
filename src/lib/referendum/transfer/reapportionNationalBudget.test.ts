import { describe, it, expect, vi, beforeEach } from "vitest";
import { type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { reapportionNationalBudget } from "./reapportionNationalBudget";

function cursorOf<T>(docs: T[]) {
  const c = { project: vi.fn(() => c), toArray: vi.fn().mockResolvedValue(docs) };
  return c;
}

describe("reapportionNationalBudget", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("moves the region's GDP-weighted share of tax bases + spending to the target", async () => {
    // NIR gdp 50, UK remaining 1950 → weight = 50/2000 = 2.5%
    db.collection("states").findOne.mockResolvedValue({ _id: "NIR", gdp: 50 });
    db.collection("states").find.mockReturnValue(cursorOf([{ gdp: 1950 }]));
    db.collection("federalBudget")
      .findOne.mockResolvedValueOnce({
        _id: "UK",
        taxBases: { taxableIncome: 1000, taxableSales: 400 },
        baselineSpendingByCategory: { health: 200 },
        baselineStateGrants: 80,
      })
      .mockResolvedValueOnce({
        _id: "IE",
        taxBases: { taxableIncome: 60, taxableSales: 20 },
        baselineSpendingByCategory: { health: 10 },
        baselineStateGrants: 8,
      });

    await reapportionNationalBudget(db as unknown as Db, "NIR", "UK", "IE");

    const calls = db.collectionMocks["federalBudget"].updateOne.mock.calls;
    const ukSet = calls.find((c) => c[0]._id === "UK")![1].$set;
    const ieSet = calls.find((c) => c[0]._id === "IE")![1].$set;
    expect(ukSet.taxBases.taxableIncome).toBeCloseTo(975); // 1000 − 2.5%
    expect(ieSet.taxBases.taxableIncome).toBeCloseTo(85); // 60 + 25
    expect(ukSet.taxBases.taxableSales).toBeCloseTo(390);
    expect(ieSet.taxBases.taxableSales).toBeCloseTo(30);
    expect(ukSet.baselineSpendingByCategory.health).toBeCloseTo(195);
    expect(ieSet.baselineSpendingByCategory.health).toBeCloseTo(15);
    expect(ukSet.baselineStateGrants).toBeCloseTo(78);
    expect(ieSet.baselineStateGrants).toBeCloseTo(10);
  });

  it("no-ops when the region carries no GDP", async () => {
    db.collection("states").findOne.mockResolvedValue({ _id: "NIR", gdp: 0 });
    await reapportionNationalBudget(db as unknown as Db, "NIR", "UK", "IE");
    expect(db.collection("federalBudget").updateOne).not.toHaveBeenCalled();
  });
});
