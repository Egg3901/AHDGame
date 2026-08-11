import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

describe("achievements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("awardAchievement", () => {
    it("returns false when achievement not found", async () => {
      const { getDb } = await import("@/lib/mongodb");
      vi.mocked(getDb).mockResolvedValue({
        collection: vi.fn().mockReturnValue({
          findOne: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null),
          insertOne: vi.fn(),
        }),
      } as unknown as Awaited<ReturnType<typeof import("@/lib/mongodb").getDb>>);

      const { awardAchievement } = await import("./achievements");
      const result = await awardAchievement(new ObjectId(), "nonexistent_slug");
      expect(result).toBe(false);
    });

    it("returns false when account already has achievement (idempotent)", async () => {
      const achievement = { _id: new ObjectId(), slug: "alpha_tester", name: "Alpha Tester" };
      const { getDb } = await import("@/lib/mongodb");
      vi.mocked(getDb).mockResolvedValue({
        collection: vi.fn().mockImplementation((name: string) => {
          if (name === "achievements") {
            return { findOne: vi.fn().mockResolvedValue(achievement) };
          }
          if (name === "characterAchievements") {
            return {
              findOne: vi.fn().mockResolvedValue({ _id: new ObjectId() }),
              insertOne: vi.fn(),
            };
          }
          return {};
        }),
      } as unknown as Awaited<ReturnType<typeof import("@/lib/mongodb").getDb>>);

      const { awardAchievement } = await import("./achievements");
      const result = await awardAchievement(new ObjectId(), "alpha_tester");
      expect(result).toBe(false);
    });

    it("returns true and inserts when account does not have achievement", async () => {
      const achievement = { _id: new ObjectId(), slug: "alpha_tester", name: "Alpha Tester" };
      const insertOne = vi.fn().mockResolvedValue({ insertedId: new ObjectId() });
      const { getDb } = await import("@/lib/mongodb");
      vi.mocked(getDb).mockResolvedValue({
        collection: vi.fn().mockImplementation((name: string) => {
          if (name === "achievements") {
            return { findOne: vi.fn().mockResolvedValue(achievement) };
          }
          if (name === "characterAchievements") {
            return {
              findOne: vi.fn().mockResolvedValue(null),
              insertOne,
            };
          }
          return {};
        }),
      } as unknown as Awaited<ReturnType<typeof import("@/lib/mongodb").getDb>>);

      const { awardAchievement } = await import("./achievements");
      const result = await awardAchievement(new ObjectId(), "alpha_tester");
      expect(result).toBe(true);
      expect(insertOne).toHaveBeenCalledTimes(1);
    });

    it("awarding completionist itself stops before the completion check recurses", async () => {
      const achievement = { _id: new ObjectId(), slug: "completionist", name: "Completionist" };
      const findOne = vi.fn().mockResolvedValue(null);
      const insertOne = vi.fn().mockResolvedValue({ insertedId: new ObjectId() });
      const { getDb } = await import("@/lib/mongodb");
      vi.mocked(getDb).mockResolvedValue({
        collection: vi.fn().mockImplementation((name: string) => {
          if (name === "achievements") {
            return { findOne: vi.fn().mockResolvedValue(achievement) };
          }
          if (name === "characterAchievements") return { findOne, insertOne };
          return {};
        }),
      } as unknown as Awaited<ReturnType<typeof import("@/lib/mongodb").getDb>>);

      const { awardAchievement } = await import("./achievements");
      await expect(awardAchievement(new ObjectId(), "completionist")).resolves.toBe(true);
      expect(findOne).toHaveBeenCalledTimes(1);
      expect(insertOne).toHaveBeenCalledTimes(1);
    });
  });

  describe("revokeAchievement", () => {
    it("returns false when achievement not found", async () => {
      const { getDb } = await import("@/lib/mongodb");
      vi.mocked(getDb).mockResolvedValue({
        collection: vi.fn().mockReturnValue({
          findOne: vi.fn().mockResolvedValue(null),
          deleteOne: vi.fn(),
        }),
      } as unknown as Awaited<ReturnType<typeof import("@/lib/mongodb").getDb>>);

      const { revokeAchievement } = await import("./achievements");
      const result = await revokeAchievement(new ObjectId(), "nonexistent");
      expect(result).toBe(false);
    });

    it("returns false when account does not have achievement", async () => {
      const achievement = { _id: new ObjectId(), slug: "alpha_tester" };
      const deleteOne = vi.fn().mockResolvedValue({ deletedCount: 0 });
      const { getDb } = await import("@/lib/mongodb");
      vi.mocked(getDb).mockResolvedValue({
        collection: vi.fn().mockImplementation((name: string) => {
          if (name === "achievements") return { findOne: vi.fn().mockResolvedValue(achievement) };
          if (name === "characterAchievements") return { deleteOne };
          return {};
        }),
      } as unknown as Awaited<ReturnType<typeof import("@/lib/mongodb").getDb>>);

      const { revokeAchievement } = await import("./achievements");
      const result = await revokeAchievement(new ObjectId(), "alpha_tester");
      expect(result).toBe(false);
    });

    it("returns true when achievement revoked", async () => {
      const achievement = { _id: new ObjectId(), slug: "alpha_tester" };
      const deleteOne = vi.fn().mockResolvedValue({ deletedCount: 1 });
      const { getDb } = await import("@/lib/mongodb");
      vi.mocked(getDb).mockResolvedValue({
        collection: vi.fn().mockImplementation((name: string) => {
          if (name === "achievements") return { findOne: vi.fn().mockResolvedValue(achievement) };
          if (name === "characterAchievements") return { deleteOne };
          return {};
        }),
      } as unknown as Awaited<ReturnType<typeof import("@/lib/mongodb").getDb>>);

      const { revokeAchievement } = await import("./achievements");
      const result = await revokeAchievement(new ObjectId(), "alpha_tester");
      expect(result).toBe(true);
      expect(deleteOne).toHaveBeenCalledTimes(1);
    });
  });
});
