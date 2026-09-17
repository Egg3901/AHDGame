/**
 * Dependency retirement on sovereignty transition (#812).
 *
 * A successful decolonization must atomically retire the source dependency's
 * macro representation when it activates the successor: history preserved,
 * future world-economic and sphere processing excludes the dependency.
 */
import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { macroTickBucket } from "@/lib/world/macro/schedule";
import { loadActiveMacroContributions } from "@/lib/world/macro/contributions";
import { processMacroCountryTurn } from "@/lib/world/macro/macroCountryTurn";
import type { MacroCountryState } from "@/lib/world/macro/types";
import { loadTaggedMacroContributions } from "@/lib/world/spheres/apply";
import { processSphereSponsorTurn } from "@/lib/world/spheres/process";
import { loadGdpUsdMillionsByEntity } from "@/lib/internationalOrganizations/entityGdp";
import {
  GOLD_COAST_ENTITY_ID,
  GHANA_ENTITY_ID,
  GOLD_COAST_TO_GHANA_RULE_ID,
  SOMALIA_TRUST_ENTITY_ID,
  SOMALIA_ENTITY_ID,
  SOMALIA_TRUST_TO_SOMALIA_RULE_ID,
  applySovereigntyTransition,
  evaluateGoldCoastTransition,
  getGhanaMacroCountry,
  runTransition,
} from "./index";

// --- Minimal in-memory Db with real filter semantics ------------------------
// mockDb's vi.fn collections cannot verify filtering; this stub implements
// just the operators the selectors and the applier use: equality (where null
// matches a missing field, as in Mongo), $in, inclusion projections, and
// updateOne/bulkWrite with $set plus upsert.

type Doc = Record<string, unknown>;

function matches(doc: Doc, filter: Doc): boolean {
  for (const [key, expected] of Object.entries(filter)) {
    const actual = doc[key];
    if (expected !== null && typeof expected === "object" && !Array.isArray(expected)) {
      const ops = expected as Doc;
      if ("$in" in ops) {
        const list = (ops.$in ?? []) as unknown[];
        if (!list.some((v) => v === actual)) return false;
        continue;
      }
      return false;
    }
    if (expected === null) {
      if (actual !== null && actual !== undefined) return false;
      continue;
    }
    if (actual !== expected) return false;
  }
  return true;
}

function applyProjection(doc: Doc, projection: Doc | undefined): Doc {
  if (!projection) return { ...doc };
  const include = Object.entries(projection)
    .filter(([, v]) => v === 1 || v === true)
    .map(([k]) => k);
  if (include.length === 0) return { ...doc };
  const out: Doc = {};
  for (const key of include) {
    if (key in doc) out[key] = doc[key];
  }
  if (!("_id" in out) && "_id" in doc) out._id = doc._id;
  return out;
}

interface MemoryCollection {
  docs: Doc[];
  ignoreFindFilters: boolean;
}

function cursorFor(docs: Doc[]) {
  const cursor = {
    toArray: async () => docs,
    sort: () => cursor,
    limit: () => cursor,
    skip: () => cursor,
    project: () => cursor,
    next: async () => docs[0] ?? null,
    async *[Symbol.asyncIterator]() {
      for (const doc of docs) yield doc;
    },
  };
  return cursor;
}

function applyUpdateOp(
  collection: MemoryCollection,
  op: { filter: Doc; update: { $set?: Doc }; upsert?: boolean }
): { matchedCount: number; modifiedCount: number; upsertedCount: number } {
  const target = collection.docs.find((d) => matches(d, op.filter));
  if (target) {
    Object.assign(target, op.update.$set ?? {});
    return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
  }
  if (op.upsert) {
    collection.docs.push({ ...op.filter, ...(op.update.$set ?? {}) });
    return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
  }
  return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
}

