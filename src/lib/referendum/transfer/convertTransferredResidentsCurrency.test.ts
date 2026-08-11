import { describe, it, expect, vi, beforeEach } from "vitest";
import { type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/currency/corporationCapital", () => ({
  loadFxRatesByCurrency: vi.fn().mockResolvedValue(
    new Map([
      ["GBP", 0.5],
      ["IEP", 1.0],
    ])
  ),
}));
vi.mock("@/lib/corporations/convertCorpCurrency", () => ({
  convertCorpCurrency: vi.fn().mockResolvedValue({ ok: true, converted: true }),
}));

const { convertTransferredResidentsCurrency } =
  await import("./convertTransferredResidentsCurrency");
const { convertCorpCurrency } = await import("@/lib/corporations/convertCorpCurrency");
const { isForexEnabled } = await import("@/lib/currency/featureFlag");

function cursorOf<T>(docs: T[]) {
  const c = { project: vi.fn(() => c), toArray: vi.fn().mockResolvedValue(docs) };
  return c;
}

describe("convertTransferredResidentsCurrency", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("re-denominates corps + resident players from GBP to IEP at the FX scale", async () => {
    // scale = toRate/fromRate = IEP(1.0)/GBP(0.5) = 2
    db.collection("corporations").find.mockReturnValue(
      cursorOf([{ _id: "c1", headquartersState: "NIR", countryId: "IE" }])
    );
    db.collection("characters").find.mockReturnValue(
      cursorOf([
        { _id: "p1", currencyBalances: { campaign: 1000, personal: { GBP: 5000, USD: 200 } } },
      ])
    );

    await convertTransferredResidentsCurrency(db as unknown as Db, "NIR", "UK", "IE");

    expect(convertCorpCurrency).toHaveBeenCalledTimes(1);
    expect(vi.mocked(convertCorpCurrency).mock.calls[0][2]).toBe("IEP"); // target currency
    const set = db.collectionMocks["characters"].updateOne.mock.calls[0][1].$set;
    expect(set["currencyBalances.campaign"]).toBe(2000); // 1000 × 2
    expect(set["currencyBalances.personal"].IEP).toBe(10000); // 5000 GBP × 2
    expect(set["currencyBalances.personal"].GBP).toBeUndefined(); // old currency removed
    expect(set["currencyBalances.personal"].USD).toBe(200); // foreign holding kept as forex
  });

  it("no-ops when forex is disabled", async () => {
    vi.mocked(isForexEnabled).mockResolvedValueOnce(false);
    await convertTransferredResidentsCurrency(db as unknown as Db, "NIR", "UK", "IE");
    expect(convertCorpCurrency).not.toHaveBeenCalled();
  });
});
