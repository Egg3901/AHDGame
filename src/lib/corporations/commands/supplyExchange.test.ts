import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createAsyncIterableCursor, createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn(),
  requireCeo: vi.fn(),
}));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/api/requireCorporationActions", () => ({
  requireCorporationActionsEnabled: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(100) }));
vi.mock("@/lib/market/featureFlag", () => ({
  getMarketSystemModeForDb: vi.fn().mockResolvedValue("plants"),
  marketAtLeast: vi.fn().mockReturnValue(true),
}));

let db: MockDb;
const publisherId = new ObjectId();
const takerId = new ObjectId();
const publisherUser = new ObjectId();
const takerUser = new ObjectId();

const publisher = (over: Record<string, unknown> = {}) => ({
  _id: publisherId,
  name: "Gridworks",
  userId: publisherUser,
  countryId: "US",
  ...over,
});
const taker = (over: Record<string, unknown> = {}) => ({
  _id: takerId,
  name: "Buyco",
  userId: takerUser,
  countryId: "US",
  ...over,
});
const listing = (over: Record<string, unknown> = {}) => ({
  _id: `${publisherId}:0`,
  corporationId: publisherId,
  publishedByUserId: publisherUser.toString(),
  slot: 0,
  side: "sell",
  commodity: "steel",
  volumeCap: 100,
  pricePremium: 0.05,
  durationTurns: 48,
  expiresAtTurn: 200,
  updatedAt: new Date(),
  ...over,
});

async function takeRequest(body: Record<string, unknown>, as = taker()) {
  const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(resolveCorporation).mockResolvedValue({ ok: true, corporation: as } as never);
  const { takeSupplyListing } = await import("./takeSupplyListing");
  return takeSupplyListing(
    new Request("http://localhost/api/corporations/x/supply-listings/take", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    as._id.toString()
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId: takerUser.toString() },
  } as never);
  const { requireCeo } = await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(requireCeo).mockReturnValue(null);
  db.collection("gameConfig").findOne.mockResolvedValue({
    supplyAgreementsEnabled: true,
    commandEconomyEnabled: false,
  });
  db.collection("gameState").findOne.mockResolvedValue({ currentTurn: 100, currentYear: 1990 });
  db.collection("corporateSectors").find.mockReturnValue(
    createAsyncIterableCursor([
      {
        sectorType: "manufacturing",
        capitalStock: 10_000,
        strategyId: "standard",
        productionPolicyLevel: 0,
        stateId: "TX",
      },
    ])
  );
  db.collection("corporations").findOne.mockResolvedValue(publisher());
  db.collection("supplyListings").findOne.mockResolvedValue(listing());
  db.collection("supplyListings").updateOne.mockResolvedValue({ modifiedCount: 1 });
  db.collection("supplyListings").deleteOne.mockResolvedValue({ deletedCount: 1 });
  db.collection("supplyAgreements");
});

