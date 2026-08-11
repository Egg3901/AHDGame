import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { INVESTOR_CONFIDENCE_BASELINE } from "./constants";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("investorConfidence helpers", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("federalBudget");
  });

  it("reads the baseline when no value is stored", async () => {
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({ countryId: "US" });
    const { readInvestorConfidence } = await import("./investorConfidence");
    expect(await readInvestorConfidence(db as unknown as Db, "US")).toBe(
      INVESTOR_CONFIDENCE_BASELINE
    );
  });

  it("reads the stored value when present", async () => {
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({
      countryId: "US",
      investorConfidence: 42,
    });
    const { readInvestorConfidence } = await import("./investorConfidence");
    expect(await readInvestorConfidence(db as unknown as Db, "US")).toBe(42);
  });

  it("clamps writes to [0,100] and stamps the turn", async () => {
    const { writeInvestorConfidence } = await import("./investorConfidence");
    await writeInvestorConfidence(db as unknown as Db, "US", 130, 5);
    const call = db.collectionMocks.federalBudget.updateOne.mock.calls[0];
    expect(call[0]).toEqual({ countryId: "US" });
    expect(call[1].$set.investorConfidence).toBe(100);
    expect(call[1].$set.investorConfidenceUpdatedAtTurn).toBe(5);
  });
});
