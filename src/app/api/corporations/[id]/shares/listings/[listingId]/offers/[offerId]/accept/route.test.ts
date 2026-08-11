import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/requireCorporationActions", () => ({
  requireCorporationActionsEnabled: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn().mockResolvedValue(false) }));

let db: MockDb;

beforeEach(async () => {
  db = createMockDb();
  vi.clearAllMocks();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as never);
});

describe("POST /api/corporations/[id]/shares/listings/[listingId]/offers/[offerId]/accept", () => {
  it("returns 404 when the listing does not belong to the corporation path", async () => {
    const userId = new ObjectId();
    const pathCorpId = new ObjectId();
    const listingCorpId = new ObjectId();
    const listingId = new ObjectId();
    const offerId = new ObjectId();
    const sellerId = new ObjectId();
    const buyerId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as never);

    db.collection("corporations");
    db.collectionMocks["corporations"]!.findOne.mockResolvedValue({
      _id: pathCorpId,
      name: "Path Corp",
    });

    db.collection("shareListings");
    db.collection("shareOffers");
    db.collectionMocks["shareListings"]!.findOne.mockResolvedValue({
      _id: listingId,
      corporationId: listingCorpId,
      sellerCharacterId: sellerId,
      sharesRemaining: 50,
      status: "open",
      expiresAt: new Date(Date.now() + 60_000),
    });
    db.collectionMocks["shareOffers"]!.findOne.mockResolvedValue({
      _id: offerId,
      listingId,
      corporationId: listingCorpId,
      buyerCharacterId: buyerId,
      shares: 10,
      pricePerShare: 100,
      escrowAmount: 1000,
      status: "pending",
      createdAt: new Date(),
    });

    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sharesToAccept: 5 }),
      }),
      {
        params: Promise.resolve({
          id: pathCorpId.toString(),
          listingId: listingId.toString(),
          offerId: offerId.toString(),
        }),
      }
    );

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: "Listing not found" });
    expect(db.collectionMocks["shareOffers"]!.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
