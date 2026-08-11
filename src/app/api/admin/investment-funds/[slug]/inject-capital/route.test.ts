import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/adminLog", () => ({ createAdminLog: vi.fn() }));
vi.mock("@/lib/indexFunds/featureFlag", () => ({
  isIndexFundsEnabled: vi.fn().mockResolvedValue(true),
  INDEX_FUNDS_DISABLED_MESSAGE: "Index funds are disabled",
}));

let db: MockDb;

const mockAdmin = { ok: true, admin: { username: "admin1" } };
const mockFundId = new ObjectId();

function makeRequest(slug: string, amount: number): Request {
  return new Request(`http://localhost/api/admin/investment-funds/${slug}/inject-capital`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount }),
  });
}

function makeParams(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

describe("POST /api/admin/investment-funds/[slug]/inject-capital", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("injects capital, updates NAV and backing ratio", async () => {
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);

    db.collection("indexFunds");
    db.collection("indexFundTransactions");

    db.collectionMocks.indexFunds!.findOne.mockResolvedValue({
      _id: mockFundId,
      slug: "us-broad",
      name: "US Broad Market Index",
      tickerSymbol: "USB",
      anchorCurrencyCode: "USD",
      status: "active",
      quotedNav: 100,
      unitSupply: 1000,
      cashAnchor: 10_000,
      holdings: [{ corporationId: new ObjectId(), shares: 100, lastValueAnchor: 30_000 }],
      bondAllocations: [{ countryId: "US", principalAnchor: 5000, couponRate: 0.02 }],
      targetConstituents: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    db.collectionMocks.indexFunds!.updateOne.mockResolvedValue({ modifiedCount: 1 });
    db.collectionMocks.indexFundTransactions!.insertOne.mockResolvedValue({
      insertedId: new ObjectId(),
    });

    const { POST } = await import("./route");
    const res = await POST(makeRequest("us-broad", 25_000), makeParams("us-broad"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.amount).toBe(25_000);
    expect(body.cashAnchor).toBe(35_000);
    // Total backing = 35_000 cash + 30_000 holdings; legacy bondAllocations are ignored.
    // NAV = 65_000 / 1_000 units = 65
    expect(body.quotedNav).toBe(65);
    // Backing ratio = 65_000 / (65 * 1_000) = 1
    expect(body.backingRatio).toBe(1);

    expect(db.collectionMocks.indexFunds!.updateOne).toHaveBeenCalledWith(
      { _id: mockFundId },
      {
        $inc: { cashAnchor: 25_000 },
        $set: expect.objectContaining({
          quotedNav: 65,
          backingRatio: 1,
        }),
      }
    );

    const txCall = db.collectionMocks.indexFundTransactions!.insertOne.mock.calls[0][0] as {
      fundId: ObjectId;
      kind: string;
      amountAnchor: number;
      navAnchor: number;
    };
    expect(txCall.fundId).toEqual(mockFundId);
    expect(txCall.kind).toBe("capital_injection");
    expect(txCall.amountAnchor).toBe(25_000);
    expect(txCall.navAnchor).toBe(65);
  });

  it("returns 400 for non-positive amount", async () => {
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);

    const { POST } = await import("./route");
    const res = await POST(makeRequest("us-broad", 0), makeParams("us-broad"));
    expect(res.status).toBe(400);
  });

  it("returns 404 when fund is not found", async () => {
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);

    db.collection("indexFunds");
    db.collectionMocks.indexFunds!.findOne.mockResolvedValue(null);

    const { POST } = await import("./route");
    const res = await POST(makeRequest("missing", 1000), makeParams("missing"));
    expect(res.status).toBe(404);
  });
});
