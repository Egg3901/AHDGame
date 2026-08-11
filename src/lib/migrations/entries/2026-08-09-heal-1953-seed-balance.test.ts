import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { migration } from "./2026-08-09-heal-1953-seed-balance";

describe(migration.id, () => {
  it("is a read-only no-op outside a 1953 world", async () => {
    const db = createMockDb();
    db.collection("gameState");
    db.collectionMocks.gameState!.findOne.mockResolvedValue({
      _id: "current",
      preset: "2019-default",
    });

    const result = await migration.execute(db as unknown as Db, { dryRun: false });

    expect(result.notes?.[0]).toContain("skipped");
    expect(db.collectionMocks.federalBudget).toBeUndefined();
  });

  it("reports the production repair without writing in dry-run mode", async () => {
    const db = createMockDb();
    db.collection("gameState");
    db.collectionMocks.gameState!.findOne.mockResolvedValue({
      _id: "current",
      preset: "1953-default",
    });
    db.collection("federalBudget");
    db.collectionMocks.federalBudget!.find.mockReturnValue({
      toArray: async () => [{ _id: "UK", countryId: "UK" }],
    } as never);

    const result = await migration.execute(db as unknown as Db, { dryRun: true });

    expect(result.documentsUpdated).toBe(0);
    expect(result.notes).toContain(
      "would reconcile 80 US/UK/RU/DD registration regions for 1953-default"
    );
    expect(db.collectionMocks.federalBudget!.updateOne).not.toHaveBeenCalled();
  });

  it("reprices live UK debt from its authored AAA 4 percent anchor", async () => {
    const db = createMockDb();
    db.collection("gameState");
    db.collectionMocks.gameState!.findOne.mockResolvedValue({
      _id: "current",
      preset: "1953-default",
    });
    db.collection("federalBudget");
    db.collectionMocks.federalBudget!.find.mockReturnValue({
      toArray: async () => [
        {
          _id: "UK",
          countryId: "UK",
          gdp: 14_400_000_000,
          treasuryBalance: -26_000_000_000,
          debt: { principal: 26_000_000_000, interestRate: 0.1 },
          spending: { debtInterest: 2_600_000_000, total: 6_000_000_000 },
          revenue: { total: 5_000_000_000 },
        },
      ],
    } as never);
    db.collection("politicalParties");
    db.collectionMocks.politicalParties!.find.mockReturnValue({ toArray: async () => [] } as never);

    await migration.execute(db as unknown as Db, { dryRun: false });

    const update = db.collectionMocks.federalBudget!.updateOne.mock.calls[0]![1] as {
      $set: Record<string, unknown>;
    };
    expect(update.$set.creditRating).toBe("AAA");
    expect(update.$set["debt.interestRate"]).toBeCloseTo(0.04, 8);
    expect(update.$set["spending.debtInterest"]).toBeCloseTo(1_040_000_000, -2);
  });
});
