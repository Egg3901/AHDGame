import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { DEFECT_ID, defect } from "./AHD-1271-merged-state-extraction";
import type { HealContext } from "../types";

const ctx: HealContext = { env: "prod", dryRun: true, now: new Date("2026-09-04T12:00:00Z") };

/** The extraction SOE the heal must reuse rather than recreate. */
const SOE_ID = new ObjectId("700000000000000000001580");

interface WorldOptions {
  /** Omit the extraction enterprise, so there is nothing to hand the plants to. */
  withoutEnterprise?: boolean;
  /** States that already carry an owned extraction sector. */
  ownedExtractionStates?: string[];
  /** States that already carry an unowned extraction market. */
  unownedExtractionStates?: string[];
  commandEconomyEnabled?: boolean;
}

/**
 * A reunified Germany at turn 619: sixteen Laender under DD, the eastern five
 * mining and the western ones holding deposits with nothing to mine them.
 */
function productionIncidentDb(options: WorldOptions = {}): {
  db: Db;
  inserted: Record<string, unknown>[];
} {
  const {
    withoutEnterprise = false,
    ownedExtractionStates = ["SN", "BE"],
    unownedExtractionStates = [],
    commandEconomyEnabled = true,
  } = options;

  const west = ["NW", "SL", "NI"];
  const east = ["SN"];
  const states = [...west, ...east, "BE"].map((id) => ({
    _id: id,
    countryId: "DD",
    population: 5_000_000,
    gdp: 20_000_000_000,
  }));

  const capacities = [
    { stateId: "NW", resources: { coal: 181860, iron: 315000 } },
    { stateId: "SL", resources: { coal: 45000, iron: 189000 } },
    { stateId: "NI", resources: { natural_gas: 360000, oil: 45000 } },
    { stateId: "SN", resources: { coal: 1359933 } },
    { stateId: "BE", resources: { timber: 2896 } },
  ];

  const inserted: Record<string, unknown>[] = [];
  const ownedNow = new Set(ownedExtractionStates);

  const db = {
    collection: (name: string) => ({
      findOne: async () => {
        if (name === "gameConfig") return { _id: "default", commandEconomyEnabled };
        if (name === "gameState")
          return { _id: "current", currentYear: 1964, preset: "1953-default" };
        return null;
      },
      find: () => ({
        project: () => ({ toArray: async () => (name === "states" ? states : capacities) }),
        toArray: async () => {
          if (name === "states") return states;
          if (name === "stateResourceCapacity") return capacities;
          if (name === "corporations") {
            return withoutEnterprise
              ? []
              : [
                  {
                    _id: SOE_ID,
                    name: "East German Extraction & Mining Enterprise",
                    countryOwnerId: "DD",
                  },
                ];
          }
          return [];
        },
      }),
      distinct: async () => {
        if (name === "corporateSectors") return [...ownedNow];
        if (name === "unownedSectors") return unownedExtractionStates;
        return [];
      },
      insertMany: async (docs: Record<string, unknown>[]) => {
        inserted.push(...docs);
        const insertedIds: Record<number, ObjectId> = {};
        docs.forEach((doc, i) => {
          insertedIds[i] = doc._id as ObjectId;
          ownedNow.add(doc.stateId as string);
        });
        return { insertedCount: docs.length, insertedIds };
      },
    }),
  } as unknown as Db;

  return { db, inserted };
}

describe(DEFECT_ID, () => {
  it("counts western states holding deposits with no extraction sector", async () => {
    const { db } = productionIncidentDb();
    const result = await defect.detect(db, ctx);

    expect(result.affected).toBe(3);
    expect((result.sample as { stateId: string }[]).map((s) => s.stateId).sort()).toEqual([
      "NI",
      "NW",
      "SL",
    ]);
  });

  it("leaves alone a state that already mines, owned or unowned", async () => {
    const { db } = productionIncidentDb({ unownedExtractionStates: ["NW"] });
    const result = await defect.detect(db, ctx);

    const stateIds = (result.sample as { stateId: string }[]).map((s) => s.stateId);
    expect(stateIds).not.toContain("NW");
    expect(stateIds).not.toContain("SN");
    expect(result.affected).toBe(2);
  });

  it("plans an insert-only, currency-neutral repair", async () => {
    const { db } = productionIncidentDb();
    const plan = await defect.plan(db, ctx);

    expect(plan.affected).toBe(3);
    expect(plan.moneyDelta).toBe(0);
    // Nothing is mutated, so there is nothing to snapshot; rollback reads
    // `insertedIds` off the result instead.
    expect(plan.touched).toEqual([]);
    expect(plan.summary).toContain("3 state(s)");
  });

  it("builds the plants under the existing enterprise, never a new one", async () => {
    const { db, inserted } = productionIncidentDb();
    const plan = await defect.plan(db, ctx);
    const result = await defect.apply(db, plan, ctx);

    expect(result.documentsInserted).toBe(3);
    expect(inserted).toHaveLength(3);
    for (const doc of inserted) {
      expect(String(doc.corporationId)).toBe(String(SOE_ID));
      expect(doc.sectorType).toBe("extraction");
      expect(doc.countryId).toBe("DD");
      expect(doc.revenue).toBeGreaterThan(0);
    }
    expect(inserted.map((d) => d.stateId).sort()).toEqual(["NI", "NW", "SL"]);
    expect(result.insertedIds?.[0].collection).toBe("corporateSectors");
    expect(result.insertedIds?.[0].ids).toHaveLength(3);
  });

  it("is a no-op on a second run and verifies clean", async () => {
    const { db, inserted } = productionIncidentDb();
    const plan = await defect.plan(db, ctx);
    await defect.apply(db, plan, ctx);

    const verified = await defect.verify(db, ctx);
    expect(verified.ok).toBe(true);
    expect(verified.remaining).toBe(0);

    const again = await defect.apply(db, plan, ctx);
    expect(again.documentsInserted ?? 0).toBe(0);
    expect(inserted).toHaveLength(3);
  });

  it("refuses to invent an enterprise for a country that runs none", async () => {
    const { db, inserted } = productionIncidentDb({ withoutEnterprise: true });
    const result = await defect.detect(db, ctx);

    expect(result.affected).toBe(0);
    expect(result.notes?.join(" ")).toContain("runs no extraction enterprise");

    const plan = await defect.plan(db, ctx);
    await defect.apply(db, plan, ctx);
    expect(inserted).toHaveLength(0);
  });

  it("does nothing in a world with command economies switched off", async () => {
    const { db } = productionIncidentDb({ commandEconomyEnabled: false });
    const result = await defect.detect(db, ctx);
    expect(result.affected).toBe(0);
  });
});
