import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import {
  BALANCE_CHECKPOINTS_COLLECTION,
  BALANCE_SNAPSHOTS_COLLECTION,
  writeBalanceSnapshot,
  writePreForexBalanceCheckpoint,
} from "../balanceSnapshot";

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException }));

describe("balance snapshot replay", () => {
  beforeEach(() => captureException.mockClear());

  it.each([
    ["closing snapshots", BALANCE_SNAPSHOTS_COLLECTION, writeBalanceSnapshot],
    ["pre-Forex checkpoints", BALANCE_CHECKPOINTS_COLLECTION, writePreForexBalanceCheckpoint],
  ] as const)(
    "replays %s while preserving its stored _id",
    async (_label, collectionName, write) => {
      const memory = createInMemoryDb();
      const db = memory as unknown as Db;
      const originalId = new ObjectId();
      const originalCreatedAt = new Date("2026-10-06T00:00:00.000Z");
      memory.seed(collectionName, [
        {
          _id: originalId,
          turn: 7,
          createdAt: originalCreatedAt,
          balances: { "character:x:USD": 1 },
        },
      ]);

      // The in-memory driver's replaceOne intentionally keeps _id, while Mongo
      // rejects an explicit replacement with a different _id. Model that server
      // invariant so this test catches the production replay failure.
      const collection = db.collection(collectionName);
      vi.spyOn(collection, "replaceOne").mockRejectedValue(
        new Error("After applying the update, the immutable field '_id' was altered")
      );

      await write(db, 7);

      const stored = await collection.findOne({ turn: 7 });
      expect(stored?._id).toEqual(originalId);
      expect(stored?.createdAt).not.toEqual(originalCreatedAt);
      expect(captureException).not.toHaveBeenCalled();
    }
  );
});
