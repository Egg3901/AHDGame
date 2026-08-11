import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("getNextSequentialId", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.resetModules();
    db = createMockDb();
    // Pre-initialize the counters collection mock via lazy accessor
    db.collection("counters");
  });

  it("returns incrementing sequential ID for character", async () => {
    const { getNextSequentialId } = await import("./sequentialId");
    db.collectionMocks.counters.findOneAndUpdate.mockResolvedValue({ seq: 42 });

    const result = await getNextSequentialId(db as any, "character");

    expect(result).toBe(42);
    expect(db.collectionMocks.counters.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: "character" },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: "after" }
    );
  });

  it("returns incrementing sequential ID for npp", async () => {
    const { getNextSequentialId } = await import("./sequentialId");
    db.collectionMocks.counters.findOneAndUpdate.mockResolvedValue({ seq: 17 });

    const result = await getNextSequentialId(db as any, "npp");

    expect(result).toBe(17);
    expect(db.collectionMocks.counters.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: "npp" },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: "after" }
    );
  });

  it("reserves a whole block in one round trip", async () => {
    // 436 of a seed's ~513 counter round trips are NPP ids, one per await.
    // Reserving the block is the same atomic $inc, just by N.
    const { reserveSequentialIds } = await import("./sequentialId");
    db.collectionMocks.counters.findOneAndUpdate.mockResolvedValue({ seq: 130 });

    const ids = await reserveSequentialIds(db as any, "npp", 30);

    expect(ids).toHaveLength(30);
    expect(ids[0]).toBe(101);
    expect(ids[29]).toBe(130);
    expect(db.collectionMocks.counters.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.counters.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: "npp" },
      { $inc: { seq: 30 } },
      { upsert: true, returnDocument: "after" }
    );
  });

  it("hands back a contiguous, strictly increasing block", async () => {
    const { reserveSequentialIds } = await import("./sequentialId");
    db.collectionMocks.counters.findOneAndUpdate.mockResolvedValue({ seq: 5 });

    const ids = await reserveSequentialIds(db as any, "npp", 5);

    expect(ids).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("does not touch the counter when nothing is needed", async () => {
    // A seed pass that skips every already-seeded chamber must stay a true
    // no-op — it may not consume ids for rows it will not create.
    const { reserveSequentialIds } = await import("./sequentialId");

    const ids = await reserveSequentialIds(db as any, "npp", 0);

    expect(ids).toEqual([]);
    expect(db.collectionMocks.counters.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("shares the counter with getNextSequentialId so blocks cannot collide", async () => {
    const { reserveSequentialIds, getNextSequentialId } = await import("./sequentialId");
    db.collectionMocks.counters.findOneAndUpdate.mockResolvedValueOnce({ seq: 10 });
    const block = await reserveSequentialIds(db as any, "npp", 10);
    db.collectionMocks.counters.findOneAndUpdate.mockResolvedValueOnce({ seq: 11 });
    const single = await getNextSequentialId(db as any, "npp");

    expect(block).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(single).toBe(11);
    expect(block).not.toContain(single);
    const calls = db.collectionMocks.counters.findOneAndUpdate.mock.calls;
    expect(calls[0][0]).toEqual({ _id: "npp" });
    expect(calls[1][0]).toEqual({ _id: "npp" });
  });

  it("scopes party reservations per country", async () => {
    const { reserveSequentialIds } = await import("./sequentialId");
    db.collectionMocks.counters.findOneAndUpdate.mockResolvedValue({ seq: 6 });

    await reserveSequentialIds(db as any, "party", 6, "UK");

    expect(db.collectionMocks.counters.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: "party_UK" },
      { $inc: { seq: 6 } },
      { upsert: true, returnDocument: "after" }
    );
  });

  it("throws rather than hand out ids it did not reserve", async () => {
    const { reserveSequentialIds } = await import("./sequentialId");
    // Counter came back lower than the block requested — the reservation did
    // not happen, and handing out ids anyway would collide.
    db.collectionMocks.counters.findOneAndUpdate.mockResolvedValue({ seq: 3 });

    await expect(reserveSequentialIds(db as any, "npp", 10)).rejects.toThrow();
  });

  it("throws if counter update fails", async () => {
    const { getNextSequentialId } = await import("./sequentialId");
    db.collectionMocks.counters.findOneAndUpdate.mockResolvedValue(null);

    await expect(getNextSequentialId(db as any, "character")).rejects.toThrow(
      "Failed to get next sequential ID for character"
    );
  });

  it("should generate coalition sequential IDs scoped by country", async () => {
    const { getNextSequentialId } = await import("./sequentialId");
    db.collectionMocks.counters.findOneAndUpdate.mockResolvedValue({ seq: 1 });

    const result = await getNextSequentialId(db as any, "coalition", "UK");

    expect(result).toBe(1);
    expect(db.collectionMocks.counters.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: "coalition_UK" },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: "after" }
    );
  });
});
