import { randomUUID } from "node:crypto";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "../registry";
import { REQUIRED_STARTUP_MIGRATIONS } from "../startupMigrations";
import { migration } from "./2026-10-05-fold-automobile-entertainment-types";
import { foldAutomobileEntertainmentTypes } from "../../../../scripts/migrations/2026-10-05-fold-automobile-entertainment-types";

const mongoUri = process.env.AHD_TAXONOMY_FOLD_MONGO_TEST_URI;

function fixtureClient(uri: string): MongoClient {
  const parsed = new URL(uri);
  if (
    parsed.protocol !== "mongodb:" ||
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error("The taxonomy fold fixture requires an isolated local test endpoint");
  }
  return new MongoClient(uri);
}

describe("2026-10-05-fold-automobile-entertainment-types registration", () => {
  it("is an idempotent registry migration that also runs at startup", () => {
    expect(migration.idempotent).toBe(true);
    expect(MIGRATIONS).toContain(migration);
    expect(REQUIRED_STARTUP_MIGRATIONS).toContain(migration);
  });

  it("defaults to a dry run when called directly", async () => {
    const writes: string[] = [];
    const cursor = { toArray: async () => [] };
    const collection = {
      countDocuments: async () => 0,
      find: () => cursor,
      findOne: async () => null,
      updateMany: async () => {
        writes.push("updateMany");
        return { modifiedCount: 0 };
      },
      updateOne: async () => {
        writes.push("updateOne");
        return { modifiedCount: 0 };
      },
      deleteOne: async () => {
        writes.push("deleteOne");
        return { deletedCount: 0 };
      },
      bulkWrite: async () => {
        writes.push("bulkWrite");
        return { modifiedCount: 0 };
      },
    };
    const db = { collection: () => collection } as unknown as Db;

    const result = await foldAutomobileEntertainmentTypes(db);

    expect(writes).toEqual([]);
    expect(result.notes?.[0]).toBe("dry run: no writes");
  });
});

