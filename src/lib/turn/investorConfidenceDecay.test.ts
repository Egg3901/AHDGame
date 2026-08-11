import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { INVESTOR_CONFIDENCE_BASELINE } from "@/lib/nationalization/constants";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function cursor<T>(rows: T[]) {
  return {
    toArray: vi.fn().mockResolvedValue(rows),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

describe("processInvestorConfidenceDecay", () => {
  let db: MockDb;
  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("federalBudget");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("moves a depressed country's confidence toward baseline and skips baseline ones", async () => {
    db.collectionMocks.federalBudget.find.mockReturnValue(
      cursor([
        { countryId: "US", investorConfidence: 40 },
        { countryId: "UK", investorConfidence: INVESTOR_CONFIDENCE_BASELINE },
        { countryId: "DE" }, // no value ⇒ baseline ⇒ skipped
      ])
    );

    const { processInvestorConfidenceDecay } = await import("./investorConfidenceDecay");
    const result = await processInvestorConfidenceDecay(5);

    expect(result.countriesHealed).toBe(1);
    const call = db.collectionMocks.federalBudget.bulkWrite.mock.calls[0][0];
    expect(call).toHaveLength(1);
    expect(call[0].updateOne.filter).toEqual({ countryId: "US" });
    expect(call[0].updateOne.update.$set.investorConfidence).toBeGreaterThan(40);
    expect(call[0].updateOne.update.$set.investorConfidence).toBeLessThanOrEqual(
      INVESTOR_CONFIDENCE_BASELINE
    );
  });

  it("is a no-op when no country is below baseline", async () => {
    db.collectionMocks.federalBudget.find.mockReturnValue(cursor([]));
    const { processInvestorConfidenceDecay } = await import("./investorConfidenceDecay");
    const result = await processInvestorConfidenceDecay(5);
    expect(result.countriesHealed).toBe(0);
    expect(db.collectionMocks.federalBudget.bulkWrite).not.toHaveBeenCalled();
  });
});
