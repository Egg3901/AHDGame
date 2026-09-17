import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { migration } from "./2026-09-12-reprice-current-sovereign-risk";

const budget = {
  _id: "DD",
  countryId: "DD",
  gdp: 1_000,
  gdpSmoothed: 1_000,
  treasuryBalance: -400,
  debt: {
    principal: 400,
    interestRate: 0.196,
    ceiling: 1_000,
  },
  sovereignRiskAnchor: {
    debtToGdpRatio: 0.07246376811594203,
    creditRating: "AA" as const,
    interestRate: 0.035,
  },
  investorConfidence: 70,
  imfSovereignBailoutActive: false,
  debtToGdpRatio: 0.4,
  creditRating: "CCC" as const,
  spending: {
    debtInterest: 78.4,
    total: 200,
  },
  revenue: { total: 250 },
} as never;

describe(migration.id, () => {
  it("reports the current-risk reprice without writing in dry-run mode", async () => {
    const db = createMockDb();
    db.collection("federalBudget");
    db.collectionMocks.federalBudget!.find.mockReturnValue({
      toArray: async () => [budget],
    } as never);

    const result = await migration.execute(db as unknown as Db, { dryRun: true });

    expect(result.documentsScanned).toBe(1);
    expect(result.documentsUpdated).toBe(0);
    expect(result.notes).toContain("would reprice DD: AAA at 2.0%");
    expect(db.collectionMocks.federalBudget!.updateOne).not.toHaveBeenCalled();
  });

  it("updates derived fiscal fields but preserves the historical anchor and balance", async () => {
    const db = createMockDb();
    db.collection("federalBudget");
    db.collectionMocks.federalBudget!.find.mockReturnValue({
      toArray: async () => [budget],
    } as never);

    const result = await migration.execute(db as unknown as Db, { dryRun: false });

    expect(result.documentsUpdated).toBe(1);
    const update = db.collectionMocks.federalBudget!.updateOne.mock.calls[0]![1] as {
      $set: Record<string, unknown>;
    };
    expect(update.$set["debt.principal"]).toBe(400);
    expect(update.$set["debt.interestRate"]).toBe(0.02);
    expect(update.$set.creditRating).toBe("AAA");
    expect(update.$set.debtToGdpRatio).toBe(0.4);
    expect(update.$set["spending.debtInterest"]).toBe(8);
    expect(update.$set["spending.total"]).toBeCloseTo(129.6, 10);
    expect(update.$set.surplus).toBeCloseTo(120.4, 10);
    expect(update.$set.sovereignRiskAnchor).toBeUndefined();
    expect((budget as { treasuryBalance: number }).treasuryBalance).toBe(-400);
  });
});
