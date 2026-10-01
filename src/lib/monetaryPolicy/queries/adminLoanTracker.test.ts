import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/lineOfCredit/featureFlag", () => ({
  isLineOfCreditEnabled: vi.fn().mockResolvedValue(true),
}));

describe("admin loan tracker currency", () => {
  it("finds 2027 French borrowers under EUR obligations", async () => {
    const db = createMockDb();
    db.collection("gameState");
    db.collection("exchangeRates");
    db.collection("centralBanks");
    db.collection("characters");
    db.collectionMocks.gameState!.findOne.mockResolvedValue({
      _id: "current",
      preset: "2027-default",
      currentTurn: 1,
    });
    db.collectionMocks.exchangeRates!.find().toArray.mockResolvedValue([]);
    db.collectionMocks.centralBanks!.find().toArray.mockResolvedValue([]);
    db.collectionMocks.characters!.find().toArray.mockResolvedValue([]);

    const { loadAdminLoanTracker } = await import("./adminLoanTracker");
    const result = await loadAdminLoanTracker({ db: db as unknown as Db, countryId: "FR" });

    expect(result).toEqual({
      ok: true,
      body: { countryId: "FR", currencyCode: "EUR", borrowers: [] },
    });
    expect(db.collectionMocks.characters!.find).toHaveBeenCalledWith(
      expect.objectContaining({
        $or: [
          { "lineOfCredit.balances.EUR": { $gt: 0 } },
          { "lineOfCredit.arrears.EUR": { $gt: 0 } },
        ],
      })
    );
  });
});
