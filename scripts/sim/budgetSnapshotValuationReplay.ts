/** Actual snapshot/receipt comparison on retained native treasury balances. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { BSON, MongoClient, type Document } from "mongodb";
import {
  writeBalanceSnapshot,
  writePreForexBalanceCheckpoint,
} from "../../src/lib/ledger/balanceSnapshot";
import { reconcileTurn } from "../../src/lib/ledger/reconcile";
import { processTreasuryTurn } from "../../src/lib/turn/treasuryTurn";
const arg = (name: string) =>
  process.argv.find((s) => s.startsWith(`--${name}=`))?.slice(name.length + 3);
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
    assert(!execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim());
  clean();
  const baseline = process.argv.includes("--baseline");
  const client = await new MongoClient(uri, { monitorCommands: true }).connect();
  Object.assign(process.env, { NODE_ENV: "test", MONGODB_URI: uri, MONGODB_DB: targetName });
  global._mongoClientPromise = Promise.resolve(client);
  const source = client.db(sourceName),
    db = client.db(targetName);
  let measuring = false,
    commands = 0,
    readBsonBytes = 0;
  client.on("commandStarted", (e) => {
    if (measuring && e.databaseName === targetName) commands++;
  });
  client.on("commandSucceeded", (e) => {
    if (!measuring) return;
    const reply = e.reply as { cursor?: { firstBatch?: Document[]; nextBatch?: Document[] } };
    for (const row of reply.cursor?.firstBatch ?? reply.cursor?.nextBatch ?? [])
      readBsonBytes += BSON.calculateObjectSize(row);
  });
  try {
    assert.equal((await db.listCollections().toArray()).length, 0);
    const names = ["federalBudget", "exchangeRates", "gameState", "centralBanks"];
    const readSource = () =>
      Promise.all(
        names.map(
          async (name) =>
            [name, await source.collection(name).find({}).sort({ _id: 1 }).toArray()] as const
        )
      );
    const copied = await readSource(),
      sourceHash = hash(copied);
    for (const [name, rows] of copied) if (rows.length) await db.collection(name).insertMany(rows);
    await db.collection("gameConfig").insertOne({ _id: "default", ledgerShadow: true } as Document);
    const sourceRun = await source.collection("simRuns").findOne({ status: "completed" });
    const state = copied
      .find(([name]) => name === "gameState")![1]
      .find((r) => String(r._id) === "current")!;
    const turn = state.currentTurn + 1;
    const fxHash = hash(copied.find(([name]) => name === "exchangeRates")![1]);
    const native = async () =>
      (await db.collection("federalBudget").find({}).sort({ countryId: 1 }).toArray()).map((b) => ({
        countryId: b.countryId,
        currency: b.currencyCode,
        cash: b.treasuryBalance,
      }));
    const openingNative = await native();
    commands = 0;
    readBsonBytes = 0;
    measuring = true;
    await writeBalanceSnapshot(db, turn - 1);
    measuring = false;
    const snapshotPerformance = { commands, readBsonBytes };
    assert.deepEqual(await native(), openingNative);
    await processTreasuryTurn(turn);
    await writePreForexBalanceCheckpoint(db, turn);
    await writeBalanceSnapshot(db, turn);
    const report = await reconcileTurn(db, turn);
    assert(report);
    if (!baseline)
      assert.equal(report.stockVsFlow.divergentCount, 0, JSON.stringify(report.stockVsFlow));
    assert.equal(report.trialBalance.status, "green");
    assert.equal(report.unattributed.length, 0);
    const closingNative = await native();
    assert.equal(
      hash(await db.collection("exchangeRates").find({}).sort({ _id: 1 }).toArray()),
      fxHash
    );
    const finalSourceHash = hash(await readSource());
    assert.equal(sourceHash, finalSourceHash);
    clean();
    const result = {
      sourceCommit,
      baseline,
      source: {
        runId: String(sourceRun!.runId),
        generatorCommit: sourceRun!.source.executedCommit,
        savedTurn: state.currentTurn,
        sourceHash,
        finalSourceHash,
      },
      budgets: openingNative.length,
      snapshotPerformance,
      openingNativeHash: hash(openingNative),
      closingNativeHash: hash(closingNative),
      exchangeRatesUnchanged: true,
      divergences: report.stockVsFlow.divergentCount,
      trialBalance: report.trialBalance.status,
      unattributed: report.unattributed.length,
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
