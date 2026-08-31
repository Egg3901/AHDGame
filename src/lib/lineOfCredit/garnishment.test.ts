import { describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Character } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { createAsyncIterableCursor, createMockDb } from "@/lib/test-utils/mockDb";
import { garnishLocFromIncome } from "./garnishment";

vi.mock("@/lib/lineOfCredit/featureFlag", () => ({
  isLineOfCreditEnabled: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/lineOfCredit/netWorth", () => ({
  loadExchangeRatesMap: vi.fn().mockResolvedValue({ USD: 1 }),
}));

vi.mock("@/lib/lineOfCredit/ledger", () => ({
  insertLocLedgerEntry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/financialTxLog/emit", () => ({
  loadTxThresholds: vi.fn().mockResolvedValue({}),
  emitTxBulk: vi.fn().mockResolvedValue(undefined),
}));

describe("garnishLocFromIncome", () => {
  it("leaves income untouched when the LOC snapshot claim loses a race", async () => {
    const db = createMockDb();
    const characterId = new ObjectId();
    const character = {
      _id: characterId,
      name: "Borrower",
      countryId: "US",
      lineOfCredit: {
        balances: { USD: 500 },
        arrears: { USD: 50 },
        drawFrozen: true,
      },
    } as Character;
    db.collection("characters");
    db.collectionMocks.characters.find.mockReturnValue(createAsyncIterableCursor([character]));
    db.collectionMocks.characters.updateOne.mockResolvedValueOnce({
      matchedCount: 0,
      modifiedCount: 0,
    });

    const income = new Map<string, Map<CurrencyCode, number>>([
      [characterId.toString(), new Map<CurrencyCode, number>([["USD", 100]])],
    ]);

    await expect(garnishLocFromIncome(db as never, income, 12, "bond_coupon")).resolves.toEqual({
      borrowersGarnished: 0,
      totalInternalGarnished: 0,
    });
    expect(income.get(characterId.toString())?.get("USD")).toBe(100);
    expect(db.collectionMocks.centralBanks).toBeUndefined();
  });
});
