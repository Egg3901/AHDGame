import { ObjectId, type Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { awardAchievement } from "@/lib/achievements";
import { createNotification } from "@/lib/notifications";
import {
  applyPatreonStatus,
  clearExpiredPatreonBenefits,
  startPatreonGracePeriod,
} from "./service";

vi.mock("@/lib/achievements", () => ({ awardAchievement: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));

describe("reconciliation supporter write guard", () => {
  beforeEach(() => vi.clearAllMocks());

  const snapshot = {
    supporterProvider: "patreon" as const,
    patreonUserId: "linked-patron",
    patreonTier: "supporter" as const,
    patreonExpiresAt: new Date("2000-01-01T00:00:00Z"),
  };
  const operations = [
    {
      name: "grant",
      run: (db: Db, userId: ObjectId) =>
        applyPatreonStatus(db, { userId, tier: "supporter-plus" }, snapshot),
    },
    {
      name: "grace",
      run: (db: Db, userId: ObjectId) => startPatreonGracePeriod(db, userId, new Date(), snapshot),
    },
    {
      name: "expiry",
      run: (db: Db, userId: ObjectId) => clearExpiredPatreonBenefits(db, userId, snapshot),
    },
  ];

  it.each(operations)("rejects a stale $name without benefit notifications", async ({ run }) => {
    const db = createMockDb();
    const userId = new ObjectId();
    const users = db.collection("users");
    users.findOne.mockResolvedValue({ _id: userId, ...snapshot });
    users.updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });

    await expect(run(db as unknown as Db, userId)).rejects.toThrow(
      "Supporter status changed during Patreon reconciliation"
    );
    expect(users.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: userId, ...snapshot }),
      expect.any(Object)
    );
    expect(awardAchievement).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });

  it.each(operations)(
    "applies $name while the provider snapshot still matches",
    async ({ run }) => {
      const db = createMockDb();
      const userId = new ObjectId();
      const users = db.collection("users");
      users.findOne.mockResolvedValue({ _id: userId, ...snapshot });

      await run(db as unknown as Db, userId);

      expect(users.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ _id: userId, ...snapshot }),
        expect.any(Object)
      );
    }
  );
});
