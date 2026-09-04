import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { DEFECT_ID, defect } from "./AHD-1271-natcorp-split-sector-type";
import type { HealContext } from "../types";

const ctx: HealContext = { env: "prod", dryRun: true, now: new Date("2026-09-04T12:00:00Z") };

const MISTYPED_ID = new ObjectId();
const CORRECT_ID = new ObjectId();
const MULTI_ID = new ObjectId();
const PRIMARY_ID = new ObjectId();
const NONSENSE_ID = new ObjectId();

interface Corp {
  _id: ObjectId;
  name: string;
  countryOwnerId: string;
  type: string;
  assignedSectorTypes: string[];
  isPrimaryNationalCorporation?: boolean;
}

/**
 * A country's National Corporation set: the sovereign issuer plus split-offs,
 * one of which carries the issuer's financial default it should never have
 * inherited.
 */
function productionIncidentDb(): { db: Db; corps: Corp[] } {
  const corps: Corp[] = [
    {
      _id: MISTYPED_ID,
      name: "German Manufacturing Enterprise",
      countryOwnerId: "DD",
      type: "financial",
      assignedSectorTypes: ["manufacturing"],
    },
    {
      _id: CORRECT_ID,
      name: "East German Energy Enterprise",
      countryOwnerId: "DD",
      type: "energy",
      assignedSectorTypes: ["energy"],
    },
    {
      _id: MULTI_ID,
      name: "Mixed Holdings",
      countryOwnerId: "DD",
      type: "financial",
      assignedSectorTypes: ["retail", "logistics"],
    },
    {
      _id: NONSENSE_ID,
      name: "Unknown Claim",
      countryOwnerId: "DD",
      type: "financial",
      assignedSectorTypes: ["not_a_sector"],
    },
    {
      _id: PRIMARY_ID,
      name: "Germany",
      countryOwnerId: "DD",
      type: "financial",
      assignedSectorTypes: ["financial"],
      isPrimaryNationalCorporation: true,
    },
  ];

  const db = {
    collection: () => ({
      find: (filter: Record<string, unknown>) => ({
        toArray: async () =>
          corps.filter((c) => {
            // Mirrors the query's primary exclusion.
            const excludePrimary = (filter.isPrimaryNationalCorporation as { $ne?: boolean })?.$ne;
            if (excludePrimary === true && c.isPrimaryNationalCorporation === true) return false;
            return true;
          }),
      }),
      updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
        const row = corps.find((c) => String(c._id) === String(filter._id));
        if (!row || row.type !== filter.type) return { modifiedCount: 0 };
        row.type = (update.$set as { type: string }).type;
        return { modifiedCount: 1 };
      },
    }),
  } as unknown as Db;

  return { db, corps };
}

describe(DEFECT_ID, () => {
  it("counts only single-sector split-offs whose type contradicts what they operate", async () => {
    const { db } = productionIncidentDb();
    const result = await defect.detect(db, ctx);

    expect(result.affected).toBe(1);
    expect(result.sample[0]).toMatchObject({
      name: "German Manufacturing Enterprise",
      type: "financial",
      operates: "manufacturing",
    });
  });

  it("never rewrites the primary National Corporation", async () => {
    const { db, corps } = productionIncidentDb();
    const plan = await defect.plan(db, ctx);
    await defect.apply(db, plan, ctx);

    // The sovereign issuer legitimately IS financial; rewriting it would break
    // the issuer lookup.
    expect(plan.touched[0].ids).not.toContain(String(PRIMARY_ID));
    expect(corps.find((c) => c._id === PRIMARY_ID)?.type).toBe("financial");
  });

  it("reports a multi-sector claim rather than guessing which type to write", async () => {
    const { db } = productionIncidentDb();
    const result = await defect.detect(db, ctx);

    expect(result.notes?.join(" ")).toContain("claim several sector types");
    const plan = await defect.plan(db, ctx);
    expect(plan.touched[0].ids).not.toContain(String(MULTI_ID));
  });

  it("ignores a claim that is not a real sector type", async () => {
    const { db } = productionIncidentDb();
    const plan = await defect.plan(db, ctx);
    expect(plan.touched[0].ids).not.toContain(String(NONSENSE_ID));
  });

  it("restates the type, changes no money, and verifies clean", async () => {
    const { db, corps } = productionIncidentDb();
    const plan = await defect.plan(db, ctx);
    expect(plan.moneyDelta).toBe(0);

    const result = await defect.apply(db, plan, ctx);
    expect(result.documentsUpdated).toBe(1);
    expect(corps.find((c) => c._id === MISTYPED_ID)?.type).toBe("manufacturing");
    expect(corps.find((c) => c._id === CORRECT_ID)?.type).toBe("energy");

    const verified = await defect.verify(db, ctx);
    expect(verified.ok).toBe(true);
    expect(verified.remaining).toBe(0);
  });

  it("is a no-op on a second run", async () => {
    const { db } = productionIncidentDb();
    const plan = await defect.plan(db, ctx);
    await defect.apply(db, plan, ctx);
    const again = await defect.apply(db, plan, ctx);

    expect(again.documentsUpdated).toBe(0);
  });
});
