import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { ObjectId } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  getAuthUser: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("@/lib/api/requireAuth", () => ({
  requireBasicAuth: vi.fn(),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn(() => Promise.resolve(false)),
}));
vi.mock("@/lib/achievements/triggers", () => ({
  checkNewsPostAchievements: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/discordWebhooks", () => ({
  sendNewsEvent: vi.fn(() => Promise.resolve(undefined as string | undefined)),
  DISCORD_COLORS: { electionOpen: 1, newsPost: 2 },
}));
vi.mock("@/lib/siteMetadata", () => ({
  getSiteUrl: () => "https://example.com",
}));
vi.mock("@/lib/db/patreonBorders", () => ({
  fetchBordersByUserIds: vi.fn(() => Promise.resolve(new Map())),
}));
vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn(() => Promise.resolve()),
}));

/** Same id string/ObjectId pair for `requireBasicAuth` and `characters.findOne`. */
const testUserId = new ObjectId();

let db: MockDb;

beforeEach(async () => {
  vi.resetModules();
  db = createMockDb();
  db.collection("characters");
  db.collection("newsPosts");
  db.collection("users");
  db.collection("newsReactions");
  db.collection("politicalParties");
  db.collection("userSubscriptions");

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as import("mongodb").Db);

  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId: testUserId.toString() },
  } as never);
});

function minimalCharacter(overrides?: Partial<Record<string, unknown>>) {
  return {
    _id: new ObjectId(),
    userId: testUserId,
    name: "Reporter",
    sequentialId: 1,
    countryId: "US",
    actions: 10,
    cashOnHand: 500_000,
    party: "1",
    ...overrides,
  };
}

describe("POST /api/news", () => {
  it("applies free-article cooldown only to top-level posts (excludes replies)", async () => {
    const char = minimalCharacter();
    db.collectionMocks.characters!.findOne.mockResolvedValue(char);
    db.collectionMocks.newsPosts!.findOne.mockResolvedValue(null);

    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/news", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "Headline body", feedType: "article" }),
      })
    );

    expect(res.status).toBe(200);
    expect(db.collectionMocks.newsPosts!.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        authorId: char._id,
        parentId: { $exists: false },
        isSystem: { $ne: true },
        $or: [{ feedType: "article" }, { feedType: { $exists: false } }],
      }),
      { sort: { createdAt: -1 } }
    );
  });

  it("returns 429 when a recent top-level article exists", async () => {
    const char = minimalCharacter();
    db.collectionMocks.characters!.findOne.mockResolvedValue(char);
    db.collectionMocks.newsPosts!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      createdAt: new Date(),
    });

    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/news", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "Second post too soon", feedType: "article" }),
      })
    );

    expect(res.status).toBe(429);
    expect(db.collectionMocks.newsPosts!.insertOne).not.toHaveBeenCalled();
  });
});

describe("GET /api/news", () => {
  it("returns player-authored title and body text without replacement", async () => {
    const postId = new ObjectId();
    const authorId = new ObjectId();
    const postsCursor = {
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        {
          _id: postId,
          authorId,
          authorName: "Reporter",
          title: "Retail media is stronger than defense right now",
          content:
            "Financial media coverage keeps calling this a retail bounce instead of a defense move.",
          isSystem: false,
          reactions: { agree: 2, disagree: 1 },
          replyCount: 0,
          createdAt: new Date("2026-04-27T12:00:00.000Z"),
        },
      ]),
    };

    db.collectionMocks.newsPosts!.find.mockReturnValue(postsCursor as never);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/news"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.posts).toHaveLength(1);
    expect(json.posts[0].title).toBe("Retail media is stronger than defense right now");
    expect(json.posts[0].content).toBe(
      "Financial media coverage keeps calling this a retail bounce instead of a defense move."
    );
  });
});
