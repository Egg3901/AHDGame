import type { Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { migration } from "./2026-08-26-repair-out-of-range-policy-levels";

/** A five-level new-generation ladder: valid indices are 0-4. */
const FIVE_LEVEL = {
  _id: "us.economy.productivity.primary",
  policyOptions: [0, 1, 2, 3, 4].map((i) => ({
    id: `opt_${i}`,
    name: `L${i}`,
    stance: "center",
    effectDirection: 0,
    economic: i,
    social: -i,
  })),
};

function setup(opts: { policies?: unknown[]; orders?: unknown[]; types?: unknown[] }) {
  const db = createMockDb() as unknown as MockDb;
  const mk = (docs: unknown[]) => ({
    project: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(docs),
  });
  db.collection("statePolicies").find.mockReturnValue(mk(opts.policies ?? []));
  db.collection("governorExecutiveOrders").find.mockReturnValue(mk(opts.orders ?? []));
  db.collection("legislationTypes").find.mockReturnValue(mk(opts.types ?? [FIVE_LEVEL]));
  return db;
}

describe("2026-08-26-repair-out-of-range-policy-levels", () => {
  it("clamps a policy row sitting past the end of its ladder", async () => {
    const db = setup({
      policies: [
        { _id: "p1", stateId: "CA", legislationTypeId: FIVE_LEVEL._id, policyOptionIndex: 5 },
      ],
    });

    const result = await migration.execute(db as unknown as Db, { dryRun: false });

    const call = db.collectionMocks.statePolicies.updateOne.mock.calls[0];
    expect(call[0]).toEqual({ _id: "p1" });
    // Clamped to the ladder's top, which is what every reader already coerced
    // it to (enactedLevels clamps to 0-4), so the stored value stops lying.
    expect((call[1] as { $set: { policyOptionIndex: number } }).$set.policyOptionIndex).toBe(4);
    const set = (call[1] as { $set: Record<string, number | string> }).$set;
    expect(set.policyOptionId).toBe("opt_4");
    // The whole option is rewritten, so the axis values stop describing a
    // different level than the index does.
    expect(set.economic).toBe(4);
    expect(set.social).toBe(-4);
    expect(result.documentsUpdated).toBe(1);
  });

  it("leaves an in-range policy row alone", async () => {
    const db = setup({
      policies: [
        { _id: "p1", stateId: "CA", legislationTypeId: FIVE_LEVEL._id, policyOptionIndex: 2 },
      ],
    });

    const result = await migration.execute(db as unknown as Db, { dryRun: false });

    expect(db.collectionMocks.statePolicies.updateOne).not.toHaveBeenCalled();
    expect(result.documentsUpdated).toBe(0);
  });

  it("clamps an order's recorded before/after indices", async () => {
    const db = setup({
      orders: [
        {
          _id: "o1",
          legislationTypeId: FIVE_LEVEL._id,
          policyOptionIndexBefore: 3,
          policyOptionIndexAfter: 5,
          status: "active",
        },
      ],
    });

    await migration.execute(db as unknown as Db, { dryRun: false });

    const call = db.collectionMocks.governorExecutiveOrders.updateOne.mock.calls[0];
    expect(call[0]).toEqual({ _id: "o1" });
    const set = (call[1] as { $set: Record<string, number> }).$set;
    expect(set.policyOptionIndexAfter).toBe(4);
    // before was already in range and must not move — it is the revert target.
    expect(set.policyOptionIndexBefore).toBeUndefined();
  });

  it("ignores types whose ladder length is unknown", async () => {
    const db = setup({
      policies: [
        { _id: "p1", stateId: "CA", legislationTypeId: "unknown.law", policyOptionIndex: 9 },
      ],
      types: [],
    });

    const result = await migration.execute(db as unknown as Db, { dryRun: false });

    expect(db.collectionMocks.statePolicies.updateOne).not.toHaveBeenCalled();
    expect(result.documentsUpdated).toBe(0);
  });

  it("writes nothing on a dry run but still reports what it would fix", async () => {
    const db = setup({
      policies: [
        { _id: "p1", stateId: "CA", legislationTypeId: FIVE_LEVEL._id, policyOptionIndex: 5 },
      ],
    });

    const result = await migration.execute(db as unknown as Db, { dryRun: true });

    expect(db.collectionMocks.statePolicies.updateOne).not.toHaveBeenCalled();
    expect(result.documentsUpdated).toBe(0);
    expect(result.notes?.join(" ")).toMatch(/would repair 1 policy row/i);
  });

  it("is declared idempotent", () => {
    expect(migration.idempotent).toBe(true);
  });
});
