import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { DEFECT_ID, defect } from "./AHD-1271-natcorp-split-sector-type";
import type { HealContext } from "../types";

const ctx: HealContext = { env: "sandbox", dryRun: true, now: new Date("2026-09-04T12:00:00Z") };

const MISTYPED_ID = new ObjectId();
const CORRECT_ID = new ObjectId();
const MULTI_ID = new ObjectId();
const PRIMARY_ID = new ObjectId();
const NONSENSE_ID = new ObjectId();
const RESEARCH_ID = new ObjectId();
const SECONDARY_ID = new ObjectId();
const SWITCHED_ID = new ObjectId();

interface Corp {
  _id: ObjectId;
  name: string;
  countryOwnerId: string;
  type: string;
  assignedSectorTypes: string[];
  isPrimaryNationalCorporation?: boolean;
  unlockedTechNodeIds?: string[];
  techDecadeLane?: Record<string, string>;
  secondaryType?: string;
  typeSwitchTurn?: number;
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
      _id: RESEARCH_ID,
      name: "Researching Enterprise",
      countryOwnerId: "DD",
      type: "financial",
      assignedSectorTypes: ["technology"],
      unlockedTechNodeIds: ["financial-1950s-a"],
    },
    {
      _id: SECONDARY_ID,
      name: "Second Line Enterprise",
      countryOwnerId: "DD",
      type: "financial",
      assignedSectorTypes: ["logistics"],
      secondaryType: "logistics",
    },
    {
      _id: SWITCHED_ID,
      name: "Player Switched Enterprise",
      countryOwnerId: "DD",
      type: "technology",
      assignedSectorTypes: ["media"],
      typeSwitchTurn: 600,
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
        // The apply filter also pins the exact claim array, so a corp whose
        // claim changed between plan and apply must not be rewritten.
        const claim = filter.assignedSectorTypes as string[] | undefined;
        if (claim && JSON.stringify(claim) !== JSON.stringify(row.assignedSectorTypes)) {
          return { modifiedCount: 0 };
        }
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

  it("reports a claim that is not a real sector type rather than dropping it silently", async () => {
    const { db } = productionIncidentDb();
    const result = await defect.detect(db, ctx);

    // Every other exclusion is counted and named for the operator; an
    // unreadable claim is something they should know about even though nothing
    // here can fix it.
    expect(result.notes?.join(" ")).toContain("not a real one");
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

  it("will not void research a CEO paid for", async () => {
    // Sector-lane tech node ids are prefixed by primary type, so moving `type`
    // makes them stop resolving: the unlocks and the R&D behind them vanish.
    // That is a price a player may choose to pay, not one a repair may impose.
    const { db, corps } = productionIncidentDb();
    const result = await defect.detect(db, ctx);

    expect(result.notes?.join(" ")).toContain("hold tech-tree research");
    const plan = await defect.plan(db, ctx);
    expect(plan.touched[0].ids).not.toContain(String(RESEARCH_ID));

    await defect.apply(db, plan, ctx);
    expect(corps.find((c) => c._id === RESEARCH_ID)?.type).toBe("financial");
  });

  it("will not make primary and secondary the same type", async () => {
    // `updateCorporationSettings` rejects that pair, so writing it would leave a
    // corp its own owner cannot edit.
    const { db, corps } = productionIncidentDb();
    const result = await defect.detect(db, ctx);

    expect(result.notes?.join(" ")).toContain("SECONDARY type");
    const plan = await defect.plan(db, ctx);
    expect(plan.touched[0].ids).not.toContain(String(SECONDARY_ID));

    await defect.apply(db, plan, ctx);
    expect(corps.find((c) => c._id === SECONDARY_ID)?.type).toBe("financial");
  });

  it("will not revert a type a CEO deliberately switched to", async () => {
    // `typeSwitchTurn` is stamped only by the settings command, so it means a
    // human chose this and paid the penalty and cooldown for it. Reverting would
    // spend that for nothing and re-open the defect every time they set it back.
    const { db, corps } = productionIncidentDb();
    const result = await defect.detect(db, ctx);

    expect(result.notes?.join(" ")).toContain("set deliberately by a CEO");
    const plan = await defect.plan(db, ctx);
    expect(plan.touched[0].ids).not.toContain(String(SWITCHED_ID));

    await defect.apply(db, plan, ctx);
    expect(corps.find((c) => c._id === SWITCHED_ID)?.type).toBe("technology");
  });

  it("is registered for prod, which is the environment holding the corruption", () => {
    expect(defect.envs).toContain("prod");
  });
});