function createMemoryDb() {
  const collections = new Map<string, MemoryCollection>();
  const get = (name: string): MemoryCollection => {
    let entry = collections.get(name);
    if (!entry) {
      entry = { docs: [], ignoreFindFilters: false };
      collections.set(name, entry);
    }
    return entry;
  };
  const db = {
    __collections: collections,
    collection: (name: string) => {
      const entry = get(name);
      return {
        find: (filter: Doc = {}, options: { projection?: Doc } = {}) => {
          const docs = (
            entry.ignoreFindFilters ? entry.docs : entry.docs.filter((d) => matches(d, filter))
          ).map((d) => applyProjection(d, options.projection));
          return cursorFor(docs);
        },
        findOne: async (filter: Doc = {}) => entry.docs.find((d) => matches(d, filter)) ?? null,
        updateOne: async (
          filter: Doc,
          update: { $set?: Doc },
          options: { upsert?: boolean } = {}
        ) => applyUpdateOp(entry, { filter, update, upsert: options.upsert }),
        bulkWrite: async (
          ops: { updateOne: { filter: Doc; update: { $set?: Doc }; upsert?: boolean } }[]
        ) => {
          let matchedCount = 0;
          let modifiedCount = 0;
          let upsertedCount = 0;
          for (const op of ops) {
            const result = applyUpdateOp(entry, op.updateOne);
            matchedCount += result.matchedCount;
            modifiedCount += result.modifiedCount;
            upsertedCount += result.upsertedCount;
          }
          return { matchedCount, modifiedCount, upsertedCount, insertedCount: 0, deletedCount: 0 };
        },
        insertMany: async (docs: Doc[]) => {
          entry.docs.push(...docs.map((d) => ({ ...d })));
          return { insertedCount: docs.length };
        },
      };
    },
  };
  return db as unknown as Db & { __collections: Map<string, MemoryCollection> };
}

function macroDocs(db: Db): MacroCountryState[] {
  const entry = (
    db as unknown as { __collections: Map<string, MemoryCollection> }
  ).__collections.get("macroCountries");
  return ((entry?.docs ?? []) as unknown as MacroCountryState[]).map((d) => ({ ...d }));
}

/** A dependency macro representation shaped like a seeded aggregate country. */
function dependencyDoc(
  entityId: string,
  displayName: string,
  turn: number,
  now: Date
): MacroCountryState {
  return {
    ...getGhanaMacroCountry(turn, now),
    _id: entityId,
    entityId,
    displayName,
  } as MacroCountryState;
}

