import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { ObjectId } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireModerator", () => ({
  requireModerator: vi.fn(),
}));
vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn(),
}));

let db: MockDb;
beforeEach(async () => {
  vi.resetModules();
  db = createMockDb();
  db.collection("playerMailReports");
  db.collection("playerMail");
  db.collection("characters");
  db.collection("users");
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as import("mongodb").Db);
});

const makeModerator = (userId: ObjectId) => ({
  ok: true,
  user: { userId: userId.toString() },
});

describe("GET /api/admin/mail-reports", () => {
  it("returns 403 for non-moderator", async () => {
    const { requireModerator } = await import("@/lib/api/requireModerator");
    vi.mocked(requireModerator).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    } as never);

    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/admin/mail-reports");
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it("returns paginated reports for moderator", async () => {
    const { requireModerator } = await import("@/lib/api/requireModerator");
    vi.mocked(requireModerator).mockResolvedValue(makeModerator(new ObjectId()) as never);

    const reportId = new ObjectId();
    db.collectionMocks.playerMailReports.aggregate.mockReturnValue({
      toArray: async () => [
        {
          reports: [
            {
              _id: reportId,
              mailId: new ObjectId(),
              reportedByUserId: new ObjectId(),
              status: "pending",
              createdAt: new Date(),
              mail: {
                fromCharacterName: "Sender",
                toCharacterName: "Recipient",
                subject: "Bad message",
                body: "offensive content",
              },
            },
          ],
          totalCount: [{ count: 1 }],
        },
      ],
    });

    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/admin/mail-reports");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.reports).toHaveLength(1);
    expect(data.reports[0].status).toBe("pending");
    expect(data.total).toBe(1);
  });
});

describe("PATCH /api/admin/mail-reports/[id]", () => {
  it("dismisses a report", async () => {
    const modId = new ObjectId();
    const { requireModerator } = await import("@/lib/api/requireModerator");
    vi.mocked(requireModerator).mockResolvedValue(makeModerator(modId) as never);

    const reportId = new ObjectId();
    const mailId = new ObjectId();

    db.collectionMocks.playerMailReports.findOne.mockResolvedValue({
      _id: reportId,
      mailId,
      status: "pending",
    });
    db.collectionMocks.playerMailReports.updateOne.mockResolvedValue({ modifiedCount: 1 });

    const { PATCH } = await import("./[id]/route");
    const req = new Request(`http://localhost/api/admin/mail-reports/${reportId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "dismiss", adminNote: "Not a violation" }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: reportId.toString() }) });

    expect(res.status).toBe(200);
    expect(db.collectionMocks.playerMailReports.updateOne).toHaveBeenCalledWith(
      { _id: reportId },
      expect.objectContaining({ $set: expect.objectContaining({ status: "dismissed" }) })
    );
  });

  it("warns the sender", async () => {
    const modId = new ObjectId();
    const { requireModerator } = await import("@/lib/api/requireModerator");
    vi.mocked(requireModerator).mockResolvedValue(makeModerator(modId) as never);

    const reportId = new ObjectId();
    const mailId = new ObjectId();
    const fromCharId = new ObjectId();
    const senderUserId = new ObjectId();

    db.collectionMocks.playerMailReports.findOne.mockResolvedValue({
      _id: reportId,
      mailId,
      status: "pending",
    });
    db.collectionMocks.playerMail.findOne.mockResolvedValue({
      _id: mailId,
      fromCharacterId: fromCharId,
    });
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: fromCharId,
      userId: senderUserId,
    });
    db.collectionMocks.playerMailReports.updateOne.mockResolvedValue({ modifiedCount: 1 });

    const { createNotification } = await import("@/lib/notifications");

    const { PATCH } = await import("./[id]/route");
    const req = new Request(`http://localhost/api/admin/mail-reports/${reportId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "warn" }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: reportId.toString() }) });

    expect(res.status).toBe(200);
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: senderUserId, type: "system" })
    );
  });

  it("returns 404 for non-existent report", async () => {
    const { requireModerator } = await import("@/lib/api/requireModerator");
    vi.mocked(requireModerator).mockResolvedValue(makeModerator(new ObjectId()) as never);

    db.collectionMocks.playerMailReports.findOne.mockResolvedValue(null);

    const { PATCH } = await import("./[id]/route");
    const req = new Request("http://localhost/api/admin/mail-reports/000000000000000000000001", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "dismiss" }),
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ id: "000000000000000000000001" }),
    });

    expect(res.status).toBe(404);
  });
});
