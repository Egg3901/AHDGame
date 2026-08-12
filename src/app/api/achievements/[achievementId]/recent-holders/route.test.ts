import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("GET /api/achievements/[achievementId]/recent-holders", () => {
  let db: MockDb;

  const achievementId = new ObjectId();
  const characterId = new ObjectId();
  const userId = new ObjectId();

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  function mockCollections(awards: unknown[], users: unknown[], characters: unknown[]) {
    db.collection.mockImplementation((name: string) => {
      const rows =
        name === "characterAchievements" ? awards : name === "users" ? users : characters;
      return {
        find: () => ({
          sort: () => ({ limit: () => ({ toArray: async () => rows }) }),
          toArray: async () => rows,
        }),
      };
    });
  }

  it("resolves a character-scoped award that carries no userId", async () => {
    // 1212 production award docs predate per-user grants: characterId only.
    mockCollections(
      [{ characterId, achievementId, earnedAt: new Date("2026-05-23T23:38:47.185Z") }],
      [],
      [{ _id: characterId, name: "Ada Bell" }]
    );

    const { GET } = await import("./route");
    const res = await GET(new Request("http://t/"), {
      params: Promise.resolve({ achievementId: achievementId.toString() }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      holders: [{ name: "Ada Bell", earnedAt: "2026-05-23T23:38:47.185Z" }],
    });
  });

  it("falls back to the user name, then to a placeholder", async () => {
    mockCollections(
      [
        { userId, achievementId, earnedAt: new Date("2026-06-01T00:00:00.000Z") },
        { achievementId, earnedAt: new Date("2026-06-02T00:00:00.000Z") },
      ],
      [{ _id: userId, username: "ada" }],
      []
    );

    const { GET } = await import("./route");
    const res = await GET(new Request("http://t/"), {
      params: Promise.resolve({ achievementId: achievementId.toString() }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { holders: { name: string }[] };
    expect(body.holders.map((h) => h.name)).toEqual(["ada", "Player"]);
  });

  it("rejects an invalid achievement id", async () => {
    const { GET } = await import("./route");
    const res = await GET(new Request("http://t/"), {
      params: Promise.resolve({ achievementId: "not-an-id" }),
    });
    expect(res.status).toBe(400);
  });
});