describe("dependency retirement on sovereignty (#812)", () => {
  it("retires Gold Coast while activating Ghana, preserving dependency history", async () => {
    const db = createMemoryDb();
    const seedNow = new Date("1957-03-01T00:00:00.000Z");
    const before = dependencyDoc(GOLD_COAST_ENTITY_ID, "Gold Coast", 10, seedNow);
    (db as unknown as { __collections: Map<string, MemoryCollection> }).__collections.set(
      "macroCountries",
      {
        docs: [{ ...before }],
        ignoreFindFilters: false,
      }
    );

    const now = new Date("1957-03-06T00:00:00.000Z");
    const evaluation = evaluateGoldCoastTransition(1957, 192);
    expect(evaluation.outcome).toBe("sovereignty");
    const application = await applySovereigntyTransition(evaluation, { db, now });
    expect(application.dissolvedEntityId).toBe(GOLD_COAST_ENTITY_ID);

    const docs = macroDocs(db);
    expect(docs).toHaveLength(2);

    const ghana = docs.find((d) => d.entityId === GHANA_ENTITY_ID)!;
    expect(ghana).toBeDefined();
    expect(ghana.retiredAt ?? null).toBeNull();

    const goldCoast = docs.find((d) => d.entityId === GOLD_COAST_ENTITY_ID)!;
    expect(goldCoast.retiredAt).toEqual(now);
    expect(goldCoast.retiredByRuleId).toBe(GOLD_COAST_TO_GHANA_RULE_ID);
    expect(goldCoast.successorEntityId).toBe(GHANA_ENTITY_ID);
    // History preserved: identity, aggregates, and contributions untouched.
    expect(goldCoast._id).toBe(GOLD_COAST_ENTITY_ID);
    expect(goldCoast.displayName).toBe("Gold Coast");
    expect(goldCoast.sectors).toEqual(before.sectors);
    expect(goldCoast.population).toBe(before.population);
    expect(goldCoast.contribution).toEqual(before.contribution);
  });

  it("activates the successor cleanly when the source holds no macro document", async () => {
    const db = createMemoryDb();
    const evaluation = evaluateGoldCoastTransition(1957, 192);
    const application = await applySovereigntyTransition(evaluation, { db });
    expect(application.dissolvedEntityId).toBe(GOLD_COAST_ENTITY_ID);

    const docs = macroDocs(db);
    expect(docs).toHaveLength(1);
    expect(docs[0]!.entityId).toBe(GHANA_ENTITY_ID);
  });

  it("excludes the retired dependency from world-economic and sphere selectors", async () => {
    const db = createMemoryDb();
    const now = new Date("1957-03-06T00:00:00.000Z");
    const seedNow = new Date("1957-03-01T00:00:00.000Z");
    const entry = (
      db as unknown as { __collections: Map<string, MemoryCollection> }
    ).__collections.get("macroCountries") ?? { docs: [] as Doc[], ignoreFindFilters: false };
    entry.docs = [{ ...dependencyDoc(GOLD_COAST_ENTITY_ID, "Gold Coast", 10, seedNow) }];
    (db as unknown as { __collections: Map<string, MemoryCollection> }).__collections.set(
      "macroCountries",
      entry
    );

    const evaluation = evaluateGoldCoastTransition(1957, 192);
    await applySovereigntyTransition(evaluation, { db, now });
    // Legacy document without retirement fields stays active (migration-safe).
    const legacy = {
      ...getGhanaMacroCountry(50, now),
      _id: "LG",
      entityId: "LG",
      displayName: "Legacy",
    };
    expect("retiredAt" in legacy).toBe(false);
    entry.docs.push(legacy as unknown as Doc);

    const contributions = await loadActiveMacroContributions(db);
    expect(contributions.map((c) => c.computedOnTurn).sort((a, b) => a - b)).toEqual([50, 192]);

    const tagged = await loadTaggedMacroContributions(db);
    expect(tagged.map((t) => t.entityId).sort()).toEqual(["GH", "LG"]);

    const gdp = await loadGdpUsdMillionsByEntity(db, ["GC", "GH", "LG"], "1953-default");
    expect(gdp.has("GC")).toBe(false);
    expect(gdp.has("GH")).toBe(true);
    expect(gdp.has("LG")).toBe(true);
  });

  it("skips the retired dependency in the macro tick, even for adapters that ignore filters", async () => {
    const makeDb = (ignoreFindFilters: boolean) => {
      const db = createMemoryDb();
      const now = new Date("1957-03-06T00:00:00.000Z");
      const ghana = {
        ...(getGhanaMacroCountry(1, now) as MacroCountryState),
        lastMacroTickTurn: null,
      };
      const ghanaBucket = macroTickBucket(GHANA_ENTITY_ID);
      const goldCoast = {
        ...dependencyDoc(GOLD_COAST_ENTITY_ID, "Gold Coast", 10, now),
        tickBucket: ghanaBucket,
        retiredAt: now,
        retiredByRuleId: GOLD_COAST_TO_GHANA_RULE_ID,
        successorEntityId: GHANA_ENTITY_ID,
        lastMacroTickTurn: 10,
      };
      const cold: Record<string, unknown> = {
        ...(getGhanaMacroCountry(1, now) as object),
        _id: "LG",
        entityId: "LG",
      };
      const entry = (
        db as unknown as { __collections: Map<string, MemoryCollection> }
      ).__collections.get("macroCountries") ?? { docs: [] as Doc[], ignoreFindFilters: false };
      entry.docs = [ghana as unknown as Doc, goldCoast as unknown as Doc, cold];
      entry.ignoreFindFilters = ignoreFindFilters;
      (db as unknown as { __collections: Map<string, MemoryCollection> }).__collections.set(
        "macroCountries",
        entry
      );
      return { db, turn: ghanaBucket + 1 };
    };

    for (const ignoreFindFilters of [false, true]) {
      const { db, turn } = makeDb(ignoreFindFilters);
      const result = await processMacroCountryTurn(db, turn);
      expect(result.updatedEntityIds).toEqual([GHANA_ENTITY_ID]);
      const docs = macroDocs(db);
      expect(docs.find((d) => d.entityId === GOLD_COAST_ENTITY_ID)!.lastMacroTickTurn).toBe(10);
    }
  });

  it("excludes the retired dependency from sphere sponsor processing", async () => {
    const db = createMemoryDb();
    const now = new Date("1957-03-06T00:00:00.000Z");
    const evaluation = evaluateGoldCoastTransition(1957, 192);
    await applySovereigntyTransition(evaluation, { db, now });

    const result = await processSphereSponsorTurn(db, 193, new Map());
    expect(result.entitiesConsidered).toBe(1);

    const memberships =
      (db as unknown as { __collections: Map<string, MemoryCollection> }).__collections.get(
        "sphereMemberships"
      )?.docs ?? [];
    expect(memberships.map((d) => d._id)).not.toContain(GOLD_COAST_ENTITY_ID);
  });

  it("retires a generic roster source: Somalia Trust Territories to Somalia", async () => {
    const db = createMemoryDb();
    const now = new Date("1960-07-01T00:00:00.000Z");
    const entry = (
      db as unknown as { __collections: Map<string, MemoryCollection> }
    ).__collections.get("macroCountries") ?? { docs: [] as Doc[], ignoreFindFilters: false };
    entry.docs = [
      { ...dependencyDoc(SOMALIA_TRUST_ENTITY_ID, "Somalia Trust Territories", 100, now) },
    ];
    (db as unknown as { __collections: Map<string, MemoryCollection> }).__collections.set(
      "macroCountries",
      entry
    );

    const { evaluation, application } = await runTransition(
      SOMALIA_TRUST_TO_SOMALIA_RULE_ID,
      1960,
      400,
      {},
      { db, now }
    );
    expect(evaluation.outcome).toBe("sovereignty");
    expect(application).not.toBeNull();

    const docs = macroDocs(db);
    expect(docs).toHaveLength(2);
    const source = docs.find((d) => d.entityId === SOMALIA_TRUST_ENTITY_ID)!;
    expect(source.retiredAt).toEqual(now);
    expect(source.retiredByRuleId).toBe(SOMALIA_TRUST_TO_SOMALIA_RULE_ID);
    expect(source.successorEntityId).toBe(SOMALIA_ENTITY_ID);
    const successor = docs.find((d) => d.entityId === SOMALIA_ENTITY_ID)!;
    expect(successor.retiredAt ?? null).toBeNull();

    const tagged = await loadTaggedMacroContributions(db);
    expect(tagged.map((t) => t.entityId)).toEqual([SOMALIA_ENTITY_ID]);
  });

  it("is idempotent: a retry never resurrects or rewrites the retirement", async () => {
    const db = createMemoryDb();
    const seedNow = new Date("1957-03-01T00:00:00.000Z");
    const entry = (
      db as unknown as { __collections: Map<string, MemoryCollection> }
    ).__collections.get("macroCountries") ?? { docs: [] as Doc[], ignoreFindFilters: false };
    entry.docs = [{ ...dependencyDoc(GOLD_COAST_ENTITY_ID, "Gold Coast", 10, seedNow) }];
    (db as unknown as { __collections: Map<string, MemoryCollection> }).__collections.set(
      "macroCountries",
      entry
    );

    const evaluation = evaluateGoldCoastTransition(1957, 192);
    const firstNow = new Date("1957-03-06T00:00:00.000Z");
    await applySovereigntyTransition(evaluation, { db, now: firstNow });
    // Retry after a crash between the write and the applied-rule record.
    const retryNow = new Date("1957-03-07T00:00:00.000Z");
    await applySovereigntyTransition(evaluation, { db, now: retryNow });

    const docs = macroDocs(db);
    expect(docs).toHaveLength(2);
    const goldCoast = docs.find((d) => d.entityId === GOLD_COAST_ENTITY_ID)!;
    expect(goldCoast.retiredAt).toEqual(firstNow);
    expect(goldCoast.retiredByRuleId).toBe(GOLD_COAST_TO_GHANA_RULE_ID);
    expect(goldCoast.successorEntityId).toBe(GHANA_ENTITY_ID);
    const ghana = docs.find((d) => d.entityId === GHANA_ENTITY_ID)!;
    expect(ghana.retiredAt ?? null).toBeNull();

    const contributions = await loadActiveMacroContributions(db);
    expect(contributions).toHaveLength(1);
  });
});
