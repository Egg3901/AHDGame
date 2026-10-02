import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import type { HealContext } from "../types";
import { defect } from "./AHD-1372-merged-party-org";

type Doc = Record<string, any>;

function cursor(rows: Doc[]) {
  const value = {
    project: () => value,
    sort: () => value,
    toArray: async () => rows,
  };
  return value;
}

function incidentDb() {
  const parties: Doc[] = [
    { countryId: "UK", sequentialId: 1, abbreviation: "LAB" },
    { countryId: "UK", sequentialId: 4, abbreviation: "PC", isDefunct: true },
    { countryId: "UK", sequentialId: 6, abbreviation: "LIB", isDefunct: true },
  ];
  let orgRows: Doc[] = [
    {
      _id: "SCO_1",
      countryId: "UK",
      stateId: "SCO",
      partyId: "1",
      organization: 58.5,
      registration: 75,
    },
    {
      _id: "SCO_4",
      countryId: "UK",
      stateId: "SCO",
      partyId: "4",
      organization: 4.6,
      registration: 10,
    },
    {
      _id: "SCO_6",
      countryId: "UK",
      stateId: "SCO",
      partyId: "6",
      organization: 6.4,
      registration: 5,
    },
  ];
  const pools: Doc[] = [
    {
      _id: "UK_SCO",
      countryId: "UK",
      stateId: "SCO",
      independent: 5,
      unregistered: 5,
    },
  ];

  const db = {
    collection(name: string) {
      if (name === "politicalParties") {
        return {
          find(query: Doc) {
            let rows =
              query.isDefunct === true
                ? parties.filter((party) => party.isDefunct === true)
                : query.isDefunct?.$ne === true
                  ? parties.filter((party) => party.isDefunct !== true)
                  : parties;
            if (query.$or) {
              rows = rows.filter((party) =>
                query.$or.some(
                  (pair: Doc) =>
                    pair.countryId === party.countryId && pair.sequentialId === party.sequentialId
                )
              );
            }
            return cursor(rows);
          },
        };
      }
      if (name === "statePartyOrg") {
        return {
          find(query: Doc) {
            if (query._id?.$in) {
              return cursor(orgRows.filter((row) => query._id.$in.includes(row._id)));
            }
            if (query.$or?.[0]?.partyId !== undefined) {
              return cursor(
                orgRows.filter((row) =>
                  query.$or.some(
                    (pair: Doc) => pair.countryId === row.countryId && pair.partyId === row.partyId
                  )
                )
              );
            }
            if (query.$or?.[0]?.stateId !== undefined) {
              return cursor(
                orgRows.filter((row) =>
                  query.$or.some(
                    (pair: Doc) => pair.countryId === row.countryId && pair.stateId === row.stateId
                  )
                )
              );
            }
            return cursor(orgRows);
          },
          async deleteMany(query: Doc) {
            const ids = new Set(query._id.$in);
            const before = orgRows.length;
            orgRows = orgRows.filter((row) => !ids.has(row._id));
            return { deletedCount: before - orgRows.length };
          },
        };
      }
      if (name === "stateRegistrationPool") {
        return {
          find(query: Doc) {
            return cursor(
              pools.filter((pool) =>
                query.$or.some(
                  (pair: Doc) => pair.countryId === pool.countryId && pair.stateId === pool.stateId
                )
              )
            );
          },
          async bulkWrite(ops: Doc[]) {
            let matchedCount = 0;
            let modifiedCount = 0;
            for (const op of ops) {
              const pool = pools.find((row) => row._id === op.updateOne.filter._id);
              if (pool) {
                matchedCount += 1;
                modifiedCount += 1;
                Object.assign(pool, op.updateOne.update.$set);
              }
            }
            return { matchedCount, modifiedCount };
          },
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    },
  };

  return { db: db as unknown as Db, orgRows: () => orgRows, parties, pools };
}

describe("AHD-1372 merged party Org/Reg remediation", () => {
  it("restores unregistered Reg, deletes tombstone rows, and is idempotent", async () => {
    const world = incidentDb();
    const context: HealContext = {
      env: "prod",
      dryRun: true,
      now: new Date("2026-10-02T12:00:00Z"),
    };

    const detected = await defect.detect(world.db, context);
    expect(detected.affected).toBe(2);

    const plan = await defect.plan(world.db, context);
    expect(plan.affected).toBe(2);
    expect(plan.touched).toEqual([
      { collection: "statePartyOrg", ids: ["SCO_4", "SCO_6"] },
      { collection: "stateRegistrationPool", ids: ["UK_SCO"] },
    ]);

    const applied = await defect.apply(world.db, plan, { ...context, dryRun: false });
    expect(applied.documentsUpdated).toBe(1);
    expect(applied.documentsDeleted).toBe(2);
    expect(world.orgRows().map((row) => row._id)).toEqual(["SCO_1"]);
    expect(world.pools[0].unregistered).toBe(20);
    expect((await defect.verify(world.db, context)).ok).toBe(true);

    const rerunPlan = await defect.plan(world.db, context);
    expect(rerunPlan.affected).toBe(0);
    const rerun = await defect.apply(world.db, rerunPlan, { ...context, dryRun: false });
    expect(rerun.documentsUpdated).toBe(0);
    expect(rerun.documentsDeleted).toBe(0);
    expect(world.pools[0].unregistered).toBe(20);
  });

  it("blocks states whose active registration total is already invalid", async () => {
    const world = incidentDb();
    world.pools[0].independent = 30;
    const context: HealContext = {
      env: "prod",
      dryRun: true,
      now: new Date("2026-10-02T12:00:00Z"),
    };

    const plan = await defect.plan(world.db, context);

    expect(plan.affected).toBe(0);
    expect(plan.notes).toContain(
      "UK:SCO has invalid active registration totals (active=75, independent=30)"
    );
    expect(world.orgRows()).toHaveLength(3);
  });

  it("blocks registration-bearing rows when their state pool is missing", async () => {
    const world = incidentDb();
    world.pools.splice(0);
    const context: HealContext = {
      env: "prod",
      dryRun: true,
      now: new Date("2026-10-02T12:00:00Z"),
    };

    const plan = await defect.plan(world.db, context);

    expect(plan.affected).toBe(0);
    expect(plan.notes).toContain("UK:SCO has stale registration but no stateRegistrationPool");
    expect(world.orgRows()).toHaveLength(3);
  });

  it("can remove zero-registration tombstones without a state pool", async () => {
    const world = incidentDb();
    world.orgRows()[1].registration = 0;
    world.orgRows()[2].registration = 0;
    world.pools.splice(0);
    const context: HealContext = {
      env: "prod",
      dryRun: true,
      now: new Date("2026-10-02T12:00:00Z"),
    };
    const plan = await defect.plan(world.db, context);

    expect(plan.affected).toBe(2);
    const applied = await defect.apply(world.db, plan, { ...context, dryRun: false });

    expect(applied.documentsUpdated).toBe(0);
    expect(applied.documentsDeleted).toBe(2);
    expect(world.orgRows().map((row) => row._id)).toEqual(["SCO_1"]);
  });

  it("refuses to delete rows when an approved registration pool no longer matches", async () => {
    const world = incidentDb();
    const context: HealContext = {
      env: "prod",
      dryRun: true,
      now: new Date("2026-10-02T12:00:00Z"),
    };
    const plan = await defect.plan(world.db, context);
    world.pools.splice(0);

    await expect(defect.apply(world.db, plan, { ...context, dryRun: false })).rejects.toThrow(
      "registration pool repair matched 0 of 1 approved row(s)"
    );
    expect(world.orgRows()).toHaveLength(3);
  });

  it("refuses a plan when an approved party is no longer defunct", async () => {
    const world = incidentDb();
    const context: HealContext = {
      env: "prod",
      dryRun: true,
      now: new Date("2026-10-02T12:00:00Z"),
    };
    const plan = await defect.plan(world.db, context);
    world.parties[1].isDefunct = false;

    await expect(defect.apply(world.db, plan, { ...context, dryRun: false })).rejects.toThrow(
      "1 approved row(s) changed identity or no longer belong to a defunct party"
    );
    expect(world.orgRows()).toHaveLength(3);
    expect(world.pools[0].unregistered).toBe(5);
  });
});
