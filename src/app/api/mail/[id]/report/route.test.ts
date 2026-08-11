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
  // Pre-initialize collections
  db.collection("playerMail");
  db.collection("playerMailReports");
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as import("mongodb").Db);
});

describe("POST /api/mail/[id]/report", () => {
  it("creates report for recipient", async () => {
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
      toUserId: userId,
      deletedByRecipient: false,
    });
    db.collectionMocks.playerMailReports.findOne.mockResolvedValue(null);
    db.collectionMocks.playerMailReports.insertOne.mockResolvedValue({
      insertedId: new ObjectId(),
    });

    const { POST } = await import("./route");
    const req = new Request(`http://localhost/api/mail/${mailId}/report`, { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: mailId.toString() }) });

    expect(res.status).toBe(200);
    expect(db.collectionMocks.playerMailReports.insertOne).toHaveBeenCalled();
  });

  it("returns 409 when mail already reported", async () => {
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
      toUserId: userId,
      deletedByRecipient: false,
    });
    db.collectionMocks.playerMailReports.findOne.mockResolvedValue({ _id: new ObjectId() });

    const { POST } = await import("./route");
    const req = new Request(`http://localhost/api/mail/${mailId}/report`, { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: mailId.toString() }) });

    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toBe("Already reported");
  });

  it("returns 403 when user is not the recipient", async () => {
    const userId = new ObjectId();
    const charId = new ObjectId();
    const mailId = new ObjectId();

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString(), character: { _id: charId } },
    } as never);

    db.collectionMocks.playerMail.findOne.mockResolvedValue(null);

    const { POST } = await import("./route");
    const req = new Request(`http://localhost/api/mail/${mailId}/report`, { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: mailId.toString() }) });

    expect(res.status).toBe(403);
  });
});
