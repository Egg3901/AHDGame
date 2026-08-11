import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { ObjectId } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireAuthWithCharacter: vi.fn(),
}));

let db: MockDb;
beforeEach(async () => {
  vi.resetModules();
  db = createMockDb();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as import("mongodb").Db);
  // Pre-initialize collection so collectionMocks entry exists before mocking
  db.collection("playerMail");
});

const makeAuth = (userId: ObjectId, charId: ObjectId) => ({
  ok: true,
  user: { userId: userId.toString(), character: { _id: charId, name: "T", sequentialId: 1 } },
});

describe("PATCH /api/mail/[id]", () => {
  it("marks mail as read for the recipient", async () => {
    const userId = new ObjectId();
    const charId = new ObjectId();
    const mailId = new ObjectId();

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(makeAuth(userId, charId) as never);

    db.collectionMocks.playerMail.findOne.mockResolvedValue({
      _id: mailId,
      toUserId: userId,
      fromCharacterId: new ObjectId(),
      deletedByRecipient: false,
      read: false,
    });
    db.collectionMocks.playerMail.updateOne.mockResolvedValue({ modifiedCount: 1 });

    const { PATCH } = await import("./route");
    const req = new Request(`http://localhost/api/mail/${mailId}`);
    const res = await PATCH(req, { params: Promise.resolve({ id: mailId.toString() }) });

    expect(res.status).toBe(200);
    expect(db.collectionMocks.playerMail.updateOne).toHaveBeenCalledWith(
      { _id: mailId, toUserId: userId },
      { $set: { read: true } }
    );
  });

  it("returns 404 when mail not found for user", async () => {
    const userId = new ObjectId();
    const charId = new ObjectId();
    const mailId = new ObjectId();

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(makeAuth(userId, charId) as never);

    db.collectionMocks.playerMail.findOne.mockResolvedValue(null);

    const { PATCH } = await import("./route");
    const req = new Request(`http://localhost/api/mail/${mailId}`);
    const res = await PATCH(req, { params: Promise.resolve({ id: mailId.toString() }) });

    expect(res.status).toBe(404);
  });

  it("returns 404 for a deleted mail", async () => {
    const userId = new ObjectId();
    const charId = new ObjectId();
    const mailId = new ObjectId();

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(makeAuth(userId, charId) as never);

    // Mail already soft-deleted by recipient
    db.collectionMocks.playerMail.findOne.mockResolvedValue(null);

    const { PATCH } = await import("./route");
    const req = new Request(`http://localhost/api/mail/${mailId}`);
    const res = await PATCH(req, { params: Promise.resolve({ id: mailId.toString() }) });

    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/mail/[id]", () => {
  it("soft-deletes mail from inbox", async () => {
    const userId = new ObjectId();
    const charId = new ObjectId();
    const mailId = new ObjectId();

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(makeAuth(userId, charId) as never);

    db.collectionMocks.playerMail.findOne.mockResolvedValue({
      _id: mailId,
      toUserId: userId,
      deletedBySender: false,
      deletedByRecipient: false,
    });
    db.collectionMocks.playerMail.updateOne.mockResolvedValue({ modifiedCount: 1 });
    db.collectionMocks.playerMail.deleteOne.mockResolvedValue({ deletedCount: 0 });

    const { DELETE } = await import("./route");
    const req = new Request(`http://localhost/api/mail/${mailId}`, { method: "DELETE" });
    const res = await DELETE(req, { params: Promise.resolve({ id: mailId.toString() }) });

    expect(res.status).toBe(200);
    expect(db.collectionMocks.playerMail.updateOne).toHaveBeenCalledWith(
      { _id: mailId, toUserId: userId },
      { $set: { deletedByRecipient: true } }
    );
  });

  it("hard-deletes when sender has also deleted", async () => {
    const userId = new ObjectId();
    const charId = new ObjectId();
    const mailId = new ObjectId();

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(makeAuth(userId, charId) as never);

    db.collectionMocks.playerMail.findOne.mockResolvedValue({
      _id: mailId,
      toUserId: userId,
      deletedBySender: true,
      deletedByRecipient: false,
    });
    db.collectionMocks.playerMail.updateOne.mockResolvedValue({ modifiedCount: 1 });
    db.collectionMocks.playerMail.deleteOne.mockResolvedValue({ deletedCount: 1 });

    const { DELETE } = await import("./route");
    const req = new Request(`http://localhost/api/mail/${mailId}`, { method: "DELETE" });
    const res = await DELETE(req, { params: Promise.resolve({ id: mailId.toString() }) });

    expect(res.status).toBe(200);
    expect(db.collectionMocks.playerMail.deleteOne).toHaveBeenCalledWith({ _id: mailId });
  });
});
