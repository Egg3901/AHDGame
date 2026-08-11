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

describe("GET /api/mail/sent", () => {
  it("returns sent mails for authenticated character", async () => {
    const userId = new ObjectId();
    const charId = new ObjectId();
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: userId.toString(),
        character: { _id: charId, name: "Test", sequentialId: 1 },
      },
    } as never);

    const mailId = new ObjectId();
    db.collectionMocks.playerMail.aggregate.mockReturnValue({
      toArray: async () => [
        {
          mails: [
            {
              _id: mailId,
              fromCharacterId: charId,
              fromCharacterName: "Test",
              fromCharacterSequentialId: 1,
              toUserId: new ObjectId(),
              toCharacterId: new ObjectId(),
              toCharacterName: "Recipient",
              toCharacterSequentialId: 5,
              subject: "Sent mail",
              body: "Body",
              read: true,
              deletedByRecipient: false,
              deletedBySender: false,
              createdAt: new Date(),
            },
          ],
          totalCount: [{ count: 1 }],
        },
      ],
    });

    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/mail/sent");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.mails).toHaveLength(1);
    expect(data.mails[0].subject).toBe("Sent mail");
    expect(data.total).toBe(1);
    expect(data.hasMore).toBe(false);
  });
});
