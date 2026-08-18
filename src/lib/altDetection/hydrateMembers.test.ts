import { describe, expect, it, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { hydrateAltMembers } from "./hydrateMembers";

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  db.collection("users");
  db.collection("characters");
  db.collection.mockClear();
});

describe("hydrateAltMembers", () => {
  it("returns an empty map for an empty id set without querying", async () => {
    const out = await hydrateAltMembers(db as unknown as Db, []);
    expect(out.size).toBe(0);
    expect(db.collection).not.toHaveBeenCalled();
  });

  it("joins the active character and decodes Discord snowflake age", async () => {
    const userId = new ObjectId();
    const activeId = new ObjectId();
    const otherId = new ObjectId();
    // Discord docs example: 175928847299117063 → 2016-04-30T11:18:25.796Z
    const discordId = "175928847299117063";

    db.collectionMocks.users.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: userId,
          username: "acct",
          isBanned: false,
          email: "acct@example.com",
          lastKnownIp: "198.51.100.42",
          registrationIp: "198.51.100.1",
          trackingId: "cookie-abc",
          discordId,
          discordUsername: "egg#0001",
          discordAvatar: "abc",
          activeCharacterId: activeId,
        },
      ]),
    });
    db.collectionMocks.characters.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: otherId,
          userId,
          name: "Retired Life",
          avatarUrl: "/old.png",
          sequentialId: 1,
        },
        {
          _id: activeId,
          userId,
          name: "Andrew the Geo",
          avatarUrl: "/now.png",
          sequentialId: 42,
        },
      ]),
    });

    const out = await hydrateAltMembers(db as unknown as Db, [userId], { revealNetwork: true });
    const row = out.get(userId.toString());
    expect(row).toMatchObject({
      userId: userId.toString(),
      name: "acct",
      characterName: "Andrew the Geo",
      characterId: activeId.toString(),
      sequentialId: 42,
      avatarUrl: "/now.png",
      discordId,
      discordUsername: "egg#0001",
      email: "acct@example.com",
      lastKnownIp: "198.51.100.42",
      trackingId: "cookie-abc",
    });
    expect(row?.discordCreatedAt).toBe("2016-04-30T11:18:25.796Z");
  });

  it("falls back to the Discord avatar when the character has no PFP", async () => {
    const userId = new ObjectId();
    db.collectionMocks.users.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: userId,
          username: "acct",
          isBanned: true,
          discordId: "123456789",
          discordUsername: "x",
          discordAvatar: "hash",
        },
      ]),
    });
    db.collectionMocks.characters.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ _id: new ObjectId(), userId, name: "No Pic", sequentialId: 7 }]),
    });

    const row = (await hydrateAltMembers(db as unknown as Db, [userId])).get(userId.toString());
    expect(row?.banned).toBe(true);
    expect(row?.characterName).toBe("No Pic");
    expect(row?.avatarUrl).toBe("https://cdn.discordapp.com/avatars/123456789/hash.png");
  });

  it("stubs a row when the user document is missing", async () => {
    const missing = new ObjectId();
    db.collectionMocks.users.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.characters.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const row = (await hydrateAltMembers(db as unknown as Db, [missing])).get(missing.toString());
    expect(row).toMatchObject({
      userId: missing.toString(),
      name: null,
      characterName: null,
      discordId: null,
      email: null,
      trackingId: null,
    });
  });

  it("masks email/IP and drops the tracking cookie when revealNetwork is off", async () => {
    const userId = new ObjectId();
    db.collectionMocks.users.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: userId,
          username: "acct",
          email: "hello@example.com",
          lastKnownIp: "198.51.100.42",
          trackingId: "cookie-secret",
        },
      ]),
    });
    db.collectionMocks.characters.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const row = (await hydrateAltMembers(db as unknown as Db, [userId])).get(userId.toString());
    expect(row?.email).toBe("he***@example.com");
    expect(row?.lastKnownIp).toBe("198.51.100.xxx");
    expect(row?.trackingId).toBeNull();
  });
});
