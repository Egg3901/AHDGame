import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { cleanupZombieSubsidiaries } from "./turnCleanup";

const controllerId = new ObjectId();

function corp(opts: {
  formalized?: boolean;
  parentPct?: number; // % held by a corporate holder (controllerId)
  floorSetter?: ObjectId | null;
}): Corporation {
  const total = 10_000_000;
  const shareholders = opts.parentPct
    ? [{ corporationId: controllerId, shares: Math.round((opts.parentPct / 100) * total) }]
    : [];
  return {
    _id: new ObjectId(),
    totalShares: total,
    shareholders,
    subsidiaryFormalizedAtTurn: opts.formalized ? 10 : undefined,
    parentDividendFloorPct: opts.floorSetter !== undefined ? 8 : undefined,
    parentDividendFloorSetByCorpId: opts.floorSetter ?? undefined,
  } as any as Corporation;
}

let db: MockDb;
let bulkOps: unknown[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  bulkOps = [];
  db.collection("corporations").bulkWrite = vi.fn().mockImplementation(async (ops: unknown[]) => {
    bulkOps = ops;
    return { modifiedCount: ops.length };
  });
});

describe("cleanupZombieSubsidiaries", () => {
  it("clears marker + floor when nobody controls >50%", async () => {
    const zombie = corp({ formalized: true, parentPct: 30, floorSetter: controllerId });
    const cleared = await cleanupZombieSubsidiaries(db as unknown as Db, [zombie], new Date());
    expect(cleared).toBe(1);

    const unset = (bulkOps[0] as any).updateOne.update.$unset;
    expect(unset).toHaveProperty("subsidiaryFormalizedAtTurn");
    expect(unset).toHaveProperty("parentDividendFloorPct");
    expect(unset).toHaveProperty("parentDividendFloorSetByCorpId");
  });

  it("keeps the marker but clears a stale floor whose setter no longer controls", async () => {
    const staleFloor = corp({
      formalized: true,
      parentPct: 60, // controllerId controls, but floor was set by someone else
      floorSetter: new ObjectId(),
    });
    const cleared = await cleanupZombieSubsidiaries(db as unknown as Db, [staleFloor], new Date());
    expect(cleared).toBe(1);

    const unset = (bulkOps[0] as any).updateOne.update.$unset;
    expect(unset).toHaveProperty("parentDividendFloorPct");
    expect(unset).not.toHaveProperty("subsidiaryFormalizedAtTurn");
  });

  it("leaves a healthy formalized subsidiary untouched", async () => {
    const healthy = corp({ formalized: true, parentPct: 60, floorSetter: controllerId });
    const cleared = await cleanupZombieSubsidiaries(db as unknown as Db, [healthy], new Date());
    expect(cleared).toBe(0);
    expect(db.collection("corporations").bulkWrite).not.toHaveBeenCalled();
  });

  it("skips corps with neither a marker nor a floor", async () => {
    const plain = corp({ parentPct: 60 });
    const cleared = await cleanupZombieSubsidiaries(db as unknown as Db, [plain], new Date());
    expect(cleared).toBe(0);
  });
});