describe.skipIf(!mongoUri)("2026-10-05-fold-automobile-entertainment-types on a real store", () => {
  async function withDb(run: (db: Db) => Promise<void>) {
    const client = fixtureClient(mongoUri!);
    await client.connect();
    const db = client.db(`ahd_taxonomy_fold_${randomUUID().replaceAll("-", "")}`);
    try {
      await run(db);
    } finally {
      await db.dropDatabase();
      await client.close();
    }
  }

  const legacyA = ["auto", "mobiles"].join("");
  const legacyE = ["entertain", "ment"].join("");

  async function seedLegacyWorld(db: Db) {
    const autoCorp = new ObjectId();
    const showCorp = new ObjectId();
    const union = new ObjectId();
    await db.collection("corporations").insertMany([
      {
        _id: autoCorp,
        type: legacyA,
        secondaryType: legacyE,
        liquidCapital: 1_000_000,
        totalShares: 10_000_000,
        unlockedTechNodeIds: [`${legacyA}-1950-3`, "corp-1950-1"],
        soe: { sector: legacyA, planTarget: 10 },
      },
      { _id: showCorp, type: legacyE, liquidCapital: 250_000, totalShares: 5_000_000 },
    ]);
    await db.collection("corporateSectors").insertMany([
      {
        corporationId: autoCorp,
        stateId: "MI",
        countryId: "US",
        sectorType: legacyA,
        revenue: 900,
        capitalStock: 120,
        workers: 400,
        representingUnionId: union,
      },
      {
        corporationId: showCorp,
        stateId: "CA",
        countryId: "US",
        sectorType: legacyE,
        revenue: 300,
        capitalStock: 30,
        workers: 50,
      },
    ]);
    await db.collection("unownedSectors").insertMany([
      { stateId: "MI", countryId: "US", sectorType: legacyA, revenue: 1_000, headroomUnits: 10 },
      {
        stateId: "MI",
        countryId: "US",
        sectorType: "manufacturing",
        industryModel: "vehicles",
        mediaDiscriminator: null,
        revenue: 4_000,
        headroomUnits: 40,
      },
      { stateId: "CA", countryId: "US", sectorType: legacyE, revenue: 2_000, headroomUnits: 20 },
    ]);
    await db.collection("unions").insertMany([
      {
        _id: union,
        countryId: "US",
        sectorType: legacyA,
        foundedByCharacterId: null,
        ownerId: null,
        treasury: 75,
      },
    ]);
    await db.collection("states").insertOne({
      _id: "MI",
      sectorSpecializations: { primary: legacyA, secondary: "manufacturing" },
    } as never);
    await db.collection("indexFunds").insertOne({ sectorType: legacyE, ticker: "GLBENT" });
    await db.collection("tariffs").insertOne({ scopeType: "sector", targetSectorType: legacyA });
    await db.collection("bills").insertOne({
      provisions: [
        { type: "tariff", scopeType: "sector", targetSectorType: legacyA },
        { type: "designate_strategic_sector", sectorType: legacyE },
      ],
    });
    await db.collection("macroCountries").insertOne({
      _id: "FI",
      sectors: { [legacyA]: { capacity: 3 }, manufacturing: { capacity: 9 } },
    } as never);
    await db
      .collection("marketCapHistory")
      .insertOne({ bySector: { [legacyA]: 5, manufacturing: 7, [legacyE]: 2 } });
    await db.collection("gameConfig").insertOne({
      _id: "default",
      fresh1991VehicleModelSeed: { status: "complete" },
    } as never);
    return { autoCorp, showCorp, union };
  }

  async function legacyCount(db: Db): Promise<number> {
    let total = 0;
    for (const [collection, field] of [
      ["corporations", "type"],
      ["corporations", "secondaryType"],
      ["corporateSectors", "sectorType"],
      ["unownedSectors", "sectorType"],
      ["unions", "sectorType"],
      ["states", "sectorSpecializations.primary"],
      ["indexFunds", "sectorType"],
      ["tariffs", "targetSectorType"],
      ["bills", "provisions.targetSectorType"],
      ["bills", "provisions.sectorType"],
    ] as const) {
      total += await db.collection(collection).countDocuments({
        [field]: { $in: [legacyA, legacyE] },
      });
    }
    return total;
  }

  it("dry-runs without writing", async () => {
    await withDb(async (db) => {
      await seedLegacyWorld(db);
      const before = await legacyCount(db);
      const result = await migration.execute(db, { dryRun: true });
      expect(result.documentsUpdated).toBe(0);
      expect(await legacyCount(db)).toBe(before);
    });
  });

  it("re-keys every legacy row to its canonical identity and conserves money", async () => {
    await withDb(async (db) => {
      const { autoCorp, showCorp, union } = await seedLegacyWorld(db);
      await migration.execute(db, { dryRun: false });

      expect(await legacyCount(db)).toBe(0);
      const auto = await db.collection("corporations").findOne({ _id: autoCorp });
      expect(auto).toMatchObject({
        type: "manufacturing",
        industryModel: "vehicles",
        secondaryType: "media_entertainment",
        liquidCapital: 1_000_000,
        totalShares: 10_000_000,
        soe: { sector: "manufacturing_vehicles", planTarget: 10 },
      });
      expect(auto?.unlockedTechNodeIds).toEqual(["manufacturing_vehicles-1950-3", "corp-1950-1"]);
      expect(await db.collection("corporations").findOne({ _id: showCorp })).toMatchObject({
        type: "media",
        mediaDiscriminator: "entertainment",
        liquidCapital: 250_000,
      });

      const sectors = await db
        .collection("corporateSectors")
        .find()
        .sort({ stateId: -1 })
        .toArray();
      expect(sectors.map((s) => [s.sectorType, s.industryModel, s.mediaDiscriminator])).toEqual([
        ["manufacturing", "vehicles", null],
        ["media", null, "entertainment"],
      ]);
      expect(sectors.map((s) => [s.revenue, s.capitalStock, s.workers])).toEqual([
        [900, 120, 400],
        [300, 30, 50],
      ]);

      // The MI market merged into its existing twin; the CA market re-keyed.
      const markets = await db.collection("unownedSectors").find().sort({ stateId: -1 }).toArray();
      expect(markets).toHaveLength(2);
      expect(markets[0]).toMatchObject({
        stateId: "MI",
        industryModel: "vehicles",
        revenue: 5_000,
        headroomUnits: 50,
      });
      expect(markets[1]).toMatchObject({
        stateId: "CA",
        sectorType: "media",
        mediaDiscriminator: "entertainment",
        revenue: 2_000,
      });

      // The funded union keeps its id, treasury and represented sectors.
      expect(await db.collection("unions").findOne({ _id: union })).toMatchObject({
        sectorType: "manufacturing",
        industryModel: "vehicles",
        treasury: 75,
      });
      expect(
        await db.collection("corporateSectors").countDocuments({ representingUnionId: union })
      ).toBe(1);

      expect(await db.collection("states").findOne({ _id: "MI" } as never)).toMatchObject({
        sectorSpecializations: { primary: "manufacturing_vehicles", secondary: "manufacturing" },
      });
      expect(await db.collection("indexFunds").findOne()).toMatchObject({
        sectorType: "media_entertainment",
      });
      expect(await db.collection("bills").findOne()).toMatchObject({
        provisions: [
          { targetSectorType: "manufacturing_vehicles" },
          { sectorType: "media_entertainment" },
        ],
      });
      expect(await db.collection("macroCountries").findOne({ _id: "FI" } as never)).toMatchObject({
        sectors: { manufacturing_vehicles: { capacity: 3 }, manufacturing: { capacity: 9 } },
      });
      expect(await db.collection("marketCapHistory").findOne()).toMatchObject({
        bySector: { manufacturing: 7, manufacturing_vehicles: 5, media_entertainment: 2 },
      });
      const config = await db.collection("gameConfig").findOne({ _id: "default" } as never);
      expect(config?.fresh1991VehicleModelSeed).toBeUndefined();

      // Idempotent: a second apply finds nothing to do.
      const again = await migration.execute(db, { dryRun: false });
      expect(again.documentsUpdated).toBe(0);
      expect(again.documentsDeleted).toBe(0);
    });
  });

  it("folds a vacant duplicate world union into its canonical twin", async () => {
    await withDb(async (db) => {
      const legacy = new ObjectId();
      const twin = new ObjectId();
      await db.collection("unions").insertMany([
        { _id: legacy, countryId: "US", sectorType: legacyA, foundedByCharacterId: null },
        {
          _id: twin,
          countryId: "US",
          sectorType: "manufacturing",
          industryModel: "vehicles",
          mediaDiscriminator: null,
          foundedByCharacterId: null,
        },
      ]);
      await db.collection("corporateSectors").insertOne({
        stateId: "MI",
        sectorType: "manufacturing",
        industryModel: "vehicles",
        representingUnionId: legacy,
      });
      await migration.execute(db, { dryRun: false });
      expect(await db.collection("unions").countDocuments()).toBe(1);
      expect(await db.collection("corporateSectors").findOne()).toMatchObject({
        representingUnionId: twin,
      });
    });
  });

  it("refuses to apply over a colliding owned sector", async () => {
    await withDb(async (db) => {
      const corp = new ObjectId();
      await db.collection("corporateSectors").insertMany([
        { corporationId: corp, stateId: "MI", sectorType: legacyA, revenue: 1 },
        {
          corporationId: corp,
          stateId: "MI",
          sectorType: "manufacturing",
          industryModel: "vehicles",
          mediaDiscriminator: null,
          revenue: 2,
        },
      ]);
      await expect(migration.execute(db, { dryRun: false })).rejects.toThrow(/collision/);
      expect(await db.collection("corporateSectors").countDocuments({ sectorType: legacyA })).toBe(
        1
      );
    });
  });
});
