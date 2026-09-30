/** Retained fiscal-phase qualification; no claim of whole-economy acceptance. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { BSON, MongoClient, type Document } from "mongodb";
import { processTreasuryTurn } from "../../src/lib/turn/treasuryTurn";
import { reconcileLedger } from "../../src/lib/ledger/reconcile";
import { emitBondTurnLedger } from "../../src/lib/turn/bondTurnLedger";
import type { LedgerEntry } from "../../src/lib/ledger/types";
import type { FederalBudget } from "../../src/lib/db/types/budget";
import {
  COUNTRY_CURRENCY_MAP,
  FOREX_ACTIVE_COUNTRIES,
  eraRateForCurrency,
} from "../../src/lib/constants/currencies";
import type { CountryId } from "../../src/lib/constants/countries";

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
    const filters: Record<string, Document> = {
      gameState: { _id: "current" },
      federalBudget: {},
      centralBanks: {},
      exchangeRates: {},
      countryGameStates: {},
      organizationMemberships: {},
    };
    const readSource = () =>
      Promise.all(
        Object.entries(filters).map(
          async ([name, filter]) =>
            [name, await source.collection(name).find(filter).sort({ _id: 1 }).toArray()] as const
        )
      );
    const saved = await readSource();
    const sourceHash = hash(saved);
    for (const [name, rows] of saved) if (rows.length) await db.collection(name).insertMany(rows);
    await db.collection("gameConfig").insertOne({ _id: "default", ledgerShadow: true } as Document);
    const state = saved.find(([name]) => name === "gameState")![1][0];
    const startTurn = Number(state.currentTurn) + 1;
    const latestInventory = await source
      .collection("ledgerReconciliations")
      .find(
        {},
        {
          projection: {
            _id: 0,
            turn: 1,
            bankingMode: 1,
            "stockVsFlow.byKind": 1,
            "stockVsFlow.divergentCount": 1,
          },
        }
      )
      .sort({ turn: -1 })
      .limit(1)
      .next();
    const rates = new Map(
      saved
        .find(([name]) => name === "exchangeRates")![1]
        .map((r) => [String(r.currencyCode), Number(r.rate)])
    );
    const budgets = () =>
      db.collection<FederalBudget>("federalBudget").find({}).sort({ _id: 1 }).toArray();
    const savedBudgets = saved.find(([name]) => name === "federalBudget")![1];
    const valuationFixture = arg("valuation-fixture");
    assert(
      !valuationFixture || baseline,
      "Only the control may import treatment valuation denominators"
    );
    const pinnedValuation = valuationFixture
      ? (JSON.parse(readFileSync(valuationFixture, "utf8")) as {
          sourceCommit: string;
          authoredBudgetValuations: { currencyCode: string; rate: number }[];
        })
      : undefined;
    const authoredBudgetValuations: Document[] = [];
    for (const b of savedBudgets) {
      const countryId = String(b.countryId) as CountryId;
      const currencyCode = String(
        b.currencyCode
      ) as import("../../src/lib/constants/currencies").CurrencyCode;
      if (
        !rates.has(currencyCode) &&
        !FOREX_ACTIVE_COUNTRIES.includes(countryId) &&
        COUNTRY_CURRENCY_MAP[countryId] === currencyCode
      ) {
        const rate =
          eraRateForCurrency(currencyCode, String(state.preset)) ??
          pinnedValuation?.authoredBudgetValuations.find((v) => v.currencyCode === currencyCode)
            ?.rate;
        assert(rate && Number.isFinite(rate) && rate > 0);
        rates.set(currencyCode, rate);
        authoredBudgetValuations.push({
          countryId,
          currencyCode,
          rate,
          source: "authored_budget_only",
          preset: state.preset,
        });
      }
    }

    const excludedUnpricedBudgets = savedBudgets
      .filter((b) => {
        const rate = rates.get(String(b.currencyCode));
        return rate === undefined || !Number.isFinite(rate) || rate <= 0;
      })
      .map((b) => ({ countryId: String(b.countryId), currencyCode: String(b.currencyCode) }));
    const pricedCountries = new Set(
      savedBudgets
        .map((b) => String(b.countryId))
        .filter((id) => !excludedUnpricedBudgets.some((b) => b.countryId === id))
    );
    async function selectFiscalCohort(extraCountry?: string) {
      for (const name of ["federalBudget", "centralBanks"]) {
        await db.collection(name).deleteMany({});
        const rows = saved
          .find(([collection]) => collection === name)![1]
          .filter((b) => pricedCountries.has(String(b.countryId)) || b.countryId === extraCountry);
        if (rows.length) await db.collection(name).insertMany(rows);
      }
    }
    const invalidFxRejections: Document[] = [];
    if (!baseline)
      for (const invalid of [
        { countryId: "US", currencyCode: "USD", mode: "missing" },
        { countryId: "BG", currencyCode: "BGL", mode: "corrupt" },
      ]) {
        await selectFiscalCohort();
        const savedRates = saved.find(([name]) => name === "exchangeRates")![1];
        await db.collection("exchangeRates").deleteMany({});
        await db
          .collection("exchangeRates")
          .insertMany(savedRates.filter((r) => r.currencyCode !== invalid.currencyCode));
        if (invalid.mode === "corrupt")
          await db
            .collection("exchangeRates")
            .insertOne({ currencyCode: invalid.currencyCode, rate: 0 });
        const before = hash(await budgets());
        await assert.rejects(
          processTreasuryTurn(startTurn),
          new RegExp(`exchange rate for ${invalid.currencyCode}`)
        );
        assert.equal(
          hash(await budgets()),
          before,
          "Invalid FX must not partially advance another treasury"
        );
        assert.equal(await db.collection("ledgerEntries").countDocuments({}), 0);
        invalidFxRejections.push({ ...invalid, rejected: true, allTreasuriesUnchanged: true });
      }
    await db.collection("exchangeRates").deleteMany({});
    await db
      .collection("exchangeRates")
      .insertMany(saved.find(([name]) => name === "exchangeRates")![1]);
    await selectFiscalCohort();
    const balances = (rows: FederalBudget[]) =>
      Object.fromEntries(
        rows.map((b) => {
          const currency =
            b.currencyCode ?? COUNTRY_CURRENCY_MAP[b.countryId as CountryId] ?? "USD";
          return [
            `government:${b.countryId}:${currency}`,
            Number(b.treasuryBalance ?? 0) / rates.get(currency)!,
          ];
        })
      );
    const results: Document[] = [];
    for (let turn = startTurn; turn < startTurn + 12; turn++) {
      const opening = await budgets();
      await db
        .collection("gameState")
        .updateOne({ _id: "current" } as Document, { $set: { currentTurn: turn } });
      commands = 0;
      readBsonBytes = 0;
      measuring = true;
      let phase;
      try {
        phase = await processTreasuryTurn(turn);
      } finally {
        measuring = false;
      }
      const perf = { commands, readBsonBytes };
      const closing = await budgets();
      const entries = await db.collection<LedgerEntry>("ledgerEntries").find({ turn }).toArray();
      const report = reconcileLedger({
        turn,
        entries,
        openingBalances: balances(opening),
        closingBalances: balances(closing),
      });
      if (!baseline) {
        assert.equal(report.stockVsFlow.divergentCount, 0);
        assert.equal(report.trialBalance.status, "green");
        assert.equal(report.unattributed.length, 0);
        const beforeRetry = hash(closing);
        await processTreasuryTurn(turn);
        assert.equal(hash(await budgets()), beforeRetry);
        assert.equal(await db.collection("ledgerEntries").countDocuments({ turn }), entries.length);
      }
      results.push({
        turn,
        countriesProcessed: phase.countriesProcessed,
        performance: perf,
        stockVsFlow: report.stockVsFlow,
        trialBalance: report.trialBalance,
        moneySupply: report.moneySupply,
        unattributed: report.unattributed,
        closingCash: Object.fromEntries(closing.map((b) => [b.countryId, b.treasuryBalance])),
      });
    }
    // Exercise the actual bond ledger emitter with an explicitly synthetic
    // service statistic. It must not claim a second treasury cash debit.
    const lastTurn = startTurn + 11;
    const beforeTelemetry = await budgets();
    const priorCount = await db.collection("ledgerEntries").countDocuments({ turn: lastTurn });
    await emitBondTurnLedger({
      db,
      txBondEntries: [],
      govCouponByCountry: new Map([["US", { total: 1234, currency: "USD" }]]),
      turn: lastTurn,
      now: new Date("2026-09-30T00:00:00Z"),
    });
    assert.equal(hash(await budgets()), hash(beforeTelemetry));
    const addedLedgerEntries =
      (await db.collection("ledgerEntries").countDocuments({ turn: lastTurn })) - priorCount;
    if (!baseline) assert.equal(addedLedgerEntries, 0);
    assert.equal(hash(await readSource()), sourceHash);
    assert(!dirty() || development);
    const report = {
      sourceCommit,
      sourceDirty: dirty(),
      baseline,
      retainedRun: {
        id: run.runId ?? String(run._id),
        sourceCommit: run.source.executedCommit,
        savedTurn: state.currentTurn,
      },
      sourceHash,
      sourcePreserved: true,
      scope:
        "Twelve real treasury phases over all 23 retained budgets: 17 observed FX and six explicitly budget-only authored era valuations. Missing active USD and corrupt explicit BGL rates are separate whole-cohort rejection fixtures. Other economic phases held fixed. Explicit synthetic bond-service statistic only for emitter ownership. No authoritative whole-economy gate.",
      latestInventory,
      pricedCountries: [...pricedCountries].sort(),
      excludedUnpricedBudgets,
      authoredBudgetValuations,
      valuationFixtureSourceCommit: pinnedValuation?.sourceCommit ?? null,
      invalidFxRejections,
      results,
      telemetry: { syntheticCouponStatistic: 1234, addedLedgerEntries },
    };
    writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
    console.log(
      JSON.stringify({
        sourceCommit,
        turns: results.length,
        maximumDivergentAccounts: Math.max(...results.map((r) => r.stockVsFlow.divergentCount)),
        sourcePreserved: true,
      })
    );
  } finally {
    await client.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
