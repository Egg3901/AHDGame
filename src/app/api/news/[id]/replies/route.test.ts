import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/db/patreonBorders", () => ({
  fetchBordersByUserIds: vi.fn(() => Promise.resolve(new Map())),
}));

let db: MockDb;

beforeEach(async () => {
  vi.resetModules();
  db = createMockDb();
  db.collection("newsPosts");
  db.collection("characters");

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as import("mongodb").Db);
});

describe("GET /api/news/[id]/replies", () => {
  it("returns reply text without slug replacement", async () => {
    const parentId = new ObjectId();
    const authorId = new ObjectId();
    const repliesCursor = {
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        {
          _id: new ObjectId(),
          parentId,
          authorId,
          authorName: "Reply Author",
          content: "Retail media beat defense again.",
          reactions: { agree: 1, disagree: 0 },
          createdAt: new Date("2026-04-27T12:05:00.000Z"),
        },
      ]),
    };

    db.collectionMocks.newsPosts!.find.mockReturnValue(repliesCursor as never);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/news/123/replies"), {
      params: Promise.resolve({ id: parentId.toString() }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.replies).toHaveLength(1);
    expect(json.replies[0].content).toBe("Retail media beat defense again.");
  });
});
