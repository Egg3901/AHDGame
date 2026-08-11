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

describe("DELETE /api/mail/sent/[id]", () => {
  it("soft-deletes from sent box (sender only)", async () => {
    const userId = new ObjectId();
    const charId = new ObjectId();
    const mailId = new ObjectId();

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString(), character: { _id: charId } },
    } as never);

    db.collectionMocks.playerMail.findOne.mockResolvedValue({
      _id: mailId,
      fromCharacterId: charId,
      deletedByRecipient: false,
      deletedBySender: false,
    });
    db.collectionMocks.playerMail.updateOne.mockResolvedValue({ modifiedCount: 1 });
    db.collectionMocks.playerMail.deleteOne.mockResolvedValue({ deletedCount: 0 });

    const { DELETE } = await import("./route");
    const req = new Request(`http://localhost/api/mail/sent/${mailId}`, { method: "DELETE" });
    const res = await DELETE(req, { params: Promise.resolve({ id: mailId.toString() }) });

    expect(res.status).toBe(200);
    expect(db.collectionMocks.playerMail.updateOne).toHaveBeenCalledWith(
      { _id: mailId, fromCharacterId: charId },
      { $set: { deletedBySender: true } }
    );
  });

  it("hard-deletes when recipient has also deleted", async () => {
    const userId = new ObjectId();
    const charId = new ObjectId();
    const mailId = new ObjectId();

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString(), character: { _id: charId } },
    } as never);

    db.collectionMocks.playerMail.findOne.mockResolvedValue({
      _id: mailId,
      fromCharacterId: charId,
      deletedByRecipient: true,
      deletedBySender: false,
    });
    db.collectionMocks.playerMail.updateOne.mockResolvedValue({ modifiedCount: 1 });
    db.collectionMocks.playerMail.deleteOne.mockResolvedValue({ deletedCount: 1 });

    const { DELETE } = await import("./route");
    const req = new Request(`http://localhost/api/mail/sent/${mailId}`, { method: "DELETE" });
    const res = await DELETE(req, { params: Promise.resolve({ id: mailId.toString() }) });

    expect(res.status).toBe(200);
    expect(db.collectionMocks.playerMail.deleteOne).toHaveBeenCalledWith({ _id: mailId });
  });
});
