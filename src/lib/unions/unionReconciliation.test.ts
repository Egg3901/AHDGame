import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { reconcileUnionOwnerCache, reconcileUnionLeaderCache } from "./unionReconciliation";

describe("reconcileUnionOwnerCache", () => {
  it("no-ops when the union is unowned", async () => {
    const updateOne = vi.fn();
    const db = { collection: () => ({ updateOne }) } as unknown as Db;
    await reconcileUnionOwnerCache(db, { _id: new ObjectId(), ownerId: null });
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("no-ops when the owner's cache already matches", async () => {
    const unionId = new ObjectId();
    const ownerId = new ObjectId();
    const findOne = vi.fn().mockResolvedValue({ _id: ownerId, unionLeaderOf: unionId });
    const updateOne = vi.fn();
    const db = { collection: () => ({ findOne, updateOne }) } as unknown as Db;

    await reconcileUnionOwnerCache(db, { _id: unionId, ownerId });
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("corrects a desynced owner cache (owner.unionLeaderOf pointing elsewhere or null)", async () => {
    const unionId = new ObjectId();
    const ownerId = new ObjectId();
    const findOne = vi.fn().mockResolvedValue({ _id: ownerId, unionLeaderOf: null });
    const updateOne = vi.fn().mockResolvedValue({});
    const db = { collection: () => ({ findOne, updateOne }) } as unknown as Db;

    await reconcileUnionOwnerCache(db, { _id: unionId, ownerId });
    expect(updateOne).toHaveBeenCalledTimes(1);
    const [filter, update] = updateOne.mock.calls[0];
    expect(filter).toMatchObject({ _id: ownerId });
    expect(update.$set.unionLeaderOf).toStrictEqual(unionId);
  });
});

describe("reconcileUnionLeaderCache", () => {
  it("no-ops when the character has no cached union", async () => {
    const updateOne = vi.fn();
    const db = { collection: () => ({ updateOne }) } as unknown as Db;
    const result = await reconcileUnionLeaderCache(db, {
      _id: new ObjectId(),
      unionLeaderOf: null,
    });
    expect(updateOne).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("no-ops when the cached union's ownerId already matches", async () => {
    const characterId = new ObjectId();
    const unionId = new ObjectId();
    const findOne = vi.fn().mockResolvedValue({ ownerId: characterId });
    const updateOne = vi.fn();
    const db = { collection: () => ({ findOne, updateOne }) } as unknown as Db;

    const result = await reconcileUnionLeaderCache(db, {
      _id: characterId,
      unionLeaderOf: unionId,
    });
    expect(updateOne).not.toHaveBeenCalled();
    expect(result).toStrictEqual(unionId);
  });

  it("clears the stale cache when the union no longer lists this character as owner (un-sticks a falsely-locked character)", async () => {
    const characterId = new ObjectId();
    const unionId = new ObjectId();
    const findOne = vi.fn().mockResolvedValue({ ownerId: new ObjectId() }); // different owner
    const updateOne = vi.fn().mockResolvedValue({});
    const db = { collection: () => ({ findOne, updateOne }) } as unknown as Db;

    const result = await reconcileUnionLeaderCache(db, {
      _id: characterId,
      unionLeaderOf: unionId,
    });
    expect(updateOne).toHaveBeenCalledTimes(1);
    const [filter, update] = updateOne.mock.calls[0];
    expect(filter).toMatchObject({ _id: characterId });
    expect(update.$set.unionLeaderOf).toBeNull();
    expect(result).toBeNull();
  });

  it("clears the stale cache when the cached union no longer exists at all", async () => {
    const characterId = new ObjectId();
    const unionId = new ObjectId();
    const findOne = vi.fn().mockResolvedValue(null);
    const updateOne = vi.fn().mockResolvedValue({});
    const db = { collection: () => ({ findOne, updateOne }) } as unknown as Db;

    await reconcileUnionLeaderCache(db, { _id: characterId, unionLeaderOf: unionId });
    expect(updateOne).toHaveBeenCalledTimes(1);
  });
});
