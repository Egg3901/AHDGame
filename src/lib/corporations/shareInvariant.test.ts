import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { computeAccountedShares } from "./shareInvariant";
import type { Corporation, ShareListing, ShareOrder } from "@/lib/db/types";

// Build a minimal corp test fixture. Only the fields read by
// computeAccountedShares matter; others are cast for test math only.
function makeCorp(partial: Partial<Corporation> & { _id: ObjectId }): Corporation {
  return {
    name: "Test Co",
    shareholders: [],
    publicFloat: 0,
    totalShares: 0,
    sharePrice: 1,
    ...partial,
  } as unknown as Corporation;
}

function makeListing(partial: Partial<ShareListing> & { corporationId: ObjectId }): ShareListing {
  return {
    _id: new ObjectId(),
    sellerCharacterId: new ObjectId(),
    sharesListed: 0,
    sharesRemaining: 0,
    marketPriceAtCreation: 1,
    status: "open",
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 86_400_000),
    ...partial,
  } as ShareListing;
}

function makeOrder(
  partial: Partial<ShareOrder> & { corporationId: ObjectId; type: "buy" | "sell" }
): ShareOrder {
  return {
    _id: new ObjectId(),
    characterId: new ObjectId(),
    shares: 0,
    sharesRemaining: 0,
    pricePerShare: 1,
    escrowAmount: 0,
    status: "open",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  } as ShareOrder;
}

describe("computeAccountedShares", () => {
  it("sums shareholders + publicFloat when no reservations", () => {
    const corpId = new ObjectId();
    const charA = new ObjectId();
    const corp = makeCorp({
      _id: corpId,
      shareholders: [{ characterId: charA, shares: 100 }],
      publicFloat: 50,
    });
    expect(computeAccountedShares(corp, [], [])).toBe(150);
  });

  it("adds open listing sharesRemaining (listings debit at creation)", () => {
    const corpId = new ObjectId();
    const charA = new ObjectId();
    const corp = makeCorp({
      _id: corpId,
      shareholders: [{ characterId: charA, shares: 20 }],
      publicFloat: 0,
    });
    const listings = [
      makeListing({ corporationId: corpId, sharesListed: 80, sharesRemaining: 80 }),
    ];
    expect(computeAccountedShares(corp, listings, [])).toBe(100);
  });

  it("adds open corp-placed sell orders only (character orders stay in shareholders)", () => {
    const corpId = new ObjectId();
    const corpB = new ObjectId();
    const corp = makeCorp({
      _id: corpId,
      shareholders: [{ corporationId: corpB, shares: 0 }],
      publicFloat: 0,
    });
    const orders = [
      makeOrder({
        corporationId: corpId,
        type: "sell",
        placerCorporationId: corpB,
        shares: 40,
        sharesRemaining: 40,
      }),
      makeOrder({
        corporationId: corpId,
        type: "sell",
        // no placerCorporationId — character order, shares still in holder entry
        shares: 10,
        sharesRemaining: 10,
      }),
    ];
    expect(computeAccountedShares(corp, [], orders)).toBe(40);
  });

  it("ignores listings that belong to another corporation", () => {
    const corpId = new ObjectId();
    const charA = new ObjectId();
    const corp = makeCorp({
      _id: corpId,
      shareholders: [{ characterId: charA, shares: 100 }],
    });
    const listings = [
      makeListing({
        corporationId: new ObjectId(), // different corp
        sharesListed: 1_000_000,
        sharesRemaining: 1_000_000,
      }),
    ];
    expect(computeAccountedShares(corp, listings, [])).toBe(100);
  });

  it("ignores non-open listings and buy-side orders", () => {
    const corpId = new ObjectId();
    const corpB = new ObjectId();
    const corp = makeCorp({ _id: corpId, publicFloat: 10 });
    const listings = [
      makeListing({
        corporationId: corpId,
        status: "cancelled",
        sharesListed: 500,
        sharesRemaining: 500,
      }),
      makeListing({
        corporationId: corpId,
        status: "filled",
        sharesListed: 500,
        sharesRemaining: 0,
      }),
    ];
    const orders = [
      makeOrder({
        corporationId: corpId,
        type: "buy",
        placerCorporationId: corpB,
        shares: 500,
        sharesRemaining: 500,
      }),
    ];
    expect(computeAccountedShares(corp, listings, orders)).toBe(10);
  });
});
