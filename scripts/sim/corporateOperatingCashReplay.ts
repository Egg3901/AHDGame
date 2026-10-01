/** Retained corporate cash-writer continuation, not a whole-economy run. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { BSON, MongoClient, type Document, type AnyBulkWriteOperation } from "mongodb";
import { buildCorporationLookups } from "../../src/lib/turn/corporation/buildLookups";
import { processSectors } from "../../src/lib/turn/corporation/sectorCalculations";
import { emitCorporationTurnTx } from "../../src/lib/turn/corporation/corporationTurnPhases";
import { reconcileLedger } from "../../src/lib/ledger/reconcile";
import type { LedgerEntry } from "../../src/lib/ledger/types";
import type { Corporation, CorporateSector } from "../../src/lib/db/types";

const arg = (name: string) =>
  process.argv.find((s) => s.startsWith(`--${name}=`))?.slice(name.length + 3);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function main() {
  const uri = process.env.SIM_MONGODB_URI;
  const sourceName = arg("source"),
    targetName = arg("target"),
    output = arg("out");
  assert(uri && /^mongodb:\/\/(127\.0\.0\.1|localhost):27018\/?$/.test(uri));
  assert(sourceName && targetName && output && sourceName !== targetName);
  for (const name of [sourceName, targetName]) assert(/^ahd_sim_[a-zA-Z0-9_-]{1,64}$/.test(name));
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = () =>
    Boolean(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim());
  const development = process.argv.includes("--development"),
    baseline = process.argv.includes("--baseline");
  assert(!dirty() || development);
  const client = await new MongoClient(uri, { monitorCommands: true }).connect();
  const source = client.db(sourceName),
    db = client.db(targetName);
  Object.assign(process.env, { NODE_ENV: "test", MONGODB_URI: uri, MONGODB_DB: targetName });
  global._mongoClientPromise = Promise.resolve(client);
  let commands = 0,
    readBsonBytes = 0,
    measuring = false;
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
    assert.equal((await db.listCollections().toArray()).length, 0, "Target must be empty");
    const run = await source.collection("simRuns").findOne({ status: "completed" });
    assert(run?.source?.executedCommit);
    const state = await source.collection("gameState").findOne({ _id: "current" } as Document);
    assert(state);
    const history = await source
      .collection("corporationHistory")
      .find({ turn: state.currentTurn, income: { $lt: 0 } })
      .sort({ corporationId: 1 })
      .toArray();
    const ids = history.map((h) => h.corporationId);
    assert(ids.length > 0);
    const filters: Record<string, Document> = {
      corporations: { _id: { $in: ids } },
      corporateSectors: { corporationId: { $in: ids } },
      gameState: { _id: "current" },
      exchangeRates: {},
      centralBanks: {},
      federalBudget: {},
      stateBudgets: {},
      states: {},
      politicalMetrics: {},
      regionRuntimeMetrics: {},
      commodityPrices: {},
      stateResourceCapacity: {},
      tariffs: {},
      subsidies: {},
      unownedSectors: {},
      organizationMemberships: {},
      tradeEmbargoes: {},
      extractionContracts: {},
      resourceDepletion: {},
      crises: { status: "active" },
      bonds: { matured: false },
      imfFacilities: {},
      tradeFlowSnapshots: { turn: state.currentTurn },
    };
    const readSource = () =>
      Promise.all(
        Object.entries(filters).map(
          async ([name, filter]) =>
            [name, await source.collection(name).find(filter).sort({ _id: 1 }).toArray()] as const
        )
      );
    const saved = await readSource(),
      sourceHash = hash(saved);
    for (const [name, rows] of saved) if (rows.length) await db.collection(name).insertMany(rows);
    await db.collection("gameConfig").insertOne({ _id: "default", ledgerShadow: true } as Document);
    const rateMap = new Map(
      saved
        .find(([name]) => name === "exchangeRates")![1]
        .map((r) => [String(r.currencyCode), Number(r.rate)])
    );
    const currencies = new Set<string>();
    for (const corp of saved.find(([name]) => name === "corporations")![1]) {
      const code = String(corp.liquidCurrencyCode),
        rate = rateMap.get(code);
      assert(rate && Number.isFinite(rate) && rate > 0, `Unpriced retained currency ${code}`);
      currencies.add(code);
    }
    const balances = async () =>
      Object.fromEntries(
        (await db.collection<Corporation>("corporations").find({}).toArray()).map((c) => [
          `corporation:${c._id}:${c.liquidCurrencyCode}`,
          c.liquidCapital / rateMap.get(String(c.liquidCurrencyCode))!,
        ])
      );
    const rows = [];
    for (let offset = 1; offset <= 12; offset++) {
      const turn = Number(state.currentTurn) + offset;
      await db
        .collection("gameState")
        .updateOne({ _id: "current" } as Document, { $set: { currentTurn: turn } });
      const opening = await balances();
      commands = 0;
      readBsonBytes = 0;
      measuring = true;
      const lookups = await buildCorporationLookups(db, { productionTurn: turn });
      const now = new Date("2026-01-01T00:00:00Z");
      const result = processSectors(lookups, turn, now);
      if (result.sectorOps.length)
        await db
          .collection<CorporateSector>("corporateSectors")
          .bulkWrite(result.sectorOps as AnyBulkWriteOperation<CorporateSector>[]);
      if (result.corpOps.length)
        await db.collection<Corporation>("corporations").bulkWrite(result.corpOps);
      await emitCorporationTurnTx({
        db,
        lookups,
        ...result,
        dividendTaxPaidByCountry: new Map(),
        turn,
        now,
        thresholds: {},
      });
      measuring = false;
      const perf = { commands, readBsonBytes };
      const closing = await balances();
      const entries = (
        await db.collection<LedgerEntry>("ledgerEntries").find({ turn }).toArray()
      ).filter((e) =>
        e.legs.some((l) => l.role === "primary" && l.account.startsWith("corporation:"))
      );
      const report = reconcileLedger({
        turn,
        openingBalances: opening,
        closingBalances: closing,
        entries,
      });
      const lossCount = result.corpSnapshots.filter(
        (s) => s.income + s.federalTaxPaid + s.stateTaxPaid < 0
      ).length;
      const row = {
        turn,
        corporations: lookups.corporations.length,
        sectors: result.sectorsProcessed,
        lossCount,
        divergentCount: report.stockVsFlow.divergentCount,
        absDivergence: report.stockVsFlow.byKind.reduce((sum, k) => sum + k.absDivergence, 0),
        trialBalance: report.trialBalance.status,
        unattributed: report.unattributed,
        perf,
        openingTotalAnchor: Object.values(opening).reduce((sum, v) => sum + v, 0),
        closingTotalAnchor: Object.values(closing).reduce((sum, v) => sum + v, 0),
        closingCorporateCashHash: hash(closing),
      };
      rows.push(row);
      console.log(JSON.stringify(row));
      if (!baseline) {
        assert.equal(report.stockVsFlow.divergentCount, 0, JSON.stringify(report.stockVsFlow));
        assert.equal(report.trialBalance.status, "green");
        assert.deepEqual(report.unattributed, []);
      }
    }
    assert(
      rows.some((r) => r.lossCount > 0),
      "Fixture must incur real operating losses"
    );
    const preserved = sourceHash === hash(await readSource());
    assert(preserved);
    assert(!dirty() || development);
    writeFileSync(
      output,
      JSON.stringify(
        {
          sourceCommit,
          development,
          baseline,
          retainedRunId: run.runId ?? run._id,
          retainedExecutedCommit: run.source.executedCommit,
          retainedSavedTurn: state.currentTurn,
          sourceHash,
          sourcePreserved: preserved,
          cohortSelection:
            "Corporations with negative saved income on the retained final turn; all their sectors",
          currencies: [...currencies].sort(),
          copiedCollections: saved.map(([name, docs]) => ({ name, count: docs.length })),
          scope:
            "Real lookup builder, sector cash operations and transaction emitter; legacy sector host defaults; retained external context fixed. Character, government, market-clearing and other full-turn phases excluded from corporate account reconciliation.",
          rows,
        },
        null,
        2
      ) + "\n"
    );
  } finally {
    await client.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
