import { describe, it, expect, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { getMailReportDetail } from "./mailReportDetail";

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  db.collection("playerMailReports");
  db.collection("playerMail");
});

describe("getMailReportDetail", () => {
  it("shows the snapshot, marked deleted, once the live message is gone", async () => {
    const reportId = new ObjectId();
    const mailId = new ObjectId();
    const snapshot = {
      fromCharacterId: new ObjectId(),
      fromCharacterName: "Sender",
      fromCharacterSequentialId: 7,
      toUserId: new ObjectId(),
      toCharacterId: new ObjectId(),
      toCharacterName: "Recipient",
      toCharacterSequentialId: 9,
      subject: "Re: the vote",
      body: "the reported words",
      createdAt: new Date("2026-10-01T12:00:00Z"),
    };
    db.collectionMocks.playerMailReports.findOne.mockResolvedValue({
      _id: reportId,
      mailId,
      mailSnapshot: snapshot,
      reportedByUserId: new ObjectId(),
      status: "pending",
      createdAt: new Date("2026-10-02T12:00:00Z"),
    });
    // A world reset dropped playerMail: the anchor lookup finds nothing.
    db.collectionMocks.playerMail.findOne.mockResolvedValue(null);

    const detail = await getMailReportDetail(db as unknown as Db, reportId);

    expect(detail?.subject).toBe("Re: the vote");
    expect(detail?.messages).toEqual([
      expect.objectContaining({
        id: mailId.toString(),
        fromCharacterName: "Sender",
        toCharacterName: "Recipient",
        body: "the reported words",
        isReported: true,
        deletedByRecipient: true,
        deletedBySender: true,
      }),
    ]);
  });

  it("still reports a pre-snapshot report whose message is gone as deleted", async () => {
    const reportId = new ObjectId();
    db.collectionMocks.playerMailReports.findOne.mockResolvedValue({
      _id: reportId,
      mailId: new ObjectId(),
      reportedByUserId: new ObjectId(),
      status: "pending",
      createdAt: new Date("2026-10-02T12:00:00Z"),
    });

    const detail = await getMailReportDetail(db as unknown as Db, reportId);

    expect(detail?.subject).toBeNull();
    expect(detail?.messages).toEqual([]);
  });
});