describe("takeSupplyListing", () => {
  it("creates an active agreement and leaves the remainder on a partial take", async () => {
    const response = await takeRequest({ listingId: `${publisherId}:0`, volume: 30 });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "active", remainingVolume: 70 });
    expect(db.collectionMocks.supplyListings.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ volumeCap: 100, expiresAtTurn: { $gt: 100 } }),
      { $set: { volumeCap: 70 } }
    );
    expect(db.collectionMocks.supplyAgreements.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        supplierCorpId: publisherId,
        buyerCorpId: takerId,
        volumeCap: 30,
        pricePremium: 0.05,
        status: "active",
        startsAtTurn: 100,
        expiresAtTurn: 148,
        proposedByCorpId: publisherId,
      })
    );
  });

  it("removes the listing when the whole remaining volume is taken", async () => {
    const response = await takeRequest({ listingId: `${publisherId}:0`, volume: 100 });
    expect(response.status).toBe(200);
    expect(db.collectionMocks.supplyListings.deleteOne).toHaveBeenCalledWith(
      expect.objectContaining({ volumeCap: 100 })
    );
    expect(db.collectionMocks.supplyListings.updateOne).not.toHaveBeenCalled();
  });

  it("makes the buyer the publisher of a buy listing and sizes the taker's capacity", async () => {
    db.collection("supplyListings").findOne.mockResolvedValue(listing({ side: "buy" }));
    const response = await takeRequest({ listingId: `${publisherId}:0`, volume: 30 });
    expect(response.status).toBe(200);
    expect(db.collectionMocks.supplyAgreements.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ supplierCorpId: takerId, buyerCorpId: publisherId })
    );
  });

  it("loses cleanly to a concurrent taker and creates nothing", async () => {
    db.collection("supplyListings").updateOne.mockResolvedValue({ modifiedCount: 0 });
    const response = await takeRequest({ listingId: `${publisherId}:0`, volume: 30 });
    expect(response.status).toBe(409);
    expect(db.collectionMocks.supplyAgreements.insertOne).not.toHaveBeenCalled();
  });

  it("restores the claimed volume when the agreement write fails", async () => {
    db.collection("supplyAgreements").insertOne.mockRejectedValue(new Error("boom"));
    const response = await takeRequest({ listingId: `${publisherId}:0`, volume: 30 });
    expect(response.status).toBe(500);
    expect(db.collectionMocks.supplyListings.updateOne).toHaveBeenLastCalledWith(
      { _id: `${publisherId}:0` },
      { $inc: { volumeCap: 30 } }
    );
  });

  it("lets a player take an AI-posted offer, which has no publishing user (ticket 1418)", async () => {
    // Prod shape: NPP corporations hold the placeholder user id and the turn
    // engine writes AI listings without publishedByUserId.
    db.collection("corporations").findOne.mockResolvedValue(
      publisher({ userId: "000000000000000000000000" })
    );
    db.collection("supplyListings").findOne.mockResolvedValue(
      listing({ _id: `${publisherId}:ai:sell:steel`, publishedByUserId: undefined, aiListed: true })
    );
    const response = await takeRequest({ listingId: `${publisherId}:ai:sell:steel`, volume: 30 });
    expect(response.status).toBe(200);
    expect(db.collectionMocks.supplyAgreements.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        supplierCorpId: publisherId,
        buyerCorpId: takerId,
        status: "active",
      })
    );
  });

  it("rejects over-taking, expired, own and stale-publisher offers", async () => {
    expect((await takeRequest({ listingId: `${publisherId}:0`, volume: 101 })).status).toBe(409);
    db.collection("supplyListings").findOne.mockResolvedValue(listing({ expiresAtTurn: 100 }));
    expect((await takeRequest({ listingId: `${publisherId}:0`, volume: 1 })).status).toBe(404);
    db.collection("supplyListings").findOne.mockResolvedValue(listing());
    expect(
      (await takeRequest({ listingId: `${publisherId}:0`, volume: 1 }, publisher() as never)).status
    ).toBe(400);
    db.collection("corporations").findOne.mockResolvedValue(publisher({ ceoVacant: true }));
    expect((await takeRequest({ listingId: `${publisherId}:0`, volume: 1 })).status).toBe(409);
    expect(db.collectionMocks.supplyAgreements.insertOne).not.toHaveBeenCalled();
  });

  it("is blocked between corporations with the same owner, CEO or a 5% holder", async () => {
    const cases = [
      publisher({ userId: takerUser }),
      publisher({ ceoId: takerId, ceoType: "character" }),
      publisher({ shareholders: [{ corporationId: takerId, shares: 6 }], totalShares: 100 }),
    ];
    for (const doc of cases) {
      db.collection("corporations").findOne.mockResolvedValue(doc);
      db.collection("supplyListings").findOne.mockResolvedValue(
        listing({ publishedByUserId: doc.userId.toString() })
      );
      const as = taker(
        (doc as { ceoId?: unknown }).ceoId ? { ceoId: takerId, ceoType: "character" } : {}
      );
      const response = await takeRequest({ listingId: `${publisherId}:0`, volume: 10 }, as);
      expect(response.status).toBe(403);
    }
    expect(db.collectionMocks.supplyListings.updateOne).not.toHaveBeenCalled();
  });

  it("allows a 4% holding", async () => {
    db.collection("corporations").findOne.mockResolvedValue(
      publisher({ shareholders: [{ corporationId: takerId, shares: 4 }], totalShares: 100 })
    );
    expect((await takeRequest({ listingId: `${publisherId}:0`, volume: 10 })).status).toBe(200);
  });

  it("is blocked across an embargo lane and across the iron curtain, not within a country", async () => {
    db.collection("corporations").findOne.mockResolvedValue(publisher({ countryId: "GB" }));
    db.collection("tradeEmbargoes").find.mockReturnValue(
      createAsyncIterableCursor([
        {
          sourceCountry: "US",
          targetCountry: "GB",
          commodity: "steel",
          direction: "both",
          mode: "block",
        },
      ])
    );
    expect((await takeRequest({ listingId: `${publisherId}:0`, volume: 10 })).status).toBe(403);
    db.collection("tradeEmbargoes").find.mockReturnValue(createAsyncIterableCursor([]));
    expect((await takeRequest({ listingId: `${publisherId}:0`, volume: 10 })).status).toBe(200);
  });

  it("honours the feature flag and notifies both sides", async () => {
    db.collection("gameConfig").findOne.mockResolvedValue({ supplyAgreementsEnabled: false });
    expect((await takeRequest({ listingId: `${publisherId}:0`, volume: 10 })).status).toBe(403);
    db.collection("gameConfig").findOne.mockResolvedValue({
      supplyAgreementsEnabled: true,
      commandEconomyEnabled: false,
    });
    await takeRequest({ listingId: `${publisherId}:0`, volume: 10 });
    const { createNotification } = await import("@/lib/notifications");
    const recipients = vi.mocked(createNotification).mock.calls.map(([n]) => n.userId);
    expect(recipients).toEqual(expect.arrayContaining([publisherUser, takerUser]));
  });
});

