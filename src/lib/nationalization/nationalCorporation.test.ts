import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  isStateOwned,
  ensurePrimaryNationalCorporation,
  resolveNationalCorporationForSector,
} from "./nationalCorporation";

function cursorOf<T>(docs: T[]) {
  const c = {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn(() => c),
    limit: vi.fn(() => c),
    next: vi.fn(async () => docs[0] ?? null),
  };
  return c;
}

describe("isStateOwned", () => {
  it("is true when countryOwnerId is set", () => {
    expect(isStateOwned({ countryOwnerId: "CN" })).toBe(true);
  });
  it("is true when ownershipState is stateOwned", () => {
    expect(isStateOwned({ ownershipState: "stateOwned" })).toBe(true);
  });
  it("is false for a private corp", () => {
    expect(isStateOwned({ ownershipState: "private" })).toBe(false);
    expect(isStateOwned({})).toBe(false);
  });
});

describe("ensurePrimaryNationalCorporation", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("corporations");
  });

  it("returns the flagged primary when one exists, without creating another", async () => {
    const existingId = new ObjectId();
    db.collectionMocks.corporations.find.mockReturnValue(
      cursorOf([
        {
          _id: existingId,
          name: "China National Corporation",
          countryId: "CN",
          countryOwnerId: "CN",
          isPrimaryNationalCorporation: true,
          ownershipState: "stateOwned",
        },
      ])
    );

    const corp = await ensurePrimaryNationalCorporation(db as unknown as Db, "CN");

    expect(corp._id.toString()).toBe(existingId.toString());
    expect(db.collectionMocks.corporations.find).toHaveBeenCalledWith({
      countryOwnerId: "CN",
      isPrimaryNationalCorporation: true,
    });
    expect(db.collectionMocks.corporations.insertOne).not.toHaveBeenCalled();
  });

  it("falls back to a pre-backfill seeded NatCorp (no primary flag yet)", async () => {
    const legacyId = new ObjectId();
    // First find (flagged primary) → []; second (any countryOwnerId) → legacy.
    db.collectionMocks.corporations.find
      .mockReturnValueOnce(cursorOf([]))
      .mockReturnValueOnce(cursorOf([{ _id: legacyId, countryId: "CN", countryOwnerId: "CN" }]));

    const corp = await ensurePrimaryNationalCorporation(db as unknown as Db, "CN");

    expect(corp._id.toString()).toBe(legacyId.toString());
    expect(db.collectionMocks.corporations.insertOne).not.toHaveBeenCalled();
  });

  it("creates a flagged primary when none exists", async () => {
    const insertedId = new ObjectId();
    db.collectionMocks.corporations.find.mockReturnValue(cursorOf([]));
    db.collectionMocks.corporations.insertOne.mockResolvedValue({ insertedId });

    const corp = await ensurePrimaryNationalCorporation(db as unknown as Db, "CN");

    expect(db.collectionMocks.corporations.insertOne).toHaveBeenCalledTimes(1);
    const insertedDoc = db.collectionMocks.corporations.insertOne.mock.calls[0][0];
    expect(insertedDoc.countryOwnerId).toBe("CN");
    expect(insertedDoc.ownershipState).toBe("stateOwned");
    expect(insertedDoc.isNationalized).toBe(true);
    // National Corporations are listed on the exchange as non-tradable state
    // assets (parity with the seeded primaries), so they surface in the market.
    expect(insertedDoc.hiddenFromExchange).toBe(false);
    expect(insertedDoc.sharePrice).toBe(1);
    expect(insertedDoc.isPrimaryNationalCorporation).toBe(true);
    expect(insertedDoc.assignedSectorTypes).toEqual([]);
    expect(corp._id.toString()).toBe(insertedId.toString());
    expect(corp.countryOwnerId).toBe("CN");
  });
});

describe("resolveNationalCorporationForSector", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("corporations");
  });

  it("returns the split-off whose assignedSectorTypes includes the type", async () => {
    const splitId = new ObjectId();
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: splitId,
      countryId: "CN",
      countryOwnerId: "CN",
      assignedSectorTypes: ["energy"],
    });

    const corp = await resolveNationalCorporationForSector(db as unknown as Db, "CN", "energy");

    expect(corp._id.toString()).toBe(splitId.toString());
    expect(db.collectionMocks.corporations.findOne).toHaveBeenCalledWith({
      countryOwnerId: "CN",
      assignedSectorTypes: "energy",
    });
  });

  it("falls back to the primary when no split-off claims the type", async () => {
    const primaryId = new ObjectId();
    // 1st find (split-off lookup) → []; 2nd (primary lookup) → primary.
    db.collectionMocks.corporations.find.mockReturnValueOnce(cursorOf([])).mockReturnValueOnce(
      cursorOf([
        {
          _id: primaryId,
          countryId: "CN",
          countryOwnerId: "CN",
          isPrimaryNationalCorporation: true,
        },
      ])
    );

    const corp = await resolveNationalCorporationForSector(db as unknown as Db, "CN", "technology");

    expect(corp._id.toString()).toBe(primaryId.toString());
  });
});
