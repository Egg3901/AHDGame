import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({ resolveCorporation: vi.fn() }));

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  vi.clearAllMocks();
});

async function setup(corpId: ObjectId) {
  const { getDb } = await import("@/lib/mongodb");

  vi.mocked(getDb).mockResolvedValue(db as any);
  const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(resolveCorporation).mockResolvedValue({
    ok: true,

    corporation: { _id: corpId, name: "Test Corp" } as any,
  });
}

function makeEntries(corpId: ObjectId, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    _id: new ObjectId(),
    corporationId: corpId,
    kind: "market_buy",
    turn: 100 + i,
    createdAt: new Date(2026, 3, i + 1),
    shares: 10,
    pricePerShareAnchor: 100,
    totalAnchor: 1000,
    corpCurrencyCode: "USD",
    from: null,
    to: { characterId: new ObjectId(), name: `Buyer ${i}` },
  }));
}

describe("GET /api/corporations/[id]/shares/history", () => {
  it("returns page 1 of 25 newest-first by default", async () => {
    const corpId = new ObjectId();
    await setup(corpId);

    const historyColl = db.collection("shareTradeHistory");
    (historyColl.countDocuments as ReturnType<typeof vi.fn>).mockResolvedValue(60);
    const entries = makeEntries(corpId, 25);
    (historyColl.find as ReturnType<typeof vi.fn>).mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue(entries),
    });

    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/shares/history");
    const res = await GET(req, { params: Promise.resolve({ id: "abc" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(25);
    expect(body.total).toBe(60);
    expect(body.pageCount).toBe(3);
    expect(body.entries).toHaveLength(25);
    expect(body.entries[0].kind).toBe("market_buy");
    expect(body.entries[0].to.name).toBe("Buyer 0");
  });

  it("applies custom page and pageSize", async () => {
    const corpId = new ObjectId();
    await setup(corpId);

    const historyColl = db.collection("shareTradeHistory");
    (historyColl.countDocuments as ReturnType<typeof vi.fn>).mockResolvedValue(10);
    const skipSpy = vi.fn().mockReturnThis();
    const limitSpy = vi.fn().mockReturnThis();
    (historyColl.find as ReturnType<typeof vi.fn>).mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      skip: skipSpy,
      limit: limitSpy,
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { GET } = await import("./route");
    const req = new Request(
      "http://localhost/api/corporations/abc/shares/history?page=2&pageSize=5"
    );
    const res = await GET(req, { params: Promise.resolve({ id: "abc" }) });
    expect(res.status).toBe(200);
    expect(skipSpy).toHaveBeenCalledWith(5); // (page-1)*pageSize
    expect(limitSpy).toHaveBeenCalledWith(5);
    const body = await res.json();
    expect(body.page).toBe(2);
    expect(body.pageSize).toBe(5);
    expect(body.pageCount).toBe(2);
  });

  it("returns pageCount=1 when there are no entries", async () => {
    const corpId = new ObjectId();
    await setup(corpId);
    const historyColl = db.collection("shareTradeHistory");
    (historyColl.countDocuments as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    (historyColl.find as ReturnType<typeof vi.fn>).mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/shares/history");
    const res = await GET(req, { params: Promise.resolve({ id: "abc" }) });
    const body = await res.json();
    expect(body.total).toBe(0);
    expect(body.pageCount).toBe(1);
    expect(body.entries).toEqual([]);
  });

  it("rejects pageSize above the max (100)", async () => {
    const corpId = new ObjectId();
    await setup(corpId);
    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/shares/history?pageSize=500");
    const res = await GET(req, { params: Promise.resolve({ id: "abc" }) });
    expect(res.status).toBe(400);
  });
});
