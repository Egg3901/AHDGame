import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { processSavingsInterestTurn } from "@/lib/turn/savingsInterestTurn";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/monetaryPolicy/presetMonetaryScope", () => ({
  getPresetMonetaryScope: vi.fn(() => ({ forexCountries: [], centralBankCountries: [] })),
}));

describe("savings interest with an empty monetary scope", () => {
  it("does not call Mongo bulkWrite with an empty operation array", async () => {
    const db = createInMemoryDb();
    db.seed("gameConfig", [{ _id: "default", forexEnabled: true }]);
    db.seed("gameState", [{ _id: "current", preset: "2019-default" }]);
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const write = vi
      .spyOn(db.collection("centralBanks"), "bulkWrite")
      .mockImplementation(async (ops) => {
        if (ops.length === 0)
          throw new Error(
            "MongoInvalidArgumentError: Invalid BulkOperation, Batch cannot be empty"
          );
        throw new Error("Unexpected central-bank write for an empty scope");
      });
    await expect(processSavingsInterestTurn(db as unknown as Db, 1)).resolves.toEqual({
      charactersProcessed: 0,
      totalInterest: 0,
    });
    expect(write).not.toHaveBeenCalled();
  });
});
