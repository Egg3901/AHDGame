/**
 * Integration tests for GET /api/admin/achievements.
 * Verifies admin auth guard, 401 response for non-admins, and basic shape
 * on success.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/achievements", () => ({ getAllAchievements: vi.fn() }));
vi.mock("@/lib/achievements/cache", () => ({
  invalidateDefinitionsCache: vi.fn(),
}));

describe("GET /api/admin/achievements", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("returns 401 when user is not an admin", async () => {
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    } as never);

    const { GET } = await import("./route");
    const res = await GET();

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBeDefined();
  });

  it("returns 200 with achievement list for admin users", async () => {
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({ ok: true } as never);

    const { getAllAchievements } = await import("@/lib/achievements");
    vi.mocked(getAllAchievements).mockResolvedValue([
      {
        _id: "ach1" as never,
        slug: "first_vote",
        name: "First Vote",
        description: "Cast your first vote",
        icon: "Vote",
        category: "election",
        triggerType: "action",
        order: 1,
      },
    ] as never);

    // characterAchievements aggregate returns empty
    db.collection("characterAchievements");
    db.collectionMocks["characterAchievements"].aggregate = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { GET } = await import("./route");
    const res = await GET();

    expect(res.status).toBe(200);
    const json = await res.json();
    const achievements = json.achievements;
    expect(Array.isArray(achievements)).toBe(true);
    expect(achievements.length).toBe(1);
    expect(achievements[0].slug).toBe("first_vote");
    expect(achievements[0].earnedCount).toBe(0);
  });
});
