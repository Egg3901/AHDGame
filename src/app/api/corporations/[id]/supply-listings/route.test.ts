import { beforeEach, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { GET, POST } from "./route";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn(),
  requireCeo: vi.fn(),
}));
vi.mock("@/lib/api/requireCorporationActions", () => ({
  requireCorporationActionsEnabled: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(100) }));
let db: MockDb;
const corpId = new ObjectId();
const context = { params: Promise.resolve({ id: corpId.toString() }) };
function request(body?: unknown) {
  return new Request(
    "http://localhost/api/corporations/1/supply-listings",
    body ? { method: "POST", body: JSON.stringify(body) } : undefined
  );
}
const offer = {
  action: "publish",
  slot: 0,
  side: "sell",
  commodity: "energy",
  volumeCap: 100,
  pricePremium: 0.05,
  validForTurns: 48,
};
beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({ ok: true, user: { userId: "owner" } } as never);
  const { resolveCorporation, requireCeo } = await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(resolveCorporation).mockResolvedValue({
    ok: true,
    corporation: { _id: corpId, userId: "owner", name: "Test Co" },
  } as never);
  vi.mocked(requireCeo).mockReturnValue(null);
  db.collection("gameConfig").findOne.mockResolvedValue({ supplyAgreementsEnabled: true });
});
it("publishes to a bounded publisher slot without creating a private contract", async () => {
  expect((await POST(request(offer), context)).status).toBe(200);
  const call = db.collectionMocks.supplyListings.replaceOne.mock.calls[0];
  expect(call[0]).toEqual({ _id: `${corpId}:0`, corporationId: corpId });
  expect(call[1]).toMatchObject({ expiresAtTurn: 148, volumeCap: 100, publishedByUserId: "owner" });
  expect(db.collectionMocks.supplyAgreements).toBeUndefined();
});
it("withdraws only the route corporation's slot", async () => {
  await POST(request({ action: "withdraw", slot: 2 }), context);
  expect(db.collectionMocks.supplyListings.deleteOne).toHaveBeenCalledWith({
    _id: `${corpId}:2`,
    corporationId: corpId,
  });
});
it("rejects invalid slots, illegal price premiums and missing freight states", async () => {
  for (const body of [
    { ...offer, slot: 10 },
    { ...offer, pricePremium: 999 },
    { ...offer, commodity: "freight" },
  ])
    expect((await POST(request(body), context)).status).toBe(400);
  expect(db.collectionMocks.supplyListings).toBeUndefined();
});
it("requires CEO authority and the feature flag", async () => {
  const { requireCeo } = await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(requireCeo).mockReturnValue(
    Response.json({ error: "Forbidden" }, { status: 403 }) as never
  );
  expect((await GET(request(), context)).status).toBe(403);
  expect((await POST(request(offer), context)).status).toBe(403);
  vi.mocked(requireCeo).mockReturnValue(null);
  db.collectionMocks.gameConfig.findOne.mockResolvedValue({ supplyAgreementsEnabled: false });
  expect((await POST(request(offer), context)).status).toBe(403);
});
it("filters expired advertisements and does not cache private CEO context", async () => {
  const response = await GET(request(), context);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(db.collectionMocks.supplyListings.find).toHaveBeenCalledWith({
    expiresAtTurn: { $gt: 100 },
  });
  expect(db.collectionMocks.supplyAgreements).toBeUndefined();
});
