import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/currency/characterFunds", () => ({
  getTotalPersonalWealth: vi.fn().mockReturnValue(0),
}));
vi.mock("@/lib/corporations/marketQuote", () => ({
  getPublicShareQuote: vi.fn().mockReturnValue(0),
}));

function makeCursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

describe("computePlayerNetWorthInternal", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("corporations");
    db.collection("bonds");
  });

  it("anchor-normalizes JPY bond holdings using the projected bond currency", async () => {
    const characterId = new ObjectId();

    db.collectionMocks["corporations"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["bonds"]!.find.mockReturnValue(
      makeCursor([
        {
          _id: new ObjectId(),
          currencyCode: "JPY",
          marketPrice: 1,
          holders: [{ characterId, units: 100 }],
          corporationId: new ObjectId(),
        },
      ])
    );

    const { computePlayerNetWorthInternal } = await import("./netWorth");
    const result = await computePlayerNetWorthInternal(
      db as unknown as Db,
      {
        _id: characterId,
        countryId: "US",
      } as never,
      true,
      { JPY: 100 }
    );

    // 100 units × ¥1,000 face = ¥100,000 local, which should normalize to 1,000 internal.
    expect(result).toBe(1000);
  });
});
