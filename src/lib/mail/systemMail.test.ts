import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { sendSystemMail } from "./systemMail";
import { ObjectId } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
});

describe("sendSystemMail", () => {
  it("inserts a mail document with no fromCharacterId", async () => {
    const toCharacterId = new ObjectId();
    const toUserId = new ObjectId();

    await sendSystemMail(db as unknown as import("mongodb").Db, {
      toCharacterId,
      toCharacterName: "Alice",
      toCharacterSequentialId: 42,
      toUserId,
      subject: "Test Subject",
      body: "Test body",
    });

    const insertCalls = db.collectionMocks.playerMail?.insertOne?.mock.calls;
    expect(insertCalls).toHaveLength(1);

    const inserted = insertCalls![0][0];
    expect(inserted.fromCharacterId).toBeUndefined();
    expect(inserted.fromCharacterName).toBe("Forex Market");
    expect(inserted.toCharacterId).toEqual(toCharacterId);
    expect(inserted.toUserId).toEqual(toUserId);
    expect(inserted.subject).toBe("Test Subject");
    expect(inserted.body).toBe("Test body");
    expect(inserted.read).toBe(false);
    expect(inserted.deletedByRecipient).toBe(false);
    expect(inserted.deletedBySender).toBe(false);
  });

  it("uses a custom senderName when provided", async () => {
    const toCharacterId = new ObjectId();
    const toUserId = new ObjectId();

    await sendSystemMail(db as unknown as import("mongodb").Db, {
      toCharacterId,
      toCharacterName: "Bob",
      toCharacterSequentialId: 7,
      toUserId,
      subject: "System Alert",
      body: "Something happened.",
      senderName: "Game System",
    });

    const inserted = db.collectionMocks.playerMail?.insertOne?.mock.calls[0][0];
    expect(inserted.fromCharacterName).toBe("Game System");
  });
});
