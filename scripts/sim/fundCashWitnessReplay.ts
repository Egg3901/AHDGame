/** Saved fund distributions and isolated fund-held bond continuation. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { BSON, MongoClient, ObjectId, type Document } from "mongodb";
import { processIndexFundDividendsBatch } from "../../src/lib/indexFunds/dividendPassThrough";
import { processBondTurn } from "../../src/lib/turn/bondTurn";
import { collectBalances } from "../../src/lib/ledger/balanceSnapshot";
import { reconcileLedger } from "../../src/lib/ledger/reconcile";
import type { LedgerEntry } from "../../src/lib/ledger/types";

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
    assert.equal((await db.listCollections().toArray()).length, 0, "Target must be empty");
    const run = await source.collection("simRuns").findOne({ status: "completed" });
    const state = await source.collection("gameState").findOne({ _id: "current" } as Document);
    assert(state && run?.source?.executedCommit);
    const opening = await source
      .collection("balanceSnapshots")
      .findOne({ turn: state.currentTurn - 1 });
    const closing = await source
      .collection("balanceSnapshots")
      .findOne({ turn: state.currentTurn });
    const priceCheckpoint = await source
      .collection("balanceSnapshotCheckpoints")
      .findOne({ turn: state.currentTurn });
    assert(opening && closing && priceCheckpoint);
    const sourceDividends = await source
      .collection("indexFundTransactions")
      .find({
        kind: { $in: ["dividend_reinvest", "dividend_pass_through"] },
        createdAt: { $gt: opening.createdAt, $lte: closing.createdAt },
      })
      .sort({ _id: 1 })
      .toArray();
    // Reconstructed gross inputs: sum the saved retained and distributed cash
    // by issuer/fund. These are an explicit fixed-cohort fixture, not a replay
    // of the original corporation earnings calculation or original timestamps.
    const groups = new Map<
      string,
      { fundId: ObjectId; corporationId: ObjectId; amountAnchor: number; shares: number }
    >();
    for (const row of sourceDividends) {
      const key = `${row.fundId}:${row.corporationId}`;
      const group = groups.get(key) ?? {
        fundId: row.fundId,
        corporationId: row.corporationId,
        amountAnchor: 0,
        shares: row.shares,
      };
      group.amountAnchor += row.amountAnchor;
      groups.set(key, group);
    }
    const accruals = [...groups.values()].filter((a) => a.amountAnchor > 0);
    assert(accruals.length);
    const filters: Record<string, Document> = {
      indexFunds: {},
      indexFundPositions: {},
      gameState: { _id: "current" },
      exchangeRates: {},
      centralBanks: {},
      npps: {},
      characters: {},
      imperialCharacters: {},
      corporations: {},
      bonds: { matured: false, "holders.fundId": { $exists: true } },
    };
    const projections: Record<string, Document> = {
      npps: { _id: 1, countryId: 1, nppInvestmentCashAnchor: 1 },
      corporations: { _id: 1, name: 1 },
    };
    const readSource = () =>
      Promise.all(
        Object.entries(filters).map(
          async ([name, filter]) =>
            [
              name,
              await source
                .collection(name)
                .find(filter, { projection: projections[name] })
                .sort({ _id: 1 })
                .toArray(),
            ] as const
        )
      );
    const copied = await readSource(),
      sourceHash = hash(copied);
    const sourceBondTx = await source
      .collection("financialTxLog")
      .find({
        turn: state.currentTurn,
        subjectType: "fund",
        type: { $in: ["bond_coupon", "bond_maturity"] },
      })
      .toArray();
    const sourceLedger = await source
      .collection<LedgerEntry>("ledgerEntries")
      .find({ turn: state.currentTurn })
      .toArray();
    const sourceBonds = await source
      .collection("bonds")
      .find({ _id: { $in: sourceBondTx.map((row) => new ObjectId(row.meta.bondId)) } })
      .toArray();
    const bondById = new Map(sourceBonds.map((b) => [String(b._id), b]));
    let originalDivergent = 0,
      missingDividendWitness = 0,
      explainedCouponRounding = 0,
      maxUnexplained = 0;
    for (const fund of copied.find(([name]) => name === "indexFunds")![1]) {
      const account = `fund:${fund._id}:${fund.anchorCurrencyCode}`;
      const actual = (closing.balances[account] ?? 0) - (opening.balances[account] ?? 0);
      const logged = sourceLedger
        .flatMap((e) => e.legs)
        .filter((l) => l.role === "primary" && l.account === account)
        .reduce((n, l) => n + l.anchorAmount, 0);
      const retained = sourceDividends
        .filter((r) => String(r.fundId) === String(fund._id) && r.kind === "dividend_reinvest")
        .reduce((n, r) => n + r.amountAnchor, 0);
      let rawBond = 0,
        loggedBond = 0;
      for (const row of sourceBondTx.filter((r) => String(r.subjectId) === String(fund._id))) {
        const bond = bondById.get(row.meta.bondId)!;
        const rate: number = priceCheckpoint.anchorRates[bond.currencyCode];
        assert(Number.isFinite(rate) && rate > 0);
        rawBond +=
          ((row.type === "bond_coupon" ? ((row.meta.couponRate / 100) * 1000) / 48 : 1000) *
            row.meta.units) /
          rate;
        loggedBond += row.anchorAmount;
      }
      const rounding = Math.round(rawBond * 100) / 100 - loggedBond;
      if (Math.abs(actual - logged) >= 0.01) originalDivergent++;
      missingDividendWitness += retained;
      explainedCouponRounding += rounding;
      maxUnexplained = Math.max(maxUnexplained, Math.abs(actual - logged - retained - rounding));
    }
    assert(maxUnexplained < 1e-6);
    const historicalExplanation = {
      fundAccounts: copied.find(([name]) => name === "indexFunds")![1].length,
      originalDivergent,
      sourceBondRows: sourceBondTx.length,
      missingDividendWitness,
      explainedCouponRounding,
      maxUnexplained,
    };

    for (const [name, rows] of copied) {
      if (name === "bonds") continue;
      if (rows.length) await db.collection(name).insertMany(rows);
    }
    await db.collection("gameConfig").insertOne({ _id: "default", ledgerShadow: true } as Document);
    // Only the fund-holder boundary advances. Removing other holders/public
    // float prevents unrelated settlements from being mistaken for coverage.
    const fundBonds = copied
      .find(([name]) => name === "bonds")![1]
      .filter((b) => b.issuerType === "sovereign");
    assert(fundBonds.length > 0);
    const selectedBonds = fundBonds.map((b) => {
      const holders = b.holders.filter((h: Document) => h.fundId);
      return {
        ...b,
        holders,
        publicFloat: 0,
        totalIssued: holders.reduce((n: number, h: Document) => n + h.units, 0),
      };
    });
    await db.collection("bonds").insertMany(selectedBonds);
    const keepAccounts = (balances: Record<string, number>) =>
      Object.fromEntries(
        Object.entries(balances)
          .filter(([a]) => /^(fund|npp|character):/.test(a))
          .sort(([a], [b]) => a.localeCompare(b))
      );
    const steps = [];
    for (const phase of ["dividends", "fund_bonds"] as const) {
      const turn = state.currentTurn + (phase === "dividends" ? 1 : 2);
      const before = keepAccounts(await collectBalances(db));
      commands = 0;
      readBsonBytes = 0;
      measuring = true;
      if (phase === "dividends") await processIndexFundDividendsBatch(db, accruals, { turn });
      else await processBondTurn(turn);
      measuring = false;
      const performance = { commands, readBsonBytes };
      const after = keepAccounts(await collectBalances(db));
      const allEntries = await db.collection<LedgerEntry>("ledgerEntries").find({ turn }).toArray();
      // Filter only entries whose primary side belongs to the qualified cohort.
      const entries = allEntries.filter((e) =>
        e.legs.some((l) => l.role === "primary" && /^(fund|npp|character):/.test(l.account))
      );
      const report = reconcileLedger({
        turn,
        openingBalances: before,
        closingBalances: after,
        entries,
      });
      const changes = Object.keys(after).map((a) => after[a] - (before[a] ?? 0));
      const totalCashCredit = changes.reduce((s, n) => s + n, 0);
      const inputGross =
        phase === "dividends" ? accruals.reduce((s, a) => s + a.amountAnchor, 0) : null;
      // Existing dividend remainder rounding can differ by half a cent per
      // accrual. Pin that bound explicitly; the witness must match actual cash.
      if (inputGross !== null)
        assert(Math.abs(totalCashCredit - inputGross) <= accruals.length * 0.005 + 1e-5);
      if (!baseline) {
        assert.equal(report.stockVsFlow.divergentCount, 0, JSON.stringify(report.stockVsFlow));
        assert.equal(report.trialBalance.status, "green");
        assert.equal(report.unattributed.length, 0);
      }
      steps.push({
        phase,
        turn,
        performance,
        accounts: Object.keys(after).length,
        changedAccounts: changes.filter((n) => n !== 0).length,
        cashHash: hash(after),
        totalCashCredit,
        inputGross,
        grossRoundingResidual: inputGross === null ? null : totalCashCredit - inputGross,
        ledgerEntries: entries.length,
        divergences: report.stockVsFlow.divergentCount,
        trialBalance: report.trialBalance.status,
        unattributed: report.unattributed.length,
      });
      console.log(JSON.stringify(steps.at(-1)));
    }
    const finalSourceHash = hash(await readSource());
    assert.equal(finalSourceHash, sourceHash);
    assert(!dirty() || development);
    const result = {
      sourceCommit,
      development,
      baseline,
      source: {
        runId: String(run.runId ?? run._id),
        generatorCommit: run.source.executedCommit,
        savedTurn: state.currentTurn,
        sourceHash,
        finalSourceHash,
      },
      historicalExplanation,
      fixture: {
        sourceDividendRows: sourceDividends.length,
        reconstructedAccruals: accruals.length,
        funds: copied.find(([name]) => name === "indexFunds")![1].length,
        positions: copied.find(([name]) => name === "indexFundPositions")![1].length,
        isolatedSovereignBonds: selectedBonds.length,
      },
      steps,
    };
    writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
  } finally {
    await client.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
