import { ObjectId, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { MEDIA_OPERATING_MODELS } from "@/lib/products/types";
import { capacityRescaleRatio } from "@/lib/constants/capacityEconomy";
import {
  consolidateMediaEntertainment,
  migration,
} from "./2026-09-21-media-entertainment-persisted-consolidation";

// ─── Minimal in-memory Db stub ─────────────────────────────────────────────
// Supports exactly the surface the migration uses: find/findOne with
// $or/$in/$exists/dot-path (array-traversing) matching, updateOne/updateMany
// with $set/$setOnInsert (+upsert), deleteOne/deleteMany, insertOne,
// countDocuments. No pipelines, no transactions, mirroring the migration's
// standalone-safe operation set.

type Doc = Record<string, unknown>;

const isObjectId = (value: unknown): value is ObjectId => value instanceof ObjectId;

function valuesEqual(a: unknown, b: unknown): boolean {
  if (isObjectId(a) && isObjectId(b)) return a.equals(b);
  if (isObjectId(a) || isObjectId(b)) {
    try {
      return new ObjectId(a as never).equals(new ObjectId(b as never));
    } catch {
      return false;
    }
  }
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

function resolvePath(doc: unknown, path: string): unknown[] {
  const [head, ...rest] = path.split(".");
  if (head === undefined) return [];
  if (doc === null || typeof doc !== "object") return [];
  const value = (doc as Doc)[head];
  if (rest.length === 0) return [value];
  if (Array.isArray(value)) return value.flatMap((entry) => resolvePath(entry, rest.join(".")));
  return resolvePath(value, rest.join("."));
}

function matchesCondition(values: unknown[], condition: unknown): boolean {
  // Mongo matches an array field when ANY element matches the predicate, so
  // unwrap one level before comparing (e.g. { sectorTypes: { $in: [...] } }
  // must hit a doc whose sectorTypes array contains a legacy label).
  const candidates = (value: unknown): unknown[] => (Array.isArray(value) ? value : [value]);
  if (
    condition !== null &&
    typeof condition === "object" &&
    !Array.isArray(condition) &&
    !(condition instanceof Date) &&
    !isObjectId(condition)
  ) {
    const ops = condition as Record<string, unknown>;
    if ("$in" in ops) {
      const list = Array.isArray(ops.$in) ? ops.$in : [];
      return values.some((value) =>
        candidates(value).some(
          (entry) => entry !== undefined && list.some((item) => valuesEqual(entry, item))
        )
      );
    }
    if ("$exists" in ops) {
      const exists = values.some((value) => value !== undefined);
      return ops.$exists ? exists : !exists;
    }
    return false;
  }
  return values.some(
    (value) =>
      valuesEqual(value, condition) ||
      candidates(value).some((entry) => valuesEqual(entry, condition))
  );
}

function matchesQuery(doc: Doc, query: Doc): boolean {
  for (const [key, condition] of Object.entries(query)) {
    if (key === "$or") {
      if (
        !Array.isArray(condition) ||
        !(condition as Doc[]).some((clause) => matchesQuery(doc, clause as Doc))
      ) {
        return false;
      }
      continue;
    }
    if (!matchesCondition(resolvePath(doc, key), condition)) return false;
  }
  return true;
}

function setPath(doc: Doc, path: string, value: unknown): void {
  const parts = path.split(".");
  let cursor = doc;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    const next = cursor[part];
    if (next === null || typeof next !== "object" || Array.isArray(next)) {
      cursor[part] = {};
    }
    cursor = cursor[part] as Doc;
  }
  cursor[parts[parts.length - 1]!] = value;
}

function applyUpdate(doc: Doc, update: Doc, isInsert: boolean): void {
  if (isInsert && update.$setOnInsert !== null && typeof update.$setOnInsert === "object") {
    for (const [path, value] of Object.entries(update.$setOnInsert as Doc))
      setPath(doc, path, value);
  }
  if (update.$set !== null && typeof update.$set === "object") {
    for (const [path, value] of Object.entries(update.$set as Doc)) setPath(doc, path, value);
  }
}

function makeDb(seed: Record<string, Doc[]>): Db {
  const stores = new Map<string, Doc[]>(
    Object.entries(seed).map(([name, docs]) => [name, docs.map((doc) => ({ ...doc }))])
  );
  const collection = (name: string) => {
    const docs = (): Doc[] => {
      if (!stores.has(name)) stores.set(name, []);
      return stores.get(name)!;
    };
    return {
      find: (filter: Doc = {}) => ({
        toArray: async () => docs().filter((doc) => matchesQuery(doc, filter)),
      }),
      findOne: async (filter: Doc = {}) => docs().find((doc) => matchesQuery(doc, filter)) ?? null,
      countDocuments: async (filter: Doc = {}) =>
        docs().filter((doc) => matchesQuery(doc, filter)).length,
      insertOne: async (doc: Doc) => {
        docs().push({ ...doc });
        return { acknowledged: true, insertedId: doc._id };
      },
      updateOne: async (filter: Doc, update: Doc, options?: { upsert?: boolean }) => {
        const found = docs().find((doc) => matchesQuery(doc, filter));
        if (found) {
          applyUpdate(found, update, false);
          return { modifiedCount: 1, matchedCount: 1 };
        }
        if (options?.upsert) {
          const created: Doc = {};
          if (
            filter._id !== undefined &&
            (typeof filter._id !== "object" || isObjectId(filter._id))
          ) {
            created._id = filter._id;
          } else {
            created._id = new ObjectId();
          }
          applyUpdate(created, update, true);
          docs().push(created);
          return { modifiedCount: 0, matchedCount: 0, upsertedCount: 1, upsertedId: created._id };
        }
        return { modifiedCount: 0, matchedCount: 0 };
      },
      updateMany: async (filter: Doc, update: Doc) => {
        let count = 0;
        for (const doc of docs()) {
          if (matchesQuery(doc, filter)) {
            applyUpdate(doc, update, false);
            count += 1;
          }
        }
        return { modifiedCount: count, matchedCount: count };
      },
      deleteOne: async (filter: Doc) => {
        const all = docs();
        const index = all.findIndex((doc) => matchesQuery(doc, filter));
        if (index < 0) return { deletedCount: 0 };
        all.splice(index, 1);
        return { deletedCount: 1 };
      },
      deleteMany: async (filter: Doc) => {
        const all = docs();
        let count = 0;
        for (let i = all.length - 1; i >= 0; i--) {
          if (matchesQuery(all[i]!, filter)) {
            all.splice(i, 1);
            count += 1;
          }
        }
        return { deletedCount: count };
      },
    };
  };
  return { collection } as unknown as Db;
}

const T1 = new Date("2026-01-01T00:00:00Z");
const T2 = new Date("2026-02-01T00:00:00Z");

const oid = (hex: string): ObjectId => new ObjectId(hex);

function baseWorld(overrides: Record<string, Doc[]> = {}): Db {
  return makeDb({
    gameConfig: [{ _id: "default" }],
    gameState: [{ _id: "current", currentTurn: 42 }],
    corporations: [],
    corporateSectors: [],
    corporationOperatingModels: [],
    unownedSectors: [],
    unions: [],
    bargainingCampaigns: [],
    collectiveAgreements: [],
    strategicSectorDesignations: [],
    indexFunds: [],
    indexFundPositions: [],
    marketCapHistory: [],
    nationalizationLedger: [],
    states: [],
    sentimentPulses: [],
    countryModifiers: [],
    bills: [],
    ...overrides,
  });
}

async function all(db: Db, name: string): Promise<Doc[]> {
  return await (
    db.collection(name).find({}) as unknown as { toArray: () => Promise<Doc[]> }
  ).toArray();
}

const run = (db: Db, dryRun = false) => consolidateMediaEntertainment(db, { dryRun });

describe("no-collision rewrite", () => {
  it("rekeys corp, sector, union, campaign, agreement, designation, and history rows", async () => {
    const corpId = oid("100000000000000000000001");
    const db = baseWorld({
      corporations: [
        {
          _id: corpId,
          type: "media",
          secondaryType: "entertainment",
          unlockedTechNodeIds: ["media-1940-2", "entertainment-1940-1", "corp-1940-9"],
        },
      ],
      corporateSectors: [
        {
          _id: oid("200000000000000000000001"),
          corporationId: corpId,
          countryId: "US",
          stateId: "US:CA",
          sectorType: "media",
          strategyId: "streaming_media",
          revenue: 100,
          workers: 10,
          profitMargin: 20,
          createdAt: T1,
        },
      ],
      unownedSectors: [
        {
          _id: oid("300000000000000000000001"),
          countryId: "US",
          stateId: "US:NY",
          sectorType: "entertainment",
          revenue: 40,
          createdAt: T1,
        },
      ],
      unions: [
        {
          _id: oid("400000000000000000000001"),
          countryId: "US",
          sectorType: "media",
          name: "Media Union",
          treasury: 100,
          foundedByCharacterId: null,
          createdAt: T1,
        },
      ],
      bargainingCampaigns: [
        {
          _id: oid("500000000000000000000001"),
          countryId: "US",
          sectorType: "entertainment",
          unionId: oid("400000000000000000000001"),
          status: "open",
        },
      ],
      collectiveAgreements: [
        {
          _id: oid("600000000000000000000001"),
          countryId: "US",
          sectorType: "media",
          unionId: oid("400000000000000000000001"),
          status: "active",
        },
      ],
      strategicSectorDesignations: [
        {
          _id: oid("700000000000000000000001"),
          countryId: "US",
          sectorType: "entertainment",
          designatedAtTurn: 3,
          source: "seed",
        },
      ],
      marketCapHistory: [
        {
          _id: oid("800000000000000000000001"),
          turn: 41,
          bySector: { media: 5, entertainment: 7, energy: 1 },
        },
      ],
      nationalizationLedger: [
        { _id: oid("900000000000000000000001"), sectorTypes: ["media", "energy"] },
      ],
      states: [
        {
          _id: oid("a00000000000000000000001"),
          sectorSpecializations: { primary: "media", secondary: "energy" },
          topSectorsCache: {
            sectors: [{ sectorType: "entertainment", revenue: 9 }],
            computedAtTurn: 41,
          },
        },
      ],
      sentimentPulses: [{ _id: oid("b00000000000000000000001"), sectorType: "entertainment" }],
      countryModifiers: [
        {
          _id: oid("c00000000000000000000001"),
          kind: "sectorDemandModifier",
          sectorType: "media",
          pct: 5,
        },
      ],
      bills: [
        {
          _id: oid("d00000000000000000000001"),
          provisions: [
            { type: "subsidy", targetSectorType: "media", targetStrategyId: "streaming_media" },
          ],
        },
      ],
    });

    const { counts } = await run(db);

    const corps = await all(db, "corporations");
    expect(corps[0]!.type).toBe("media_entertainment");
    expect(corps[0]!.secondaryType).toBeNull();
    // media-1940-2 and entertainment-1940-1 land on the same canonical slot: no duplicates.
    expect(corps[0]!.unlockedTechNodeIds).toEqual(["media_entertainment-1940-2", "corp-1940-9"]);

    const sectors = await all(db, "corporateSectors");
    expect(sectors).toHaveLength(1);
    expect(sectors[0]!.sectorType).toBe("media_entertainment");
    expect(sectors[0]!.strategyId).toBe("streaming");

    const models = await all(db, "corporationOperatingModels");
    expect(new Set(models.map((doc) => doc.operatingModel))).toEqual(
      new Set(MEDIA_OPERATING_MODELS)
    );
    expect(models).toHaveLength(MEDIA_OPERATING_MODELS.length);
    expect(models.every((doc) => doc.acquiredTurn === 42)).toBe(true);

    expect((await all(db, "unownedSectors"))[0]!.sectorType).toBe("media_entertainment");
    expect((await all(db, "unions"))[0]!.sectorType).toBe("media_entertainment");
    expect((await all(db, "bargainingCampaigns"))[0]!.sectorType).toBe("media_entertainment");
    expect((await all(db, "collectiveAgreements"))[0]!.sectorType).toBe("media_entertainment");
    expect((await all(db, "strategicSectorDesignations"))[0]!.sectorType).toBe(
      "media_entertainment"
    );
    expect((await all(db, "marketCapHistory"))[0]!.bySector).toEqual({
      energy: 1,
      media_entertainment: 12,
    });
    expect((await all(db, "nationalizationLedger"))[0]!.sectorTypes).toEqual([
      "media_entertainment",
      "energy",
    ]);
    const states = await all(db, "states");
    expect((states[0]!.sectorSpecializations as Doc).primary).toBe("media_entertainment");
    expect(((states[0]!.topSectorsCache as Doc).sectors as Doc[])[0]!.sectorType).toBe(
      "media_entertainment"
    );
    expect((await all(db, "sentimentPulses"))[0]!.sectorType).toBe("media_entertainment");
    expect((await all(db, "countryModifiers"))[0]!.sectorType).toBe("media_entertainment");
    expect(((await all(db, "bills"))[0]!.provisions as Doc[])[0]).toMatchObject({
      targetSectorType: "media_entertainment",
      targetStrategyId: "streaming",
    });

    expect(counts.sectorsDeleted).toBe(0);
    expect(counts.unionsDeleted).toBe(0);
    expect(counts.fundsDeleted).toBe(0);
  });
});

describe("collision conservation", () => {
  it("folds same-corp same-state rows into the earliest survivor without losing money", async () => {
    const corpId = oid("100000000000000000000002");
    const unionId = oid("400000000000000000000002");
    const sectorA = {
      _id: oid("200000000000000000000002"),
      corporationId: corpId,
      countryId: "US",
      stateId: "US:CA",
      sectorType: "media",
      strategyId: "standard",
      revenue: 300,
      workers: 30,
      profitMargin: 10,
      productionPolicyLevel: 4,
      capitalStock: 100,
      capacityBookAnchor: 1000,
      constructionInProgressAnchor: 200,
      buildQueue: [{ unitsOrdered: 10, costPaidAnchor: 50, onlineTurn: 50, startTurn: 40 }],
      inventoryUnits: { advertising: 5 },
      inventoryValueAnchor: 100,
      realizedRevenue: 290,
      producedUnits: 50,
      soldUnits: 45,
      contractAchievableUnits: 55,
      laborCost: 60,
      createdAt: T2,
    };
    const sectorB = {
      _id: oid("200000000000000000000003"),
      corporationId: corpId,
      countryId: "US",
      stateId: "US:CA",
      sectorType: "entertainment",
      strategyId: "live_venue",
      revenue: 100,
      workers: 20,
      profitMargin: 30,
      productionPolicyLevel: 8,
      capitalStock: 50,
      capacityBookAnchor: 500,
      constructionInProgressAnchor: 100,
      buildQueue: [{ unitsOrdered: 4, costPaidAnchor: 30, onlineTurn: 52, startTurn: 41 }],
      inventoryUnits: { advertising: 7 },
      inventoryValueAnchor: 50,
      inventoryDrainedUnits: 4,
      realizedRevenue: 90,
      producedUnits: 20,
      soldUnits: 18,
      contractAchievableUnits: 22,
      laborCost: 20,
      representingUnionId: unionId,
      createdAt: T1,
    };
    const db = baseWorld({
      gameConfig: [{ _id: "default", marketSystemMode: "plants" }],
      corporations: [{ _id: corpId, type: "entertainment", secondaryType: null }],
      corporateSectors: [sectorA, sectorB],
      unions: [
        {
          _id: unionId,
          countryId: "US",
          sectorType: "media_entertainment",
          name: "U",
          foundedByCharacterId: null,
          createdAt: T1,
        },
      ],
    });

    const { counts } = await run(db);
    expect(counts.sectorMerges).toBe(1);
    expect(counts.sectorsDeleted).toBe(1);

    const sectors = await all(db, "corporateSectors");
    expect(sectors).toHaveLength(1);
    const kept = sectors[0]!;
    expect(String(kept._id)).toBe(String(sectorB._id));
    expect(kept.sectorType).toBe("media_entertainment");
    expect(kept.strategyId).toBe("diversified");
    expect(kept.revenue).toBe(400);
    expect(kept.workers).toBe(50);
    expect(kept.profitMargin).toBeCloseTo(15);
    expect(kept.inventoryUnits).toEqual({ advertising: 12 });
    expect(kept.inventoryValueAnchor).toBe(150);
    expect(kept.inventoryDrainedUnits).toBe(4);
    expect(kept.realizedRevenue).toBe(380);
    expect(kept.producedUnits).toBe(70);
    expect(kept.soldUnits).toBe(63);
    expect(kept.contractAchievableUnits).toBe(77);
    expect(kept.laborCost).toBe(80);
    expect(kept.wagePerWorker).toBeCloseTo(1.6);
    expect(String(kept.representingUnionId)).toBe(String(unionId));
    // Paid basis and in-flight cash are conserved, never rescaled.
    expect(kept.capacityBookAnchor).toBe(1500);
    expect(kept.constructionInProgressAnchor).toBe(300);
    const queue = kept.buildQueue as Doc[];
    expect(queue).toHaveLength(2);
    expect(queue.reduce((sum, order) => sum + (order.costPaidAnchor as number), 0)).toBe(80);
    // Capacity retools onto diversified by the same ratio the retool command uses.
    const expectedStock =
      100 * capacityRescaleRatio("media_entertainment", "standard", "diversified") +
      50 * capacityRescaleRatio("media_entertainment", "live_venue", "diversified");
    expect(kept.capitalStock as number).toBeCloseTo(expectedStock, 6);

    const models = await all(db, "corporationOperatingModels");
    expect(new Set(models.map((doc) => doc.operatingModel))).toEqual(
      new Set(MEDIA_OPERATING_MODELS)
    );
    expect(models).toHaveLength(MEDIA_OPERATING_MODELS.length);
  });

  it("grants sector-inferred models to conglomerates without retyping them", async () => {
    const corpId = oid("100000000000000000000003");
    const db = baseWorld({
      corporations: [{ _id: corpId, type: "energy", secondaryType: null }],
      corporateSectors: [
        {
          _id: oid("200000000000000000000004"),
          corporationId: corpId,
          countryId: "US",
          stateId: "US:TX",
          sectorType: "media",
          strategyId: "standard",
          revenue: 10,
          workers: 2,
          profitMargin: 5,
          createdAt: T1,
        },
      ],
    });
    await run(db);
    const corps = await all(db, "corporations");
    expect(corps[0]!.type).toBe("energy");
    const models = await all(db, "corporationOperatingModels");
    expect(models).toHaveLength(5);
    expect(models.every((doc) => String(doc.corporationId) === String(corpId))).toBe(true);
  });
});

describe("union and unowned folds", () => {
  it("merges seeded same-country unions and repoints linkage", async () => {
    const loserId = oid("400000000000000000000011");
    const survivorId = oid("400000000000000000000010");
    const corpId = oid("100000000000000000000004");
    const db = baseWorld({
      corporateSectors: [
        {
          _id: oid("200000000000000000000010"),
          corporationId: corpId,
          countryId: "US",
          stateId: "US:CA",
          sectorType: "energy",
          strategyId: "standard",
          revenue: 10,
          workers: 2,
          profitMargin: 5,
          representingUnionId: loserId,
          createdAt: T1,
        },
      ],
      unions: [
        {
          _id: survivorId,
          countryId: "US",
          sectorType: "media",
          name: "Seeded A",
          treasury: 100,
          strength: 10,
          foundedByCharacterId: null,
          createdAt: T1,
        },
        {
          _id: loserId,
          countryId: "US",
          sectorType: "entertainment",
          name: "Seeded B",
          treasury: 50,
          strength: 5,
          foundedByCharacterId: null,
          createdAt: T2,
        },
        {
          _id: oid("400000000000000000000012"),
          countryId: "US",
          sectorType: "media",
          name: "Rival",
          treasury: 7,
          foundedByCharacterId: oid("900000000000000000000001"),
          createdAt: T1,
        },
      ],
      bargainingCampaigns: [
        {
          _id: oid("500000000000000000000010"),
          countryId: "US",
          sectorType: "media",
          unionId: loserId,
          status: "open",
        },
      ],
      collectiveAgreements: [
        {
          _id: oid("600000000000000000000010"),
          countryId: "US",
          sectorType: "entertainment",
          unionId: loserId,
          status: "active",
        },
      ],
    });
    const { counts } = await run(db);
    expect(counts.unionMerges).toBe(1);
    const unions = await all(db, "unions");
    expect(unions).toHaveLength(2);
    const kept = unions.find((row) => String(row._id) === String(survivorId))!;
    expect(kept.sectorType).toBe("media_entertainment");
    expect(kept.treasury).toBe(150);
    expect(kept.strength).toBe(15);
    expect(kept.name).toBe("Seeded A");
    const rival = unions.find((row) => String(row._id) === "400000000000000000000012")!;
    expect(rival.sectorType).toBe("media_entertainment");
    expect((await all(db, "corporateSectors"))[0]!.representingUnionId).toBeDefined();
    expect(String((await all(db, "corporateSectors"))[0]!.representingUnionId)).toBe(
      String(survivorId)
    );
    expect(String((await all(db, "bargainingCampaigns"))[0]!.unionId)).toBe(String(survivorId));
    expect(String((await all(db, "collectiveAgreements"))[0]!.unionId)).toBe(String(survivorId));
  });

  it("folds colliding unowned rows by summing revenue", async () => {
    const db = baseWorld({
      unownedSectors: [
        {
          _id: oid("300000000000000000000010"),
          countryId: "US",
          stateId: "US:CA",
          sectorType: "media",
          revenue: 60,
          headroomUnits: 6,
          createdAt: T2,
        },
        {
          _id: oid("300000000000000000000011"),
          countryId: "US",
          stateId: "US:CA",
          sectorType: "entertainment",
          revenue: 40,
          headroomUnits: 4,
          createdAt: T1,
        },
      ],
    });
    const { counts } = await run(db);
    expect(counts.unownedMerges).toBe(1);
    const rows = await all(db, "unownedSectors");
    expect(rows).toHaveLength(1);
    expect(String(rows[0]!._id)).toBe("300000000000000000000011");
    expect(rows[0]!.revenue).toBe(100);
    expect(rows[0]!.headroomUnits).toBe(10);
  });
});

describe("fund consolidation", () => {
  it("folds GLBENT and legacy media funds into GLBMEA without double counting", async () => {
    const survivorId = oid("e00000000000000000000001");
    const mediaFundId = oid("e00000000000000000000002");
    const entFundId = oid("e00000000000000000000003");
    const corpX = oid("100000000000000000000010");
    const corpY = oid("100000000000000000000011");
    const holderA = oid("f00000000000000000000001");
    const holderB = oid("f00000000000000000000002");
    const db = baseWorld({
      indexFunds: [
        {
          _id: survivorId,
          slug: "global_sector_media_entertainment",
          name: "Global Media & Entertainment Index",
          tickerSymbol: "GLBMEA",
          scope: "global",
          kind: "sector",
          sectorType: "media_entertainment",
          anchorCurrencyCode: "USD",
          status: "active",
          quotedNav: 10,
          unitSupply: 1005,
          reserveUnits: 1000,
          cashAnchor: 100,
          targetConstituents: [],
          holdings: [
            { corporationId: corpX, shares: 10, avgCostPerShareAnchor: 5, lastValueAnchor: 50 },
          ],
          createdAt: T1,
          updatedAt: T1,
        },
        {
          _id: mediaFundId,
          slug: "global_sector_media",
          name: "Global Media Index",
          tickerSymbol: "GLBMEA",
          scope: "global",
          kind: "sector",
          sectorType: "media",
          anchorCurrencyCode: "USD",
          status: "active",
          quotedNav: 10,
          unitSupply: 503,
          reserveUnits: 500,
          cashAnchor: 50,
          targetConstituents: [],
          holdings: [
            { corporationId: corpX, shares: 4, avgCostPerShareAnchor: 5, lastValueAnchor: 20 },
            { corporationId: corpY, shares: 6, avgCostPerShareAnchor: 8, lastValueAnchor: 48 },
          ],
          createdAt: T1,
          updatedAt: T1,
        },
        {
          _id: entFundId,
          slug: "global_sector_entertainment",
          name: "Global Entertainment Index",
          tickerSymbol: "GLBENT",
          scope: "global",
          kind: "sector",
          sectorType: "entertainment",
          anchorCurrencyCode: "USD",
          status: "active",
          quotedNav: 20,
          unitSupply: 7,
          reserveUnits: 0,
          cashAnchor: 25,
          targetConstituents: [],
          holdings: [
            { corporationId: corpY, shares: 1, avgCostPerShareAnchor: 8, lastValueAnchor: 8 },
          ],
          createdAt: T2,
          updatedAt: T2,
        },
      ],
      indexFundPositions: [
        {
          _id: oid("f00000000000000000000010"),
          fundId: survivorId,
          holderKind: "fund_reserve",
          units: 1000,
          avgNavAnchor: 10,
          createdAt: T1,
          updatedAt: T1,
        },
        {
          _id: oid("f00000000000000000000011"),
          fundId: survivorId,
          holderKind: "character",
          characterId: holderA,
          units: 5,
          avgNavAnchor: 10,
          createdAt: T1,
          updatedAt: T1,
        },
        {
          _id: oid("f00000000000000000000012"),
          fundId: mediaFundId,
          holderKind: "fund_reserve",
          units: 500,
          avgNavAnchor: 10,
          createdAt: T1,
          updatedAt: T1,
        },
        {
          _id: oid("f00000000000000000000013"),
          fundId: mediaFundId,
          holderKind: "character",
          characterId: holderA,
          units: 3,
          avgNavAnchor: 10,
          createdAt: T1,
          updatedAt: T1,
        },
        {
          _id: oid("f00000000000000000000014"),
          fundId: entFundId,
          holderKind: "npp",
          nppId: holderB,
          units: 7,
          avgNavAnchor: 20,
          createdAt: T2,
          updatedAt: T2,
        },
      ],
    });

    const { counts } = await run(db);
    expect(counts.fundsFolded).toBe(2);
    expect(counts.fundsDeleted).toBe(2);

    const funds = await all(db, "indexFunds");
    expect(funds).toHaveLength(1);
    expect(funds[0]!.tickerSymbol).toBe("GLBMEA");
    expect(funds[0]!.sectorType).toBe("media_entertainment");
    const holdings = funds[0]!.holdings as Doc[];
    expect(holdings.find((row) => String(row.corporationId) === String(corpX))!.shares).toBe(14);
    expect(holdings.find((row) => String(row.corporationId) === String(corpY))!.shares).toBe(7);
    expect(funds[0]!.cashAnchor).toBe(175);

    const positions = await all(db, "indexFundPositions");
    expect(positions.every((row) => String(row.fundId) === String(survivorId))).toBe(true);
    const holderAPositions = positions.filter(
      (row) => String(row.characterId ?? "") === String(holderA)
    );
    expect(holderAPositions).toHaveLength(1);
    expect(holderAPositions[0]!.units).toBe(8);
    const supply = positions.reduce((sum, row) => sum + Math.floor(row.units as number), 0);
    expect(funds[0]!.unitSupply).toBe(supply);
  });
});

describe("idempotent rerun", () => {
  it("changes nothing on a second pass", async () => {
    const corpId = oid("100000000000000000000020");
    const db = baseWorld({
      corporations: [
        {
          _id: corpId,
          type: "media",
          secondaryType: "entertainment",
          unlockedTechNodeIds: ["media-1940-1"],
        },
      ],
      corporateSectors: [
        {
          _id: oid("200000000000000000000020"),
          corporationId: corpId,
          countryId: "US",
          stateId: "US:CA",
          sectorType: "media",
          strategyId: "standard",
          revenue: 100,
          workers: 10,
          profitMargin: 20,
          createdAt: T1,
        },
        {
          _id: oid("200000000000000000000021"),
          corporationId: corpId,
          countryId: "US",
          stateId: "US:CA",
          sectorType: "entertainment",
          strategyId: "live_venue",
          revenue: 50,
          workers: 5,
          profitMargin: 10,
          createdAt: T2,
        },
      ],
    });
    await run(db);
    const snapshot = async (): Promise<Record<string, Doc[]>> => {
      const names = [
        "corporations",
        "corporateSectors",
        "corporationOperatingModels",
        "unions",
        "indexFunds",
        "indexFundPositions",
      ];
      const out: Record<string, Doc[]> = {};
      for (const name of names) out[name] = await all(db, name);
      return out;
    };
    const before = await snapshot();
    const { counts } = await run(db);
    expect(await snapshot()).toEqual(before);
    expect(Object.values(counts).every((value) => value === 0)).toBe(true);
    // A third run through the registered entry is equally clean.
    const result = await migration.execute(db, { dryRun: false });
    expect(result.documentsUpdated).toBe(0);
    expect(result.documentsDeleted ?? 0).toBe(0);
  });

  it("is registered exactly once and marked idempotent", () => {
    expect(migration.id).toBe("2026-09-21-media-entertainment-persisted-consolidation");
    expect(migration.idempotent).toBe(true);
  });
});
