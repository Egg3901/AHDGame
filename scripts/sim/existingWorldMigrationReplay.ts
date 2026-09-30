/** Bounded existing-world migration contract replay, with explicit legacy fixtures. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { MongoClient, type Document } from "mongodb";
import type { GameConfig } from "../../src/lib/db/types";
import { runMigrations } from "../../src/lib/migrations/runner";
import type { Migration } from "../../src/lib/migrations/types";
import { migration as configMigration } from "../../src/lib/migrations/entries/2026-08-08-adopt-reference-gameconfig-gates";
import { migration as campaignMigration } from "../../src/lib/migrations/entries/2026-08-18-campaign-ops-trees";
import { migration as shareMigration } from "../../src/lib/migrations/entries/2026-09-18-normalize-share-corporate-actions";
import { coreGameConfigUpdate } from "../../src/lib/admin/seed/coreGameConfigUpdate";
import { gameConfig as referenceConfig } from "../../src/lib/seeds/reference/gameConfig";
import { missingGameStateFlagDefaults } from "../../src/lib/seeds/reference/featureFlagDefaults";
import {
  getPreservedCollectionNames,
  getRuntimeCollectionNames,
} from "../../src/lib/admin/seed/seedManifest";

const arg = (name: string) =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function main() {
  const uri = process.env.SIM_MONGODB_URI,
    sourceName = arg("source"),
    targetName = arg("target"),
    output = arg("out");
  assert(uri && /^mongodb:\/\/(127\.0\.0\.1|localhost):27018\/?$/.test(uri));
  assert(sourceName && targetName && output && sourceName !== targetName);
  for (const name of [sourceName, targetName]) assert(/^ahd_sim_[a-zA-Z0-9_-]{1,64}$/.test(name));
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const clean = () =>
    assert.equal(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(), "");
  clean();
  const client = await new MongoClient(uri).connect();
  const source = client.db(sourceName),
    db = client.db(targetName);
  try {
    assert.equal((await db.listCollections().toArray()).length, 0);
    // Full singleton/marker/campaign cohorts; bounded ordinary trade-history sample.
    const names = ["gameConfig", "gameState", "migrationsRun", "campaigns", "shareTradeHistory"];
    const readSource = () =>
      Promise.all(
        names.map(
          async (name) =>
            [
              name,
              await source
                .collection(name)
                .find({})
                .sort({ _id: 1 })
                .limit(name === "shareTradeHistory" ? 128 : 0)
                .toArray(),
            ] as const
        )
      );
    const rows = await readSource(),
      sourceHash = hash(rows);
    for (const [name, documents] of rows)
      if (documents.length) await db.collection(name).insertMany(documents);
    const state = await source.collection("gameState").findOne({});
    const sourceRun = await source.collection("simRuns").findOne({ status: "completed" });
    const snapshot = async () =>
      Promise.all(
        (await db.listCollections().toArray())
          .map((c) => c.name)
          .sort()
          .map(async (name) => [
            name,
            await db.collection(name).find({}).sort({ _id: 1 }).toArray(),
          ])
      );
    const migrations = [configMigration, campaignMigration, shareMigration];
    // Explicit synthetic stale records ensure every selected repair has work.
    const fixtureCampaign = db.collection<Document & { _id: string }>("campaigns");
    await fixtureCampaign.insertOne({
      _id: "migration-fixture",
      funds: 731.25,
      fundraisingLevel: 7,
      fundraisingTree: { starter: true, a: 1, b: 2, c: 0 },
      groundGameLevel: 5,
    });
    const fixtureShares = db.collection<Document & { _id: string }>("shareTradeHistory");
    const structureChange = { sharesBefore: 100, sharesAfter: 200, ratio: 2 };
    await fixtureShares.insertOne({
      _id: "migration-fixture",
      kind: "stock_split",
      shares: 100,
      pricePerShareAnchor: 7,
      totalAnchor: 700,
      structureChange,
    });
    await db.collection("gameConfig").updateOne(
      {},
      {
        $unset: { campaignEraPriceLevelEnabled: "", nppCorpsAttackable: "" },
        $set: { ledgerShadow: false, startingFunds: 777, migrationFixtureSentinel: "keep" },
      }
    );
    await db.collection("gameState").updateOne({}, { $set: { currentTurn: 500 } });
    await db
      .collection("migrationsRun")
      .deleteMany({ _id: { $in: migrations.map((m) => m.id) } } as Document);
    const before = hash(await snapshot());
    const preview = await runMigrations(db, { migrations, dryRun: true });
    assert.equal(hash(await snapshot()), before, "preview changed documents or markers");
    const applied = await runMigrations(db, { migrations, dryRun: false });
    assert.equal(applied.ranIds.length, 3);
    const config = await db.collection("gameConfig").findOne({});
    assert(config);
    assert.equal(config.campaignEraPriceLevelEnabled, undefined);
    assert.equal(config.ledgerShadow, false);
    assert.equal(config.startingFunds, 777);
    assert.equal(config.migrationFixtureSentinel, "keep");
    assert.equal(config.nppCorpsAttackable, referenceConfig.nppCorpsAttackable);
    const campaign = await fixtureCampaign.findOne({ _id: "migration-fixture" });
    assert.equal(campaign?.funds, 731.25);
    assert.deepEqual(campaign?.fundraisingTree, { starter: true, a: 1, b: 2, c: 0 });
    assert.deepEqual(campaign?.groundGameTree, { starter: true, a: 3, b: 1, c: 0 });
    const share = await fixtureShares.findOne({ _id: "migration-fixture" });
    assert.deepEqual([share?.shares, share?.pricePerShareAnchor, share?.totalAnchor], [0, 0, 0]);
    assert.deepEqual(share?.structureChange, structureChange);
    const appliedHash = hash(await snapshot());
    const skipped = await runMigrations(db, { migrations, dryRun: false });
    assert.equal(skipped.skippedIds.length, 3);
    assert.equal(hash(await snapshot()), appliedHash, "marked retry changed state");
    const dataSnapshot = async () =>
      (await snapshot()).filter(([name]) => name !== "migrationsRun");
    const dataHash = hash(await dataSnapshot());
    await runMigrations(db, {
      migrations,
      only: migrations.map((m) => m.id),
      force: true,
      dryRun: false,
    });
    assert.equal(
      hash(await dataSnapshot()),
      dataHash,
      "forced idempotent retry changed world state"
    );
    const unsafe: Migration = {
      id: "unsafe-fixture",
      description: "Must never execute",
      idempotent: false,
      execute: async () => {
        throw new Error("unsafe executed");
      },
    };
    const guardHash = hash(await snapshot());
    for (const options of [
      { only: [configMigration.id, unsafe.id], force: true },
      { only: [configMigration.id, "unknown-fixture"] },
      { only: [] },
      { force: true },
    ]) {
      await assert.rejects(
        runMigrations(db, { migrations: [...migrations, unsafe], dryRun: false, ...options }),
        /Cannot force|Unknown|requires/
      );
      assert.equal(hash(await snapshot()), guardHash);
    }
    const configs = db.collection<GameConfig>("gameConfig");
    const flagCases = [];
    for (const turn of [2, 500])
      for (const value of [undefined, false, true]) {
        const legacy: GameConfig & { migrationFixtureSentinel: string } = {
          ...referenceConfig,
          migrationFixtureSentinel: "keep",
        };
        if (value === undefined) delete legacy.campaignEraPriceLevelEnabled;
        else legacy.campaignEraPriceLevelEnabled = value;
        await configs.replaceOne({ _id: referenceConfig._id }, legacy);
        await db.collection("gameState").updateOne({}, { $set: { currentTurn: turn } });
        await configMigration.execute(db, { dryRun: false });
        assert.equal(
          (await configs.findOne({ _id: referenceConfig._id }))?.campaignEraPriceLevelEnabled,
          value
        );
        await configs.updateOne({ _id: referenceConfig._id }, coreGameConfigUpdate(false, 1991));
        assert.equal(
          (await configs.findOne({ _id: referenceConfig._id }))?.campaignEraPriceLevelEnabled,
          value
        );
        await configs.updateOne({ _id: referenceConfig._id }, coreGameConfigUpdate(true, 1991));
        assert.equal(
          (await configs.findOne({ _id: referenceConfig._id }))?.campaignEraPriceLevelEnabled,
          true
        );
        assert.equal(
          (
            await db
              .collection<GameConfig & { migrationFixtureSentinel: string }>("gameConfig")
              .findOne({ _id: referenceConfig._id })
          )?.migrationFixtureSentinel,
          "keep"
        );
        flagCases.push({
          turn,
          legacyFlag: value ?? "absent",
          migrationAndTopUpPreserved: true,
          resetEnabled: true,
        });
      }
    await configs.deleteOne({ _id: referenceConfig._id });
    await configs.updateOne({ _id: referenceConfig._id }, coreGameConfigUpdate(false, 1991), {
      upsert: true,
    });
    assert.equal(
      (await configs.findOne({ _id: referenceConfig._id }))?.campaignEraPriceLevelEnabled,
      true
    );
    const defaults = missingGameStateFlagDefaults({
      nppAutonomyEnabled: false,
      livingConflictsEnabled: false,
    });
    assert(
      !("nppAutonomyLevel" in defaults) &&
        !("nppAutonomyEnabled" in defaults) &&
        !("livingConflictsEnabled" in defaults)
    );
    assert(getPreservedCollectionNames().includes("migrationsRun"));
    assert(!getRuntimeCollectionNames().includes("gameConfig"));
    const finalSourceHash = hash(await readSource());
    assert.equal(finalSourceHash, sourceHash);
    clean();
    const result = {
      sourceCommit,
      source: {
        runId: sourceRun?.runId,
        generatorCommit: sourceRun?.source?.executedCommit,
        savedTurn: state?.currentTurn,
        sourceHash,
        finalSourceHash,
      },
      copiedCohorts: rows.map(([name, documents]) => ({
        collection: name,
        count: documents.length,
      })),
      syntheticFixtures: [
        "one purchased and one legacy campaign lever with cash",
        "one stale split row",
        "retained config with absent gate and sentinel; target clock explicitly set to turn 500",
        "six explicit flag/age cases",
      ],
      preview: { ids: preview.ranIds, unchanged: true },
      applied: {
        ids: applied.ranIds,
        results: Object.fromEntries(
          Object.entries(applied.results).map(([id, result]) => [
            id,
            {
              documentsScanned: result.documentsScanned,
              documentsUpdated: result.documentsUpdated,
            },
          ])
        ),
      },
      markerRetryUnchanged: true,
      forcedRetryWorldDataUnchanged: true,
      rejectedSelectionsWithoutMutation: 4,
      campaignCashAndPurchasedBranchesPreserved: true,
      splitStructureMovementPreserved: true,
      flagCases,
      freshInsertEnabled: true,
      explicitGameStateFlagsPreserved: true,
      migrationMarkersClassifiedPreserved: true,
      scope:
        "Three selected real migrations, bounded retained cohorts and explicit stale fixtures. No full registry apply, full world reset, or gameplay turn is claimed. Source preservation covers exactly the copied cohorts.",
    };
    writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify(result));
  } finally {
    await client.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
