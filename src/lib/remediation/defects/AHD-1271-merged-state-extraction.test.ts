import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { DEFECT_ID, defect } from "./AHD-1271-merged-state-extraction";
import type { HealContext } from "../types";
import { generateCountryOwnedSeedData } from "@/lib/seeds/reference/budgets";
import { CAPITAL_SEED_HEADROOM } from "@/lib/market/capital";

const ctx: HealContext = { env: "sandbox", dryRun: true, now: new Date("2026-09-04T12:00:00Z") };

/** The extraction SOE the heal must reuse rather than recreate. */
const SOE_ID = new ObjectId("700000000000000000001580");
/** A second corp claiming extraction for the same country: contested, so skipped. */
const RIVAL_SOE_ID = new ObjectId("700000000000000000001581");

const CURRENT_TURN = 619;

interface WorldOptions {
  /** Omit the extraction enterprise, so there is nothing to hand the plants to. */
  withoutEnterprise?: boolean;
  /** Two corps claim extraction for DD, so no single owner can be chosen. */
  contestedEnterprise?: boolean;
  /** States that already carry an owned extraction sector. */
  ownedExtractionStates?: string[];
  /** States that already carry an unowned extraction market. */
  unownedExtractionStates?: string[];
  commandEconomyEnabled?: boolean;
  /** State ids whose insert should throw, to exercise partial failure. */
  failInsertsFor?: string[];
  /** Give the owning corp an soe overlay carrying a plan target. */
  planTarget?: number | null;
}

/**
 * A reunified Germany at turn 619: the Laender under DD, the east mining and the
 * west holding deposits with nothing to mine them.
 */
