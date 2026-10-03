import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { reportReceivedMail } from "./playerMail";

vi.mock("@/lib/notifications", () => ({ createNotifications: vi.fn() }));

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
});

describe("reportReceivedMail", () => {
  it("snapshots the reported message so the report outlives the mail row", async () => {
    const userId = new ObjectId();
    const mail = {
      _id: new ObjectId(),
      fromCharacterId: new ObjectId(),
      fromCharacterName: "Sender",
      fromCharacterSequentialId: 7,
      toUserId: userId,
      toCharacterId: new ObjectId(),
      toCharacterName: "Recipient",
      toCharacterSequentialId: 9,
      subject: "Re: the vote",
      body: "the reported words",
      read: true,
      deletedByRecipient: false,
      deletedBySender: false,
      createdAt: new Date("2026-10-01T12:00:00Z"),
    };
    db.collection("playerMail");
    db.collectionMocks.playerMail.findOne.mockResolvedValue(mail);

    await reportReceivedMail(db as unknown as Db, userId.toString(), mail._id.toString());

    const inserted = db.collectionMocks.playerMailReports.insertOne.mock.calls[0][0];
    expect(inserted.mailId).toEqual(mail._id);
    expect(inserted.status).toBe("pending");
    expect(inserted.mailSnapshot).toEqual({
      fromCharacterId: mail.fromCharacterId,
      fromCharacterName: "Sender",
      fromCharacterSequentialId: 7,
      toUserId: userId,
      toCharacterId: mail.toCharacterId,
      toCharacterName: "Recipient",
      toCharacterSequentialId: 9,
      subject: "Re: the vote",
      body: "the reported words",
      createdAt: mail.createdAt,
    });
  });
});
