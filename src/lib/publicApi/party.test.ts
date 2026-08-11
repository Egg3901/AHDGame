import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

const partyObjId = new ObjectId();

describe("queryParty", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    ["politicalParties", "electedOfficials", "characters", "elections"].forEach((n) =>
      db.collection(n)
    );
  });

  it("returns null when party not found", async () => {
    db.collectionMocks.politicalParties!.findOne.mockResolvedValue(null);
    const { queryParty } = await import("./party");
    const result = await queryParty(db as unknown as Db, { id: "999", country: "US" });
    expect(result).toBeNull();
  });

  it("includes seatCount from electedOfficials", async () => {
    db.collectionMocks.politicalParties!.findOne.mockResolvedValue({
      _id: partyObjId,
      name: "Democrats",
      abbreviation: "DEM",
      color: "#00f",
      sequentialId: 1,
      countryId: "US",
      economicPosition: -30,
      socialPosition: -40,
      memberCount: 50,
      treasury: 10000,
      chairCharacterId: null,
    });
    db.collectionMocks.electedOfficials!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: "s1", party: "1" },
        { _id: "s2", party: "1" },
        { _id: "s3", party: "1" },
      ]),
    } as never);
    db.collectionMocks.characters!.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    db.collectionMocks.elections!.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    } as never);

    const { queryParty } = await import("./party");
    const result = await queryParty(db as unknown as Db, { id: "1", country: "US" });

    expect(result).not.toBeNull();
    expect(result!.seatCount).toBe(3);
  });

  it("includes economicLabel and socialLabel strings", async () => {
    db.collectionMocks.politicalParties!.findOne.mockResolvedValue({
      _id: partyObjId,
      name: "Democrats",
      abbreviation: "DEM",
      color: "#00f",
      sequentialId: 1,
      countryId: "US",
      economicPosition: -60,
      socialPosition: -50,
      memberCount: 10,
      treasury: 0,
      chairCharacterId: null,
    });
    db.collectionMocks.electedOfficials!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    db.collectionMocks.characters!.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    db.collectionMocks.elections!.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    } as never);

    const { queryParty } = await import("./party");
    const result = await queryParty(db as unknown as Db, { id: "1", country: "US" });

    expect(result).not.toBeNull();
    expect(typeof result!.economicLabel).toBe("string");
    expect(typeof result!.socialLabel).toBe("string");
    expect(result!.economicLabel.length).toBeGreaterThan(0);
  });
});
