import { describe, it, expect, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Corporation, ShareListing, ShareOrder } from "@/lib/db/types";
import { getControllingCorporateParent } from "@/lib/corporations/corporateOwnership";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  corporationWithReservedHoldings,
  loadReservedCorporatePositions,
  reservedCorporatePositions,
  resolveControllingCorporateParent,
} from "./reservedCorporateHoldings";

const parentId = new ObjectId();
const childId = new ObjectId();

function child(shareholders: Corporation["shareholders"]): Corporation {
  return {
    _id: childId,
    name: "Child",
    totalShares: 100,
    shareholders,
  } as Corporation;
}

describe("reservedCorporatePositions", () => {
  it("groups open corp-placed sell orders for the target", () => {
    const orders = [
      {
        corporationId: childId,
        type: "sell",
        status: "open",
        placerCorporationId: parentId,
        sharesRemaining: 60,
      },
      {
        corporationId: childId,
        type: "buy",
        status: "open",
        placerCorporationId: parentId,
        sharesRemaining: 10,
      },
      {
        corporationId: new ObjectId(),
        type: "sell",
        status: "open",
        placerCorporationId: parentId,
        sharesRemaining: 99,
      },
    ] as ShareOrder[];
    const reserved = reservedCorporatePositions(orders, [], childId);
    expect(reserved).toHaveLength(1);
    expect(reserved[0].corporationId.equals(parentId)).toBe(true);
    expect(reserved[0].shares).toBe(60);
  });

  it("includes open corp listings", () => {
    const listings = [
      {
        corporationId: childId,
        status: "open",
        sellerCorporationId: parentId,
        sharesRemaining: 15,
      },
    ] as ShareListing[];
    const reserved = reservedCorporatePositions([], listings, childId);
    expect(reserved[0].shares).toBe(15);
  });
});

describe("corporationWithReservedHoldings", () => {
  it("adds reserved shares onto an existing corp holder", () => {
    const merged = corporationWithReservedHoldings(
      child([{ corporationId: parentId, shares: 10 }]),
      [{ corporationId: parentId, shares: 50 }]
    );
    expect(merged.shareholders?.[0].shares).toBe(60);
  });

  it("recreates a pulled holder so a 100% reserved sell still shows an owner", () => {
    const merged = corporationWithReservedHoldings(child([]), [
      { corporationId: parentId, shares: 100 },
    ]);
    expect(merged.shareholders).toHaveLength(1);
    expect(merged.shareholders?.[0].corporationId?.equals(parentId)).toBe(true);
    expect(merged.shareholders?.[0].shares).toBe(100);
    const parent = getControllingCorporateParent(merged);
    expect(parent?.corporationId.equals(parentId)).toBe(true);
    expect(parent?.ownershipPct).toBe(100);
  });
});

describe("resolveControllingCorporateParent", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
    db.collection("shareOrders");
    db.collection("shareListings");
  });

  it("returns the parent when live cap table is empty but a reserved sell remains", async () => {
    db.collectionMocks["shareOrders"]!.find = (() => ({
      toArray: async () => [
        {
          corporationId: childId,
          type: "sell",
          status: "open",
          placerCorporationId: parentId,
          sharesRemaining: 80,
        },
      ],
    })) as never;
    const parent = await resolveControllingCorporateParent(db as never, child([]));
    expect(parent?.corporationId.equals(parentId)).toBe(true);
    expect(parent?.ownershipPct).toBe(80);
  });

  it("returns null when nothing is reserved and nobody holds >50%", async () => {
    const parent = await resolveControllingCorporateParent(db as never, child([]));
    expect(parent).toBeNull();
  });
});

describe("loadReservedCorporatePositions", () => {
  it("queries sell orders and listings for the target", async () => {
    const db = createMockDb();
    db.collection("shareOrders");
    db.collection("shareListings");
    db.collectionMocks["shareOrders"]!.find = (() => ({
      toArray: async () => [
        {
          corporationId: childId,
          type: "sell",
          status: "open",
          placerCorporationId: parentId,
          sharesRemaining: 40,
        },
      ],
    })) as never;
    db.collectionMocks["shareListings"]!.find = (() => ({
      toArray: async () => [
        {
          corporationId: childId,
          status: "open",
          sellerCorporationId: parentId,
          sharesRemaining: 10,
        },
      ],
    })) as never;
    const reserved = await loadReservedCorporatePositions(db as never, childId);
    expect(reserved).toHaveLength(1);
    expect(reserved[0].shares).toBe(50);
  });
});
