/** Missing seed caches qualify against synthetic regions on isolated Mongo. */
import { BSON, MongoClient, ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StateDemographics, DemographicCategory } from "@/lib/db/types";
import { backfillMissingRegionLeans } from "./backfillMissingRegionLeans";
import { jpRegions1991 } from "@/lib/countries/jp/data/jpRegions1991";
import { jpRegionDemographics1991 } from "@/lib/countries/jp/data/jpRegionDemographics1991";
import { jpDemographicCategories } from "@/lib/countries/jp/data/jpDemographicCategories";
const uri = process.env.FEDERATION_TEST_MONGO_URI;
const NOW = new Date("2026-10-04T00:00:00Z");
describe.skipIf(!uri)("Missing regional lean seed caches on isolated Mongo", () => {
  let client: MongoClient;
  let commands = 0,
    replyBytes = 0;
  beforeAll(async () => {
    const address = new URL(uri!);
    if (address.protocol !== "mongodb:" || !["127.0.0.1", "localhost"].includes(address.hostname))
      throw new Error("Isolated loopback Mongo required");
    client = new MongoClient(uri!, { monitorCommands: true, serverSelectionTimeoutMS: 5000 });
    client.on("commandStarted", () => commands++);
    client.on(
      "commandSucceeded",
      (event) => (replyBytes += BSON.calculateObjectSize({ reply: event.reply }) - 12)
    );
    await client.connect();
  });
  afterAll(async () => {
    await client?.close();
  });
  async function fixture(count = 1) {
    const db = client.db(`ahd_test_region_lean_${new ObjectId()}`);
    await db
      .collection<{ _id: string; [key: string]: unknown }>("demographicCategories")
      .insertMany([
        {
          _id: "jpGroups",
          groups: [
            { id: "jpVoters", defaultEconomicLean: -2, defaultSocialLean: 3, defaultTurnout: 60 },
          ],
          defaultWeight: 100,
        },
        {
          _id: "foreignGroups",
          groups: [{ id: "foreignVoters", defaultEconomicLean: 5, defaultSocialLean: -5 }],
          defaultWeight: 100,
        },
      ]);
    await db
      .collection<{ _id: string; [key: string]: unknown }>("states")
      .insertMany(Array.from({ length: count }, (_, i) => ({ _id: `JP_${i}`, countryId: "JP" })));
    await db.collection<{ _id: string; [key: string]: unknown }>("stateDemographics").insertMany(
      Array.from({ length: count }, (_, i) => ({
        _id: `JP_${i}`,
        countryId: "JP",
        categoryWeights: { jpGroups: 100 },
        groups: {
          jpVoters: { population: 100, turnout: 60, economicLean: -2, socialLean: 3 },
          foreignVoters: { population: 100, economicLean: 5, socialLean: -5 },
        },
        ignoredPayload: "x".repeat(100_000),
      }))
    );
    return db;
  }
  it("derives all eight authored 1991 Japan regions without hardcoded neutral values", async () => {
    const db = client.db(`ahd_test_region_lean_${new ObjectId()}`);
    try {
      await db
        .collection<{ _id: string; [key: string]: unknown }>("states")
        .insertMany(jpRegions1991.map((row) => ({ _id: row._id, countryId: row.countryId })));
      await db
        .collection<StateDemographics>("stateDemographics")
        .insertMany(jpRegionDemographics1991);
      await db
        .collection<DemographicCategory>("demographicCategories")
        .insertMany(jpDemographicCategories);
      expect(await backfillMissingRegionLeans(db, NOW)).toEqual({
        written: 8,
        missingDemographics: 0,
        missingCategories: 0,
      });
      const states = await db.collection("states").find().toArray();
      expect(
        states.every(
          (row) => Number.isFinite(row.cachedEconomicLean) && Number.isFinite(row.cachedSocialLean)
        )
      ).toBe(true);
      expect(
        new Set(states.map((row) => `${row.cachedEconomicLean}:${row.cachedSocialLean}`)).size
      ).toBeGreaterThan(1);
      expect(
        await db.collection("stateDemographics").countDocuments({
          cachedEconomicLean: { $exists: true },
          cachedSocialLean: { $exists: true },
        })
      ).toBe(8);
    } finally {
      await db.dropDatabase();
    }
  });
  it("fills both cache readers from weighted categories and retains valid existing regions", async () => {
    const db = await fixture(2);
    try {
      await db
        .collection<{ _id: string; [key: string]: unknown }>("states")
        .updateOne({ _id: "JP_1" }, { $set: { cachedEconomicLean: 1.2, cachedSocialLean: -0.4 } });
      expect(await backfillMissingRegionLeans(db, NOW)).toEqual({
        written: 1,
        missingDemographics: 0,
        missingCategories: 0,
      });
      for (const collection of ["states", "stateDemographics"])
        expect(
          await db
            .collection<{ _id: string; [key: string]: unknown }>(collection)
            .findOne({ _id: "JP_0" })
        ).toMatchObject({ cachedEconomicLean: -2, cachedSocialLean: 3 });
      expect(
        await db
          .collection<{ _id: string; [key: string]: unknown }>("states")
          .findOne({ _id: "JP_1" })
      ).toMatchObject({ cachedEconomicLean: 1.2, cachedSocialLean: -0.4 });
      commands = 0;
      expect((await backfillMissingRegionLeans(db, NOW)).written).toBe(0);
      expect(commands).toBe(1);
    } finally {
      await db.dropDatabase();
    }
  });
  it("does not manufacture neutral caches for missing or cross-country demographics or unsupported categories", async () => {
    const db = await fixture(4);
    try {
      await db
        .collection<{ _id: string; [key: string]: unknown }>("stateDemographics")
        .deleteOne({ _id: "JP_0" });
      await db
        .collection<{ _id: string; [key: string]: unknown }>("stateDemographics")
        .updateOne({ _id: "JP_1" }, { $set: { countryId: "US" } });
      await db
        .collection<{ _id: string; [key: string]: unknown }>("stateDemographics")
        .updateOne({ _id: "JP_2" }, { $set: { categoryWeights: { unknown: 100 } } });
      await db
        .collection<{ _id: string; [key: string]: unknown }>("stateDemographics")
        .updateOne({ _id: "JP_3" }, { $set: { "groups.jpVoters.turnout": 0 } });
      expect(await backfillMissingRegionLeans(db, NOW)).toEqual({
        written: 0,
        missingDemographics: 2,
        missingCategories: 2,
      });
      expect(
        await db
          .collection<{ _id: string; [key: string]: unknown }>("states")
          .countDocuments({ cachedEconomicLean: { $exists: true } })
      ).toBe(0);
    } finally {
      await db.dropDatabase();
    }
  });
  it("fills150 regions with bounded commands and projected payloads", async () => {
    const db = await fixture(150);
    try {
      commands = replyBytes = 0;
      expect((await backfillMissingRegionLeans(db, NOW)).written).toBe(150);
      process.stdout.write(JSON.stringify({ path: "region-lean150", commands, replyBytes }) + "\n");
      expect(commands).toBeLessThanOrEqual(7);
      expect(replyBytes).toBeLessThan(100_000);
    } finally {
      await db.dropDatabase();
    }
  });
  it("retries after a failed demographic-cache write without falsely marking states complete", async () => {
    const db = await fixture();
    try {
      await db.command({
        collMod: "stateDemographics",
        validator: { cachedEconomicLean: { $exists: false } },
      });
      await expect(backfillMissingRegionLeans(db, NOW)).rejects.toThrow();
      expect(
        await db
          .collection<{ _id: string; [key: string]: unknown }>("states")
          .findOne({ _id: "JP_0" })
      ).not.toHaveProperty("cachedEconomicLean");
      await db.command({ collMod: "stateDemographics", validator: {} });
      expect((await backfillMissingRegionLeans(db, NOW)).written).toBe(1);
    } finally {
      await db.dropDatabase();
    }
  });
});
