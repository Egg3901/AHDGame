import { beforeEach, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { requireCeo, resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { getMarketSystemMode } from "@/lib/market/featureFlag";
import { GET, POST } from "./route";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  requireCeo: vi.fn(),
  resolveCorporation: vi.fn(),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/market/featureFlag", async (original) => ({
  ...(await original<typeof import("@/lib/market/featureFlag")>()),
  getMarketSystemMode: vi.fn(),
}));
let db: MockDb;
const id = new ObjectId();
const parentId = new ObjectId();
const userId = new ObjectId();
const corp = { _id: id, userId, totalShares: 100, shareholders: [{ shares: 100 }] };
const params = Promise.resolve({ id: "12" });
const request = (method: string, body?: object) =>
  new Request("http://localhost/api/corporations/12/internal-supply", {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("corporations");
  db.collection("corporateSectors");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId: userId.toString() },
  } as never);
  vi.mocked(resolveCorporation).mockResolvedValue({ ok: true, corporation: corp } as never);
  vi.mocked(requireCeo).mockReturnValue(null);
  vi.mocked(getMarketSystemMode).mockResolvedValue("plants");
  db.collectionMocks.corporations.find.mockReturnValue({ toArray: async () => [corp] });
  db.collectionMocks.corporations.updateOne.mockResolvedValue({ matchedCount: 1 });
  db.collectionMocks.corporateSectors.find.mockReturnValue({ toArray: async () => [] });
});
it("saves CEO settings with an authority guard and no-store", async () => {
  const r = await POST(request("POST", { priority: "own", discount: 0.1 }), { params });
  expect(r.status).toBe(200);
  expect(r.headers.get("Cache-Control")).toContain("no-store");
  expect(db.collectionMocks.corporations.updateOne).toHaveBeenCalledWith(
    { _id: id, userId, ceoVacant: { $ne: true } },
    {
      $set: {
        internalSupplyPolicy: { priority: "own", discount: 0.1 },
        updatedAt: expect.any(Date),
      },
    }
  );
});
it("rejects unauthorized reads and writes before querying holdings", async () => {
  vi.mocked(requireCeo).mockReturnValue(new Response("Forbidden", { status: 403 }) as never);
  expect((await GET(request("GET"), { params })).status).toBe(403);
  expect(
    (await POST(request("POST", { priority: "group", discount: 0.1 }), { params })).status
  ).toBe(403);
  expect(db.collectionMocks.corporations.find).not.toHaveBeenCalled();
});
it("rejects invalid discounts, unknown policies and extra fields", async () => {
  for (const body of [
    { priority: "own", discount: 0.21 },
    { priority: "bad", discount: 0 },
    { priority: "own", discount: 0, unsafe: true },
  ])
    expect((await POST(request("POST", body), { params })).status).toBe(400);
  expect(db.collectionMocks.corporations.updateOne).not.toHaveBeenCalled();
});
it("reports a concurrent CEO change rather than false success", async () => {
  db.collectionMocks.corporations.updateOne.mockResolvedValue({ matchedCount: 0 });
  expect((await POST(request("POST", { priority: "own", discount: 0.1 }), { params })).status).toBe(
    409
  );
});
it("blocks changes outside physical plants mode", async () => {
  vi.mocked(getMarketSystemMode).mockResolvedValue("clearing");
  expect((await POST(request("POST", { priority: "own", discount: 0 }), { params })).status).toBe(
    400
  );
});
it("reloads persisted settings and shows only the latest delivery turn in anchor units", async () => {
  vi.mocked(resolveCorporation).mockResolvedValue({
    ok: true,
    corporation: { ...corp, internalSupplyPolicy: { priority: "own", discount: 0.1 } },
  } as never);
  db.collectionMocks.corporateSectors.find.mockReturnValue({
    toArray: async () => [
      {
        internalSupplyReceipt: {
          turn: 12,
          received: { iron: 20 },
          reserved: {},
          discountCostAnchor: -10,
        },
      },
      {
        internalSupplyReceipt: {
          turn: 12,
          received: {},
          reserved: { iron: 20 },
          discountCostAnchor: 10,
        },
      },
      {
        internalSupplyReceipt: {
          turn: 11,
          received: { iron: 999 },
          reserved: {},
          discountCostAnchor: -999,
        },
      },
    ],
  });
  const r = await GET(request("GET"), { params });
  const d = await r.json();
  expect(d.policy.priority).toBe("own");
  expect(d.received).toEqual({ iron: 20 });
  expect(d.reserved).toEqual({ iron: 20 });
  expect(d.discountCostAnchor).toBe(0);
  expect(d.lastTurn).toBe(12);
});
it("honors a fully owning parent and refuses ineffective subsidiary saves", async () => {
  db.collectionMocks.corporations.find.mockReturnValue({
    toArray: async () => [
      { ...corp, shareholders: [{ corporationId: parentId, shares: 100 }] },
      {
        _id: parentId,
        totalShares: 100,
        shareholders: [{ shares: 100 }],
        internalSupplyPolicy: { priority: "group", discount: 0.1 },
      },
    ],
  });
  expect((await (await GET(request("GET"), { params })).json()).inherited).toBe(true);
  expect((await POST(request("POST", { priority: "own", discount: 0 }), { params })).status).toBe(
    409
  );
});
