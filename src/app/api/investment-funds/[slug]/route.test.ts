import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthUserWithCharacter: vi.fn(async () => null) }));
vi.mock("@/lib/indexFunds/featureFlag", () => ({
  isIndexFundsEnabled: vi.fn(async () => true),
  INDEX_FUNDS_DISABLED_MESSAGE: "Disabled",
}));
vi.mock("@/lib/currency/corporationCapital", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/currency/corporationCapital")>()),
  loadValuationFxRates: vi.fn(
    async () =>
      new Map([
        ["USD", 1],
        ["GBP", 2],
      ])
  ),
}));

const fundId = new ObjectId();
const corporationId = new ObjectId();
const bondId = new ObjectId();

describe("GET fund detail bond holdings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports purchased corporate bonds even when the fund owns no equities and NAV is stale", async () => {
    const db = createMockDb();
    db.collection("indexFunds").findOne.mockResolvedValue({
      _id: fundId,
      slug: "corporate_bond_fund",
      name: "Corporate Bond Fund",
      kind: "bond",
      anchorCurrencyCode: "USD",
      cashAnchor: 100,
      quotedNav: 1,
      unitSupply: 100,
      holdings: [],
      targetConstituents: [],
    });
    db.collection("bonds").find.mockReturnValue({
      toArray: vi.fn(async () => [
        {
          _id: bondId,
          corporationId,
          issuerType: "corporation",
          issuerName: "Example issuer",
          currencyCode: "GBP",
          marketPrice: 0.9,
          couponRate: 6,
          maturityTurn: 100,
          matured: false,
          defaulted: false,
          holders: [{ fundId, units: 5000 }],
        },
      ]),
    });
    db.collection("corporations").find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn(async () => [{ _id: corporationId, name: "Example issuer", sequentialId: 5 }]),
    });
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/investment-funds/corporate_bond_fund"),
      { params: Promise.resolve({ slug: "corporate_bond_fund" }) }
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.fund.bondHoldings).toEqual([
      expect.objectContaining({
        bondId: bondId.toString(),
        issuerName: "Example issuer",
        units: 5000,
        valueAnchor: 2_250_000,
      }),
    ]);
    expect(body.fund.bondHoldingsValueAnchor).toBe(2_250_000);
    expect(db.collection("bonds").find).toHaveBeenCalledWith({
      matured: false,
      defaulted: { $ne: true },
      holders: { $elemMatch: { fundId } },
    });
    expect(body.fund.holdings).toEqual([]);
  });
  it("returns an empty bond book without loading exchange rates", async () => {
    const db = createMockDb();
    db.collection("indexFunds").findOne.mockResolvedValue({
      _id: fundId,
      slug: "empty_fund",
      name: "Empty Fund",
      cashAnchor: 100,
      quotedNav: 1,
      unitSupply: 100,
      holdings: [],
      targetConstituents: [],
    });
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/investment-funds/empty_fund"), {
      params: Promise.resolve({ slug: "empty_fund" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.fund.bondHoldings).toEqual([]);
    expect(body.fund.bondHoldingsValueAnchor).toBe(0);
    expect(body.fund.openOrdersEscrowAnchor).toBe(0);
    const { loadValuationFxRates } = await import("@/lib/currency/corporationCapital");
    expect(loadValuationFxRates).not.toHaveBeenCalled();
  });
});