function productionIncidentDb(options: WorldOptions = {}): {
  db: Db;
  inserted: Record<string, unknown>[];
  corpUpdates: { filter: Record<string, unknown>; update: Record<string, unknown> }[];
} {
  const {
    withoutEnterprise = false,
    contestedEnterprise = false,
    ownedExtractionStates = ["SN", "BE"],
    unownedExtractionStates = [],
    commandEconomyEnabled = true,
    failInsertsFor = [],
    planTarget = 1_000_000,
  } = options;

  const west = ["NW", "SL", "NI"];
  const states = [...west, "SN", "BE"].map((id) => ({
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

  const corps = withoutEnterprise
    ? []
    : [
        {
          _id: SOE_ID,
          name: "East German Extraction & Mining Enterprise",
          countryOwnerId: "DD",
          ...(planTarget == null ? {} : { soe: { sector: "extraction", planTarget } }),
        },
        ...(contestedEnterprise
          ? [{ _id: RIVAL_SOE_ID, name: "Rival Mining Combine", countryOwnerId: "DD" }]
          : []),
      ];

  const inserted: Record<string, unknown>[] = [];
  const corpUpdates: { filter: Record<string, unknown>; update: Record<string, unknown> }[] = [];
  const ownedNow = new Set(ownedExtractionStates);

  const cursor = (rows: unknown[]) => {
    const c: Record<string, unknown> = {
      project: () => c,
      sort: () => c,
      toArray: async () => rows,
    };
    return c;
  };

  const db = {
    collection: (name: string) => ({
      findOne: async () => {
        if (name === "gameConfig") return { _id: "default", commandEconomyEnabled };
        if (name === "gameState")
          return {
            _id: "current",
            currentYear: 1964,
            currentTurn: CURRENT_TURN,
            preset: "1953-default",
          };
        return null;
      },
      find: () =>
        cursor(
          name === "states"
            ? states
            : name === "stateResourceCapacity"
              ? capacities
              : name === "corporations"
                ? corps
                : []
        ),
      distinct: async () => {
        if (name === "corporateSectors") return [...ownedNow];
        if (name === "unownedSectors") return unownedExtractionStates;
        return [];
      },
      insertOne: async (doc: Record<string, unknown>) => {
        if (failInsertsFor.includes(doc.stateId as string)) {
          throw new Error(`simulated write failure for ${doc.stateId}`);
        }
        inserted.push(doc);
        ownedNow.add(doc.stateId as string);
        return { insertedId: doc._id };
      },
      updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
        corpUpdates.push({ filter, update });
        // Mirrors the `soe.planTarget must exist` filter the heal writes.
        const target = corps.find((c) => String(c._id) === String(filter._id));
        const hasOverlay = target && "soe" in target;
        return { modifiedCount: hasOverlay ? 1 : 0 };
      },
    }),
  } as unknown as Db;

  return { db, inserted, corpUpdates };
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

  it("names the states and the owning enterprise in the summary the token binds to", async () => {
    // The confirm token hashes the summary, so counts alone would let a token
    // approved for one set of states authorise a different set of equal size.
    const { db } = productionIncidentDb();
    const plan = await defect.plan(db, ctx);

    expect(plan.summary).toContain("NI, NW, SL");
    expect(plan.summary).toContain(String(SOE_ID));
    expect(plan.affected).toBe(3);
    expect(plan.moneyDelta).toBe(0);
  });

  it("snapshots nothing, so a rollback cannot rewind a live enterprise", async () => {
    // `touched` drives a whole-document snapshot that rollback restores with
    // `replaceOne`. Listing the owning corporation would mean a rollback taken a
    // few turns later also rewinds its liquidCapital and every other field, to
    // undo a sector insert. The plan target is one additive number, recoverable
    // from the result notes; a rewound treasury is not.
    const { db } = productionIncidentDb();
    const plan = await defect.plan(db, ctx);

    expect(plan.touched).toEqual([]);
    expect(plan.notes?.join(" ")).toContain("soe.planTarget raised");
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

  it("stamps a zero book anchor and the current turn so no salvage value is created", async () => {
    const { db, inserted } = productionIncidentDb();
    const plan = await defect.plan(db, ctx);
    await defect.apply(db, plan, ctx);

    for (const doc of inserted) {
      // Absent, this falls back to full list price forever, which restructuring
      // salvage and nationalization compensation both pay out against.
      expect(doc.capacityBookAnchor).toBe(0);
      // Absent, the next tick treats the row as a flip turn and lifts capacity
      // away from what the operator approved.
      expect(doc.plantsStartTurn).toBe(CURRENT_TURN);
    }
  });

  it("gives the restored plants the seed headroom their siblings got at the flip", async () => {
    // Stamping `plantsStartTurn` skips the one-time flip adoption, which is
    // where every sibling sector in these states picked up CAPITAL_SEED_HEADROOM.
    // Without applying it here the restored plants would sit ~9% smaller than an
    // identically-endowed neighbour forever, and pinned at full utilisation.
    const { db, inserted } = productionIncidentDb();
    const plan = await defect.plan(db, ctx);
    await defect.apply(db, plan, ctx);

    // The raw seed values, straight from the same builder the heal calls.
    const seedEntry = generateCountryOwnedSeedData(
      inserted.map((d) => ({
        id: d.stateId as string,
        population: 5_000_000,
        gdp: 20_000_000_000,
        countryId: "DD" as const,
      })),
      "1953-default",
      true
    ).find((e) => e.corporation.soe && e.corporation.assignedSectorTypes?.[0] === "extraction");
    expect(seedEntry).toBeDefined();

    for (const doc of inserted) {
      const seeded = seedEntry!.sectors.find((s) => s.stateId === doc.stateId)!;
      expect(seeded.capitalStock).toBeGreaterThan(0);
      expect(doc.capitalStock as number).toBeCloseTo(
        (seeded.capitalStock as number) * CAPITAL_SEED_HEADROOM,
        6
      );
    }
  });

  it("raises the owning enterprise's plan target by what the new plants produce", async () => {
    const { db, inserted, corpUpdates } = productionIncidentDb();
    const plan = await defect.plan(db, ctx);
    const result = await defect.apply(db, plan, ctx);

    expect(corpUpdates).toHaveLength(1);
    const inc = (corpUpdates[0].update as { $inc: Record<string, number> }).$inc;
    const expected = Math.round(inserted.reduce((sum, d) => sum + (d.revenue as number), 0));
    expect(inc["soe.planTarget"]).toBe(expected);
    expect(result.documentsUpdated).toBe(1);
  });

  it("leaves an enterprise with no soe overlay alone rather than inventing a plan", async () => {
    const { db, corpUpdates } = productionIncidentDb({ planTarget: null });
    const plan = await defect.plan(db, ctx);
    const result = await defect.apply(db, plan, ctx);

    expect(corpUpdates).toHaveLength(1);
    expect(result.notes?.join(" ")).toContain("carries no soe.planTarget");
  });

  it("records the ids that landed when a later insert fails", async () => {
    // A single insertMany that throws part-way loses the ids of the rows that
    // DID land, and rollback is then told there is nothing to undo.
    const { db, inserted } = productionIncidentDb({ failInsertsFor: ["SL"] });
    const plan = await defect.plan(db, ctx);
    const result = await defect.apply(db, plan, ctx);

    expect(inserted).toHaveLength(2);
    expect(result.insertedIds?.[0].ids).toHaveLength(2);
    expect(result.notes?.join(" ")).toContain("FAILED");
    // The run is visibly incomplete rather than silently green.
    const verified = await defect.verify(db, ctx);
    expect(verified.ok).toBe(false);
    expect(verified.remaining).toBe(1);
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
    expect(result.notes?.join(" ")).toContain("no single extraction enterprise");

    const plan = await defect.plan(db, ctx);
    await defect.apply(db, plan, ctx);
    expect(inserted).toHaveLength(0);
  });

  it("refuses to pick between two corps claiming the same sector", async () => {
    const { db, inserted } = productionIncidentDb({ contestedEnterprise: true });
    const result = await defect.detect(db, ctx);

    expect(result.affected).toBe(0);
    expect(result.notes?.join(" ")).toContain("no single extraction enterprise");

    const plan = await defect.plan(db, ctx);
    await defect.apply(db, plan, ctx);
    expect(inserted).toHaveLength(0);
  });

  it("does nothing in a world with command economies switched off", async () => {
    const { db } = productionIncidentDb({ commandEconomyEnabled: false });
    const result = await defect.detect(db, ctx);
    expect(result.affected).toBe(0);
  });

  it("is not enabled for prod while the code gate has no pinned commit", async () => {
    // `evaluateCodeGate` passes unconditionally without `requiredCommit`, so
    // listing prod would let an operator heal an env the fix has not reached.
    expect(defect.envs).not.toContain("prod");
    expect(defect.codeFix?.requiredCommit).toBeUndefined();
  });
});
