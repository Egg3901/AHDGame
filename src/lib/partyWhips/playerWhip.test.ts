import { describe, it, expect, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { getEligibleCharactersForWhip } from "./playerWhip";

describe("getEligibleCharactersForWhip", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
  });

  it("returns characterIds for seated non-NPP, non-banned members of the chamber/party/country", async () => {
    const c1 = new ObjectId();
    const c2 = new ObjectId();
    const c3 = new ObjectId();
    const u1 = new ObjectId();
    const u2 = new ObjectId();
    const u3 = new ObjectId();

    // officials: 3 characters; c3's user will be banned
    db.collection("electedOfficials").find.mockReturnValueOnce({
      toArray: async () => [
        { characterId: c1, isNPP: false },
        { characterId: c2, isNPP: false },
        { characterId: c3, isNPP: false },
      ],
    });
    db.collection("characters").find.mockReturnValueOnce({
      project: () => ({
        toArray: async () => [
          { _id: c1, userId: u1 },
          { _id: c2, userId: u2 },
          { _id: c3, userId: u3 },
        ],
      }),
    });
    db.collection("users").find.mockReturnValueOnce({
      project: () => ({
        toArray: async () => [{ _id: u3, isBanned: true }],
      }),
    });

    const result = await getEligibleCharactersForWhip(db as unknown as Db, "US", "1", "house");

    expect(result.map((id) => id.toString()).sort()).toEqual([c1.toString(), c2.toString()].sort());
  });

  it("filters by isNPP: false on electedOfficials query", async () => {
    db.collection("electedOfficials").find.mockReturnValueOnce({
      toArray: async () => [],
    });

    const result = await getEligibleCharactersForWhip(db as unknown as Db, "US", "1", "house");

    expect(result).toEqual([]);
    const findMock = db.collectionMocks["electedOfficials"]!.find;
    const filter = findMock.mock.calls[0][0] as Record<string, unknown>;
    expect(filter.isNPP).toBe(false);
    expect(filter.party).toBe("1");
    expect(filter.officeType).toBe("house");
    expect(filter.countryId).toBe("US");
  });

  it("maps CN chamber key 'npc' to office type 'npcDelegate' for the officials query", async () => {
    // CN is the one country whose lower-chamber key ("npc") differs from the
    // office type its seated delegates are stored under ("npcDelegate"). The
    // query must resolve the key to the office type or it matches zero delegates.
    db.collection("electedOfficials").find.mockReturnValueOnce({
      toArray: async () => [],
    });

    const result = await getEligibleCharactersForWhip(db as unknown as Db, "CN", "1", "npc");

    expect(result).toEqual([]);
    const findMock = db.collectionMocks["electedOfficials"]!.find;
    const filter = findMock.mock.calls[0][0] as Record<string, unknown>;
    expect(filter.officeType).toBe("npcDelegate");
    expect(filter.countryId).toBe("CN");
  });

  it("handles officials with null characterId gracefully (skips them)", async () => {
    const c1 = new ObjectId();
    db.collection("electedOfficials").find.mockReturnValueOnce({
      toArray: async () => [
        { characterId: c1, isNPP: false },
        { characterId: null, isNPP: false },
      ],
    });
    db.collection("characters").find.mockReturnValueOnce({
      project: () => ({
        toArray: async () => [{ _id: c1, userId: new ObjectId() }],
      }),
    });
    db.collection("users").find.mockReturnValueOnce({
      project: () => ({ toArray: async () => [] }),
    });

    const result = await getEligibleCharactersForWhip(db as unknown as Db, "US", "1", "house");

    expect(result.map((id) => id.toString())).toEqual([c1.toString()]);
  });
});
