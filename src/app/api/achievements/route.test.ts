import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/achievements", () => ({
  getAllAchievements: vi.fn(),
}));

describe("GET /api/achievements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with empty array when no achievements", async () => {
    const { getAllAchievements } = await import("@/lib/achievements");
    vi.mocked(getAllAchievements).mockResolvedValue([]);

    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual([]);
  });

  it("returns 200 with achievement list", async () => {
    const { getAllAchievements } = await import("@/lib/achievements");
    const { ObjectId } = await import("mongodb");
    vi.mocked(getAllAchievements).mockResolvedValue([
      {
        _id: new ObjectId(),
        slug: "alpha_tester",
        name: "Alpha Tester",
        description: "Joined during alpha",
        icon: "🧪",
        category: "special",
        triggerType: "manual",
        isHidden: false,
        order: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveLength(1);
    expect(json[0].slug).toBe("alpha_tester");
    expect(json[0].name).toBe("Alpha Tester");
  });
});
