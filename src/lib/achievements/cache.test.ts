import { describe, it, expect, vi, afterEach } from "vitest";
import { ObjectId } from "mongodb";
import {
  getCachedDefinitions,
  setCachedDefinitions,
  invalidateDefinitionsCache,
  getCachedRarity,
  setCachedRarity,
  invalidateRarityCache,
  invalidateAllAchievementCaches,
} from "./cache";

describe("achievements cache", () => {
  afterEach(() => {
    // Clear all caches after each test
    invalidateAllAchievementCaches();
    vi.clearAllMocks();
  });

  describe("getCachedDefinitions / setCachedDefinitions", () => {
    it("returns null for empty cache", () => {
      expect(getCachedDefinitions()).toBeNull();
    });

    it("returns cached definitions after setting", () => {
      const mockAchievements = [
        {
          _id: new ObjectId(),
          slug: "first_win",
          name: "First Win",
          description: "Win your first election",
          icon: "trophy",
          category: "election" as const,
          triggerType: "election_win",
          isHidden: false,
          order: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          _id: new ObjectId(),
          slug: "landslide",
          name: "Landslide",
          description: "Win by 20+ points",
          icon: "landslide",
          category: "election" as const,
          triggerType: "election_margin",
          isHidden: false,
          order: 2,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any;

      setCachedDefinitions(mockAchievements);
      const result = getCachedDefinitions();

      expect(result).toEqual(mockAchievements);
    });

    it("returns null after cache expires", () => {
      vi.useFakeTimers();
      const mockAchievements = [
        {
          _id: new ObjectId(),
          slug: "test",
          name: "Test",
          description: "Test achievement",
          icon: "test",
          category: "special" as const,
          triggerType: "test",
          isHidden: false,
          order: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any;

      setCachedDefinitions(mockAchievements);
      expect(getCachedDefinitions()).toEqual(mockAchievements);

      // Advance time past TTL (5 min)
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);
      expect(getCachedDefinitions()).toBeNull();

      vi.useRealTimers();
    });

    it("returns cached value just before expiry", () => {
      vi.useFakeTimers();
      const mockAchievements = [
        {
          _id: new ObjectId(),
          slug: "test",
          name: "Test",
          description: "Test achievement",
          icon: "test",
          category: "special" as const,
          triggerType: "test",
          isHidden: false,
          order: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any;

      setCachedDefinitions(mockAchievements);

      // Advance time to just before TTL
      vi.advanceTimersByTime(5 * 60 * 1000 - 1);
      expect(getCachedDefinitions()).toEqual(mockAchievements);

      vi.useRealTimers();
    });
  });

  describe("invalidateDefinitionsCache", () => {
    it("clears definitions cache", () => {
      const mockAchievements = [
        {
          _id: new ObjectId(),
          slug: "test",
          name: "Test",
          description: "Test",
          icon: "test",
          category: "special" as const,
          triggerType: "test",
          isHidden: false,
          order: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any;
      setCachedDefinitions(mockAchievements);

      expect(getCachedDefinitions()).toEqual(mockAchievements);

      invalidateDefinitionsCache();
      expect(getCachedDefinitions()).toBeNull();
    });

    it("is safe to call when cache is already empty", () => {
      expect(() => invalidateDefinitionsCache()).not.toThrow();
    });
  });

  describe("getCachedRarity / setCachedRarity", () => {
    it("returns null for empty cache", () => {
      expect(getCachedRarity()).toBeNull();
    });

    it("returns cached rarity map after setting", () => {
      const mockRarity = new Map([
        ["first_win", 45.2],
        ["landslide", 12.8],
      ]);

      setCachedRarity(mockRarity);
      const result = getCachedRarity();

      expect(result).toEqual(mockRarity);
    });

    it("returns null after cache expires", () => {
      vi.useFakeTimers();
      const mockRarity = new Map([["test", 25.0]]);

      setCachedRarity(mockRarity);
      expect(getCachedRarity()).toEqual(mockRarity);

      // Advance time past TTL (2 min)
      vi.advanceTimersByTime(2 * 60 * 1000 + 1);
      expect(getCachedRarity()).toBeNull();

      vi.useRealTimers();
    });

    it("returns cached value just before expiry", () => {
      vi.useFakeTimers();
      const mockRarity = new Map([["test", 25.0]]);

      setCachedRarity(mockRarity);

      // Advance time to just before TTL
      vi.advanceTimersByTime(2 * 60 * 1000 - 1);
      expect(getCachedRarity()).toEqual(mockRarity);

      vi.useRealTimers();
    });
  });

  describe("invalidateRarityCache", () => {
    it("clears rarity cache", () => {
      const mockRarity = new Map([["test", 25.0]]);
      setCachedRarity(mockRarity);

      expect(getCachedRarity()).toEqual(mockRarity);

      invalidateRarityCache();
      expect(getCachedRarity()).toBeNull();
    });

    it("is safe to call when cache is already empty", () => {
      expect(() => invalidateRarityCache()).not.toThrow();
    });
  });

  describe("invalidateAllAchievementCaches", () => {
    it("clears both definitions and rarity caches", () => {
      const mockAchievements = [
        {
          _id: new ObjectId(),
          slug: "test",
          name: "Test",
          description: "Test",
          icon: "test",
          category: "special" as const,
          triggerType: "test",
          isHidden: false,
          order: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any;
      const mockRarity = new Map([["test", 25.0]]);

      setCachedDefinitions(mockAchievements);
      setCachedRarity(mockRarity);

      expect(getCachedDefinitions()).toEqual(mockAchievements);
      expect(getCachedRarity()).toEqual(mockRarity);

      invalidateAllAchievementCaches();

      expect(getCachedDefinitions()).toBeNull();
      expect(getCachedRarity()).toBeNull();
    });
  });
});
