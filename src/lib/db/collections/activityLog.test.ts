import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import { logCharacterDeleted } from "./activityLog";

describe("logCharacterDeleted", () => {
  it("inserts a character_deleted activityLog row with snapshot details", async () => {
    const insertOne = vi.fn().mockResolvedValue({ insertedId: new ObjectId() });
    const db = { collection: vi.fn().mockReturnValue({ insertOne }) };
    const userId = new ObjectId();
    const characterId = new ObjectId();

    await logCharacterDeleted(db as never, {
      reason: "admin_delete",
      userId,
      username: "alice",
      characterId,
      characterName: "Alice Stone",
      countryId: "US",
      details: { party: "Reform party", highestOffice: "Senator" },
    });

    expect(db.collection).toHaveBeenCalledWith("activityLog");
    expect(insertOne).toHaveBeenCalledTimes(1);
    const doc = insertOne.mock.calls[0][0];
    expect(doc.type).toBe("character_deleted");
    expect(doc.userId).toBe(userId);
    expect(doc.characterId).toBe(characterId);
    expect(doc.username).toBe("alice");
    expect(doc.characterName).toBe("Alice Stone");
    expect(doc.countryId).toBe("US");
    expect(doc.summary).toContain("admin");
    expect(doc.details).toMatchObject({ party: "Reform party", highestOffice: "Senator" });
    expect(doc.timestamp).toBeInstanceOf(Date);
    expect(doc._id).toBeInstanceOf(ObjectId);
  });

  it("works for self_delete with no character", async () => {
    const insertOne = vi.fn().mockResolvedValue({ insertedId: new ObjectId() });
    const db = { collection: vi.fn().mockReturnValue({ insertOne }) };
    await logCharacterDeleted(db as never, {
      reason: "self_delete",
      userId: new ObjectId(),
      username: "bob",
    });
    const doc = insertOne.mock.calls[0][0];
    expect(doc.type).toBe("character_deleted");
    expect(doc.characterId).toBeUndefined();
    expect(doc.summary.toLowerCase()).toContain("self");
    expect(doc.details).toEqual({});
  });
});
