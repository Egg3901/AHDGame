import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

describe("getBannedCharacterIds", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("returns an empty Set when no users are banned", async () => {
    db.collection("users").find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { getBannedCharacterIds } = await import("./bannedCharacters");
    const result = await getBannedCharacterIds(db as unknown as Db);

    expect(result.size).toBe(0);
    // Skips the second query when there are no banned users.
    expect(db.collection("characters").find).not.toHaveBeenCalled();
  });

  it("returns the set of stringified character IDs across all banned users", async () => {
    const userA = new ObjectId();
    const userB = new ObjectId();
    const charA = new ObjectId();
    const charB1 = new ObjectId();
    const charB2 = new ObjectId();

    db.collection("users").find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([{ _id: userA }, { _id: userB }]),
    });
    db.collection("characters").find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([{ _id: charA }, { _id: charB1 }, { _id: charB2 }]),
    });

    const { getBannedCharacterIds } = await import("./bannedCharacters");
    const result = await getBannedCharacterIds(db as unknown as Db);

    expect(result).toEqual(new Set([charA.toString(), charB1.toString(), charB2.toString()]));
    expect(db.collection("users").find).toHaveBeenCalledWith({ isBanned: true });
    expect(db.collection("characters").find).toHaveBeenCalledWith({
      userId: { $in: [userA, userB] },
    });
  });
});