describe("amend and accept on a pending offer", () => {
  const agreementId = new ObjectId();
  const offer = (by: ObjectId) => ({
    revision: 1,
    proposedByCorpId: by,
    volumeCap: 100,
    pricePremium: 0,
    exclusive: false,
    proposedAt: new Date("2026-09-12T00:00:00Z"),
  });
  const pending = (by: ObjectId) => ({
    _id: agreementId,
    supplierCorpId: publisherId,
    buyerCorpId: takerId,
    commodity: "steel",
    volumeCap: 100,
    pricePremium: 0,
    exclusive: false,
    status: "pending",
    proposedByCorpId: by,
    currentOffer: offer(by),
    offers: [offer(by)],
    createdAt: new Date("2026-09-12T00:00:00Z"),
    updatedAt: new Date("2026-09-12T00:00:00Z"),
  });
  async function patch(body: Record<string, unknown>, as: ReturnType<typeof taker>) {
    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({ ok: true, corporation: as } as never);
    const { updateSupplyAgreement } = await import("./supplyAgreements");
    return updateSupplyAgreement(
      new Request("http://localhost/x", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      as._id.toString(),
      agreementId.toString()
    );
  }
  beforeEach(() => {
    db.collection("corporations").find.mockReturnValue(
      createAsyncIterableCursor([publisher(), taker()])
    );
  });

  it("lets the author revise their own pending offer as a new revision", async () => {
    db.collection("supplyAgreements").findOne.mockResolvedValue(pending(takerId));
    const response = await patch(
      { action: "amend", volumeCap: 80, pricePremium: -0.05, exclusive: false },
      taker()
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "pending", revision: 2 });
    expect(db.collectionMocks.supplyAgreements.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "pending",
        proposedByCorpId: takerId,
        updatedAt: new Date("2026-09-12T00:00:00Z"),
      }),
      expect.objectContaining({
        $push: { offers: expect.objectContaining({ revision: 2, volumeCap: 80 }) },
      })
    );
    const { createNotification } = await import("@/lib/notifications");
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: publisherUser, title: "Supply agreement amended" })
    );
  });

  it("refuses an amendment from the counterparty and a counter from the author", async () => {
    db.collection("supplyAgreements").findOne.mockResolvedValue(pending(takerId));
    const terms = { volumeCap: 80, pricePremium: 0, exclusive: false };
    expect((await patch({ action: "amend", ...terms }, publisher() as never)).status).toBe(403);
    expect((await patch({ action: "counter", ...terms }, taker())).status).toBe(403);
  });

  it("notifies the offer author on accept and blocks related parties", async () => {
    db.collection("supplyAgreements").findOne.mockResolvedValue(pending(takerId));
    const accepted = await patch({ action: "accept" }, publisher() as never);
    expect(accepted.status).toBe(200);
    const { createNotification } = await import("@/lib/notifications");
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: takerUser, type: "corp_supply_agreement_update" })
    );

    db.collection("corporations").find.mockReturnValue(
      createAsyncIterableCursor([publisher({ userId: takerUser }), taker()])
    );
    expect((await patch({ action: "accept" }, publisher() as never)).status).toBe(403);
  });

  it("gates accept on the feature flag but still lets a party cancel", async () => {
    db.collection("supplyAgreements").findOne.mockResolvedValue(pending(takerId));
    db.collection("gameConfig").findOne.mockResolvedValue({ supplyAgreementsEnabled: false });
    expect((await patch({ action: "accept" }, publisher() as never)).status).toBe(403);
    expect((await patch({ action: "cancel" }, taker())).status).toBe(200);
  });
});
