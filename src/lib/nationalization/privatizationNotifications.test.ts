import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/notifications", () => ({
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));

function cursor<T>(rows: T[]) {
  return {
    toArray: vi.fn().mockResolvedValue(rows),
    project: vi.fn().mockReturnThis(),
  };
}

describe("notifyCountryResidents", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("characters");
  });

  it("notifies each resident player once, deduping users with multiple characters", async () => {
    const userA = new ObjectId();
    const userB = new ObjectId();
    db.collectionMocks.characters.find.mockReturnValue(
      cursor([
        { userId: userA }, // two characters, same user → one notification
        { userId: userA },
        { userId: userB },
      ])
    );

    const { notifyCountryResidents } = await import("./privatizationNotifications");
    const { createNotifications } = await import("@/lib/notifications");
    await notifyCountryResidents(db as unknown as Db, "CN", {
      type: "corp_privatization_offered",
      title: "T",
      message: "M",
    });

    // Queried only real players in the country.
    expect(db.collectionMocks.characters.find).toHaveBeenCalledWith(
      { countryId: "CN", userId: { $exists: true } },
      expect.objectContaining({ projection: { userId: 1 } })
    );
    // Batched once; two distinct users.
    expect(vi.mocked(createNotifications)).toHaveBeenCalledTimes(1);
    const inputs = vi.mocked(createNotifications).mock.calls[0][0];
    expect(inputs).toHaveLength(2);
    expect(inputs.every((i) => i.type === "corp_privatization_offered")).toBe(true);
    const ids = inputs.map((i) => i.userId.toString()).sort();
    expect(ids).toEqual([userA.toString(), userB.toString()].sort());
  });

  it("no-ops cleanly when the country has no resident players", async () => {
    db.collectionMocks.characters.find.mockReturnValue(cursor([]));
    const { notifyCountryResidents } = await import("./privatizationNotifications");
    const { createNotifications } = await import("@/lib/notifications");
    await notifyCountryResidents(db as unknown as Db, "CN", {
      type: "corp_privatization_offered",
      title: "T",
      message: "M",
    });
    // Helper still calls the batch (which itself no-ops on empty) with an empty array.
    expect(vi.mocked(createNotifications)).toHaveBeenCalledWith([]);
  });

  it("swallows a recipient-lookup failure so it never aborts the caller", async () => {
    db.collectionMocks.characters.find.mockImplementation(() => {
      throw new Error("db down");
    });
    const { notifyCountryResidents } = await import("./privatizationNotifications");
    await expect(
      notifyCountryResidents(db as unknown as Db, "CN", {
        type: "corp_privatization_offered",
        title: "T",
        message: "M",
      })
    ).resolves.toBeUndefined();
  });
});
