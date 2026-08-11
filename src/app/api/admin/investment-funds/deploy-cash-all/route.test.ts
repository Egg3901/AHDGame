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

function makeActiveFund(overrides?: Partial<Record<string, unknown>>) {
  return {
    _id: new ObjectId(),
    slug: "us-broad",
    name: "US Broad Market Index",
    tickerSymbol: "USB",
    anchorCurrencyCode: "USD",
    status: "active",
    quotedNav: 100,
    unitSupply: 1000,
    cashAnchor: 50_000,
    holdings: [],
    bondAllocations: [],
    targetConstituents: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/investment-funds/deploy-cash-all", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/investment-funds/deploy-cash-all", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("increments cashAnchor by amountAnchor for every active fund and writes a capital_injection tx", async () => {
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);

    const fund1Id = new ObjectId();
    const fund2Id = new ObjectId();

    db.collection("indexFunds");
    db.collection("indexFundTransactions");

    // listFunds does a find().sort().toArray() — mock via the cursor's toArray
    const cursor = db.collectionMocks.indexFunds!.find();
    (cursor.toArray as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeActiveFund({ _id: fund1Id, slug: "us-broad", tickerSymbol: "USB" }),
      makeActiveFund({
        _id: fund2Id,
        slug: "eu-broad",
        tickerSymbol: "EUB",
        anchorCurrencyCode: "EUR",
      }),
    ]);
    db.collectionMocks.indexFunds!.updateOne.mockResolvedValue({ matchedCount: 1 });
    db.collectionMocks.indexFundTransactions!.insertOne.mockResolvedValue({
      insertedId: new ObjectId(),
    });

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ amountAnchor: 1_000_000 }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.fundsProcessed).toBe(2);
    expect(body.fundsInjected).toBe(2);
    expect(body.amountAnchor).toBe(1_000_000);

    // Both funds should have been updated
    expect(db.collectionMocks.indexFunds!.updateOne).toHaveBeenCalledTimes(2);
    expect(db.collectionMocks.indexFunds!.updateOne).toHaveBeenCalledWith(
      { _id: fund1Id },
      expect.objectContaining({ $inc: { cashAnchor: 1_000_000 } })
    );
    expect(db.collectionMocks.indexFunds!.updateOne).toHaveBeenCalledWith(
      { _id: fund2Id },
      expect.objectContaining({ $inc: { cashAnchor: 1_000_000 } })
    );

    // Two capital_injection transactions
    expect(db.collectionMocks.indexFundTransactions!.insertOne).toHaveBeenCalledTimes(2);
    const txCalls = db.collectionMocks.indexFundTransactions!.insertOne.mock.calls;
    for (const [tx] of txCalls) {
      expect((tx as { kind: string }).kind).toBe("capital_injection");
      expect((tx as { amountAnchor: number }).amountAnchor).toBe(1_000_000);
    }

    // totalsByCurrency should aggregate per currency
    expect(body.totalsByCurrency).toMatchObject({ USD: 1_000_000, EUR: 1_000_000 });
  });

  it("returns 401 when user is not admin", async () => {
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    } as never);

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ amountAnchor: 1_000_000 }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for missing amountAnchor", async () => {
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);

    const { POST } = await import("./route");
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it("returns 400 for negative amountAnchor", async () => {
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ amountAnchor: -500 }));
    expect(res.status).toBe(400);
  });

  it("returns 403 when index funds feature is disabled", async () => {
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);

    const { isIndexFundsEnabled } = await import("@/lib/indexFunds/featureFlag");
    vi.mocked(isIndexFundsEnabled).mockResolvedValueOnce(false);

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ amountAnchor: 1_000_000 }));
    expect(res.status).toBe(403);
  });
});
