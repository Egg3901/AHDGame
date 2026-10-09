import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { sendSystemMails } from "./systemMail";

describe("batched system mail", () => {
  it("writes eleven distinct recipients in one command with system mail fields", async () => {
    const insertMany = vi.fn().mockResolvedValue({ insertedCount: 11 });
    const collection = vi.fn().mockReturnValue({ insertMany });
    const db = { collection } as unknown as Db;
    const recipients = Array.from({ length: 11 }, (_, i) => ({
      toCharacterId: new ObjectId(),
      toCharacterName: `Recipient ${i}`,
      toCharacterSequentialId: i + 1,
      toUserId: new ObjectId(),
      subject: "Whip",
      body: "Vote aye",
      senderName: "Party Whip",
    }));
    await sendSystemMails(db, recipients);
    expect(collection).toHaveBeenCalledWith("playerMail");
    expect(insertMany).toHaveBeenCalledOnce();
    const docs = insertMany.mock.calls[0]?.[0];
    expect(docs).toHaveLength(11);
    recipients.forEach((recipient, i) => {
      expect(docs[i]).toEqual(
        expect.objectContaining({
          toUserId: recipient.toUserId,
          toCharacterId: recipient.toCharacterId,
          fromCharacterName: "Party Whip",
          subject: "Whip",
          body: "Vote aye",
          read: false,
          deletedByRecipient: false,
          deletedBySender: false,
          createdAt: expect.any(Date),
        })
      );
    });
  });
  it("does not issue an empty mail insert", async () => {
    const collection = vi.fn();
    await sendSystemMails({ collection } as unknown as Db, []);
    expect(collection).not.toHaveBeenCalled();
  });
});
