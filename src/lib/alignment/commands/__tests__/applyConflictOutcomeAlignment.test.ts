import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { applyConflictOutcomeAlignment } from "../applyConflictOutcomeAlignment";

/** 1953-era row: WEST/EAST vocabulary, already locked to the West. */
const lockedWest = {
  _id: new ObjectId(),
  entityId: "SVN",
  eraKey: "cold-war",
  shares: { WEST: 85, EAST: 5 },
  nonAligned: 10,
  previous: null,
  turn: 90,
};

describe("applyConflictOutcomeAlignment", () => {
  let db: MockDb;

  const seed = (row: unknown = lockedWest) => {
    db = createMockDb();
    db.collection("countryAlignments");
    db.collectionMocks.countryAlignments.findOne.mockResolvedValue(row);
    return db;
  };

  const written = () =>
    (db.collectionMocks.countryAlignments.updateOne.mock.calls[0]?.[1] as {
      $set: { shares: Record<string, number>; nonAligned: number };
    }) ?? null;

  beforeEach(() => vi.clearAllMocks());

  it("moves shares for a LOCKED target", async () => {
    // Deliberate divergence from commitInfluencePlay and computeDrift: that gate
    // stops MONEY moving an already-committed nation. A nation that was just
    // conquered is a different case, and refusing would make the most decisive
    // outcome in the game move nothing.
    const res = await applyConflictOutcomeAlignment(seed() as unknown as Db, {
      entityIds: ["SVN"],
      bloc: "east",
      turn: 100,
      year: 1955,
    });

    expect(res.moved).toBe(1);
    expect(written()!.$set.shares.EAST).toBeGreaterThan(5);
  });

  it("leaves shares + nonAligned summing to 100", async () => {
    await applyConflictOutcomeAlignment(seed() as unknown as Db, {
      entityIds: ["SVN"],
      bloc: "east",
      turn: 100,
      year: 1955,
    });

    const { shares, nonAligned } = written()!.$set;
    const total = Object.values(shares).reduce((a, b) => a + b, 0) + nonAligned;
    expect(total).toBe(100);
  });

  it("respects the per-nation turn cap", async () => {
    await applyConflictOutcomeAlignment(seed() as unknown as Db, {
      entityIds: ["SVN"],
      bloc: "east",
      turn: 100,
      year: 1955,
    });

    // A war is decisive, not unbounded: it moves a country as far as one full turn
    // of the most concentrated influence effort could, and no further.
    expect(written()!.$set.shares.EAST! - 5).toBeLessThanOrEqual(5);
  });

  it("resolves the pole from the LIVE YEAR, not the preset", async () => {
    // Poles are era state, re-keyed at 1991. A preset-derived EAST written into a
    // post-1991 row is either dropped by normalizeShares or clobbers the
    // WASHINGTON/MOSCOW vocabulary the row is actually in.
    const modernRow = {
      ...lockedWest,
      eraKey: "post-cold-war",
      shares: { WASHINGTON: 60, MOSCOW: 20, BEIJING: 10 },
      nonAligned: 10,
    };
    await applyConflictOutcomeAlignment(seed(modernRow) as unknown as Db, {
      entityIds: ["SVN"],
      bloc: "east",
      turn: 100,
      year: 2005,
    });

    const shares = written()!.$set.shares;
    expect(shares.MOSCOW).toBeGreaterThan(20);
    expect(shares.EAST).toBeUndefined();
  });

  it("moves nothing when the row does not exist", async () => {
    const res = await applyConflictOutcomeAlignment(seed(null) as unknown as Db, {
      entityIds: ["SVN"],
      bloc: "east",
      turn: 100,
      year: 1955,
    });

    expect(res.moved).toBe(0);
    expect(db.collectionMocks.countryAlignments.updateOne).not.toHaveBeenCalled();
  });
});
