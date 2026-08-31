import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { regionalDefaultLaws } from "@/lib/politicalLegislation/regionalDefaults";
import { migration } from "./2026-08-31-heal-phantom-regional-order-levels";

const LAW = regionalDefaultLaws("RU")[0]!;
const OTHER_LAW = regionalDefaultLaws("RU")[1]!;

const PHANTOM_ORDER = new ObjectId();
const REAL_ORDER = new ObjectId();

/** A row an expired order reverted to a level the region never legislated. */
function phantomRow(overrides: Record<string, unknown> = {}) {
  return {
    scope: "state",
    stateId: "MOW",
    legislationTypeId: LAW.id,
    policyOptionIndex: 3,
    policyOptionId: "l3",
    enactedBy: { kind: "expiry", id: PHANTOM_ORDER },
    ...overrides,
  };
}

describe("2026-08-31-heal-phantom-regional-order-levels", () => {
  let db: MockDb;

  function setup(rows: Record<string, unknown>[], orders: Record<string, unknown>[]) {
    db = createMockDb();
    db.collection("statePolicies").find.mockReturnValue({
      project: () => ({ toArray: async () => rows }),
      toArray: async () => rows,
    });
    db.collection("governorExecutiveOrders").find.mockReturnValue({
      project: () => ({ toArray: async () => orders }),
      toArray: async () => orders,
    });
    db.collection("statePolicies").bulkWrite.mockResolvedValue({ modifiedCount: rows.length });
    return db;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is registered as idempotent", () => {
    expect(migration.idempotent).toBe(true);
    expect(migration.id).toBe("2026-08-31-heal-phantom-regional-order-levels");
  });

  it("heals a row an order with NO policyOptionIdBefore reverted above level 0", async () => {
    // No policyOptionIdBefore is the exact fingerprint: issueOrder only omits it
    // when the region had no prior statePolicies row, which is when `before`
    // fell through to the ladder centre instead of the region's real level 0.
    setup([phantomRow()], [{ _id: PHANTOM_ORDER }]);

    const result = await migration.execute(db as unknown as Db, { dryRun: false });

    const ops = db.collectionMocks["statePolicies"]!.bulkWrite.mock.calls[0]![0] as Array<{
      updateOne: {
        filter: Record<string, unknown>;
        update: { $set: Record<string, unknown>; $unset: Record<string, unknown> };
      };
    }>;
    expect(ops).toHaveLength(1);
    expect(ops[0].updateOne.update.$set.policyOptionIndex).toBe(0);
    expect(ops[0].updateOne.update.$set.policyOptionId).toBe("l0");
    // The row becomes an ordinary regional default: nobody enacted it.
    expect(ops[0].updateOne.update.$unset).toHaveProperty("enactedBy");
    expect(result.documentsUpdated).toBe(1);
  });

  it("leaves a row alone when the order recorded a real prior option", async () => {
    // The region DID have a row before that order, so the revert target is real.
    setup(
      [phantomRow({ enactedBy: { kind: "expiry", id: REAL_ORDER } })],
      [{ _id: REAL_ORDER, policyOptionIdBefore: "l2" }]
    );

    const result = await migration.execute(db as unknown as Db, { dryRun: false });

    expect(db.collectionMocks["statePolicies"]!.bulkWrite).not.toHaveBeenCalled();
    expect(result.documentsUpdated).toBe(0);
  });

  /**
   * Bill rows, active-order rows and rows already at the default are excluded by
   * the QUERY, not by code, so that is what this asserts. A row-shaped test here
   * would only prove the mock returns what it was handed.
   */
  it("queries only expiry-reverted rows above the region default, scoped to `both` laws", async () => {
    setup([], []);

    await migration.execute(db as unknown as Db, { dryRun: false });

    const filter = db.collectionMocks["statePolicies"]!.find.mock.calls[0]![0] as {
      scope: string;
      "enactedBy.kind": string;
      policyOptionIndex: { $gt: number };
      legislationTypeId: { $in: string[] };
    };
    expect(filter.scope).toBe("state");
    // Excludes `bill` (a real enactment) and `order` (a live effect being paid for).
    expect(filter["enactedBy.kind"]).toBe("expiry");
    // Excludes rows already sitting at the region default.
    expect(filter.policyOptionIndex).toEqual({ $gt: 0 });
    expect(filter.legislationTypeId.$in).toContain(LAW.id);
    expect(filter.legislationTypeId.$in).toContain(OTHER_LAW.id);
    // Never a national row, and never a legacy-catalog law.
    expect(filter.legislationTypeId.$in).not.toContain("us_state_transportation");
  });

  it("writes nothing on a dry run but reports the count", async () => {
    setup([phantomRow()], [{ _id: PHANTOM_ORDER }]);

    const result = await migration.execute(db as unknown as Db, { dryRun: true });

    expect(db.collectionMocks["statePolicies"]!.bulkWrite).not.toHaveBeenCalled();
    expect(result.documentsScanned).toBe(1);
    expect(result.notes?.join(" ")).toContain("dry run");
  });

  it("re-running after a heal is a no-op", async () => {
    setup([], []);

    const result = await migration.execute(db as unknown as Db, { dryRun: false });

    expect(db.collectionMocks["statePolicies"]!.bulkWrite).not.toHaveBeenCalled();
    expect(result.documentsUpdated).toBe(0);
    expect(result.notes?.join(" ")).toContain("nothing to heal");
  });
});
