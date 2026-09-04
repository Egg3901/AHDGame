import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { DEFECT_ID, defect } from "./AHD-1271-pool-country-attribution";
import type { HealContext } from "../types";

const ctx: HealContext = { env: "sandbox", dryRun: true, now: new Date("2026-09-04T12:00:00Z") };

const MISFILED_ID = new ObjectId();
const CORRECT_ID = new ObjectId();
const ORPHAN_ID = new ObjectId();

/**
 * The live shape: a pool row on a Ukrainian state stamped `countryId: "US"` by
 * `buildCapacity`'s old fallback, alongside a correctly filed row and a row on a
 * state that no longer exists.
 */
function productionIncidentDb(): { db: Db; updates: Record<string, unknown>[] } {
  const states = [
    { _id: "UKR_WES", countryId: "UKR" },
    { _id: "CA", countryId: "US" },
  ];
  const pool = [
    { _id: MISFILED_ID, stateId: "UKR_WES", countryId: "US", sectorType: "agriculture" },
    { _id: CORRECT_ID, stateId: "CA", countryId: "US", sectorType: "energy" },
    { _id: ORPHAN_ID, stateId: "BEO", countryId: "DD", sectorType: "media" },
  ];
  const updates: Record<string, unknown>[] = [];

  const db = {
    collection: (name: string) => ({
      find: () => ({
        toArray: async () => (name === "states" ? states : pool),
      }),
      updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
        const row = pool.find((p) => String(p._id) === String(filter._id));
        // The filter pins the stale country, exactly as apply() writes it.
        if (!row || row.countryId !== filter.countryId) return { modifiedCount: 0 };
        updates.push({ filter, update });
        row.countryId = (update.$set as { countryId: string }).countryId;
        return { modifiedCount: 1 };
      },
    }),
  } as unknown as Db;

  return { db, updates };
}

describe(DEFECT_ID, () => {
  it("counts only rows whose country disagrees with their state", async () => {
    const { db } = productionIncidentDb();
    const result = await defect.detect(db, ctx);

    expect(result.affected).toBe(1);
    expect(result.sample[0]).toMatchObject({
      stateId: "UKR_WES",
      filedUnder: "US",
      belongsTo: "UKR",
    });
  });

  it("reports but does not touch a row whose state no longer exists", async () => {
    const { db } = productionIncidentDb();
    const result = await defect.detect(db, ctx);

    expect(result.notes?.join(" ")).toContain("no longer exists");
    const plan = await defect.plan(db, ctx);
    expect(plan.touched[0].ids).toEqual([String(MISFILED_ID)]);
  });

  it("plans a currency-neutral re-key", async () => {
    const { db } = productionIncidentDb();
    const plan = await defect.plan(db, ctx);

    expect(plan.affected).toBe(1);
    expect(plan.moneyDelta).toBe(0);
    expect(plan.notes).toContain("UKR_WES/agriculture: US -> UKR");
  });

  it("re-keys the row onto its state's country and then verifies clean", async () => {
    const { db, updates } = productionIncidentDb();
    const plan = await defect.plan(db, ctx);
    const result = await defect.apply(db, plan, ctx);

    expect(result.documentsUpdated).toBe(1);
    expect(updates).toHaveLength(1);
    expect((updates[0].update as { $set: { countryId: string } }).$set.countryId).toBe("UKR");

    const verified = await defect.verify(db, ctx);
    expect(verified.ok).toBe(true);
    expect(verified.remaining).toBe(0);
  });

  it("is a no-op on a second run", async () => {
    const { db, updates } = productionIncidentDb();
    const plan = await defect.plan(db, ctx);
    await defect.apply(db, plan, ctx);
    const again = await defect.apply(db, plan, ctx);

    expect(again.documentsUpdated).toBe(0);
    expect(updates).toHaveLength(1);
  });

  it("leaves a correctly filed row alone", async () => {
    const { db } = productionIncidentDb();
    const plan = await defect.plan(db, ctx);
    await defect.apply(db, plan, ctx);

    expect(plan.touched[0].ids).not.toContain(String(CORRECT_ID));
  });

  it("is not enabled for prod while the code gate has no pinned commit", () => {
    // `evaluateCodeGate` passes unconditionally without `requiredCommit`, so
    // listing prod would let an operator heal an env the fix has not reached.
    expect(defect.envs).not.toContain("prod");
    expect(defect.codeFix?.requiredCommit).toBeUndefined();
  });
});
