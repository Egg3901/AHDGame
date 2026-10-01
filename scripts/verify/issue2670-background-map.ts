/** Native read-model qualification in a generated disposable test database. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { MongoClient } from "mongodb";

async function main() {
  const uri = process.env.AHD_TEST_MONGODB_URI;
  assert(uri, "AHD_TEST_MONGODB_URI is required");
  assert.equal(process.env.NODE_ENV, "test", "Run with NODE_ENV=test");
  const databaseName = `ahd_macro_map_${randomUUID().replaceAll("-", "")}`;
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB = databaseName;
  process.env.MONGO_DB_NAME = databaseName;
  const client = new MongoClient(uri, { maxPoolSize: 2, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db(databaseName);
  try {
    const { getWorldEntityPresetManifest } =
      await import("../../src/lib/world/worldEntityManifest");
    const { buildBackgroundMacroCountry } =
      await import("../../src/lib/world/macro/backgroundSeed");
    const { getMacroCountriesCollection } =
      await import("../../src/lib/db/collections/macroCountries");
    const { loadWorldEntityMapSnapshot } = await import("../../src/lib/world/worldEntityMapLoader");
    const { backgroundMacroFeatureIds } = await import("../../src/lib/world/worldEntityMap");
    const entries = getWorldEntityPresetManifest("1991-default").entries;
    const background = entries.filter(
      (entry) => entry.status === "sovereign" && entry.simulationTier === "background-macro"
    );
    const collection = await getMacroCountriesCollection(db);
    await collection.insertMany(
      background.map((entry) =>
        buildBackgroundMacroCountry(entry, "1991-default", new Date("2026-09-30"))
      )
    );
    const initial = await loadWorldEntityMapSnapshot(db, "1991-default");
    const initialFeatures = backgroundMacroFeatureIds(initial);
    assert(initialFeatures.size > 100);
    assert.equal(
      Object.values(initial.byEntityId ?? {}).filter((item) => item.macroSummary).length,
      background.length
    );
    assert.equal(initial.byFeatureId["124"].displayName, "Canada");
    assert.equal(initial.byFeatureId["124"].macroSummary?.provenance, "estimated-background");
    assert(initial.byFeatureId["124"].macroSummary!.population > 0);
    const snapshotOutput = process.argv[2];
    if (snapshotOutput) await writeFile(snapshotOutput, JSON.stringify(initial));

    await collection.updateOne({ _id: "AU" }, { $set: { presetId: "2019-default" } });
    await collection.updateOne({ _id: "MX" }, { $set: { retiredAt: new Date("2026-09-30") } });
    const us = entries.find((entry) => entry.entityId === "US");
    assert(us);
    await collection.insertOne(
      buildBackgroundMacroCountry(us, "1991-default", new Date("2026-09-30"))
    );
    const filtered = await loadWorldEntityMapSnapshot(db, "1991-default");
    assert.equal(filtered.byFeatureId["036"].macroSummary, undefined);
    assert.equal(filtered.byFeatureId["484"].macroSummary, undefined);
    assert.equal(filtered.byFeatureId["840"].macroSummary, undefined);
    assert.equal(
      filtered.byFeatureId["124"].macroSummary?.population,
      initial.byFeatureId["124"].macroSummary?.population
    );
    const later = await loadWorldEntityMapSnapshot(db, "1999-default");
    assert.equal(backgroundMacroFeatureIds(later).size, 0);
    assert.equal(later.byFeatureId["124"].macroSummary, undefined);
    console.log(
      JSON.stringify(
        {
          passed: 4,
          seededBackgroundCountries: background.length,
          mappedBackgroundFeatures: initialFeatures.size,
          cases: [
            "current-preset seeded summaries are available",
            "retired and wrong-preset data excluded",
            "forged macro data cannot promote a full country",
            "fresh preset cannot expose old aggregate data",
          ],
        },
        null,
        2
      )
    );
  } finally {
    try {
      await db.dropDatabase();
    } finally {
      await client.close();
      const { closeDb } = await import("../utils/db");
      await closeDb();
    }
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
