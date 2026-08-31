import { beforeEach, describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { ShareListing, ShareOffer } from "@/lib/db/types";
import { expireShareListings } from "./shareListings";

const NOW = new Date("2026-08-24T00:00:00Z");

function cursorOf<T>(docs: T[]) {
  return {
    toArray: async () => docs,
    project() {
      return this;
    },
  };
}

function listing(): ShareListing {
  return {
    _id: new ObjectId(),
    corporationId: new ObjectId(),
    sellerCharacterId: new ObjectId(),
    sharesListed: 10,
    sharesRemaining: 0,
    marketPriceAtCreation: 100,
    status: "open",
    createdAt: new Date("2026-08-20T00:00:00Z"),
    expiresAt: NOW,
    expiresAtTurn: 20,
  };
}

describe("expireShareListings", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    db.collection("shareListings");
    db.collection("shareOffers");
    db.collection("exchangeRates");
  });

  it("does not process a listing whose open-state claim lost a race", async () => {
    const candidate = listing();
    db.collectionMocks.shareListings.find.mockReturnValue(cursorOf([candidate]));
    db.collectionMocks.shareListings.findOneAndUpdate.mockResolvedValue(null);

    await expireShareListings(db as unknown as Db, NOW, 20);

    expect(db.collectionMocks.shareOffers.find).not.toHaveBeenCalled();
    expect(db.collectionMocks.characters).toBeUndefined();
  });

  it("refunds only offers atomically claimed from pending", async () => {
    const candidate = listing();
    const offer: ShareOffer = {
      _id: new ObjectId(),
      listingId: candidate._id,
      corporationId: candidate.corporationId,
      buyerCharacterId: new ObjectId(),
      shares: 10,
      pricePerShare: 100,
      escrowAmount: 1_000,
      status: "pending",
      createdAt: NOW,
    };
    db.collectionMocks.shareListings.find.mockReturnValue(cursorOf([candidate]));
    db.collectionMocks.shareListings.findOneAndUpdate.mockResolvedValue(candidate);
    db.collectionMocks.shareOffers.find.mockReturnValue(cursorOf([offer]));
    db.collectionMocks.shareOffers.findOneAndUpdate.mockResolvedValue(null);

    await expireShareListings(db as unknown as Db, NOW, 20);

    expect(db.collectionMocks.shareOffers.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: offer._id, listingId: candidate._id, status: "pending" },
      { $set: { status: "expired" } },
      { returnDocument: "before" }
    );
    expect(db.collectionMocks.characters).toBeUndefined();
    expect(db.collectionMocks.corporations).toBeUndefined();
  });
});
