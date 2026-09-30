/**
 * Source-pinned sovereign primary settlement qualification in an isolated copy.
 * Retained budgets and currency context are real; liquidity, offers and fault
 * injection are explicit fixtures. This is not a whole-economy closure gate.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { BSON, MongoClient, ObjectId, type Db, type Document } from "mongodb";
import {
  issueAdminSovereignBondSeries,
  issueScheduledSovereignBondSeries,
} from "../../src/lib/bonds/sovereign";
import { placeUnsoldBondUnits } from "../../src/lib/bonds/primaryMarket";
import { resumeSettlement } from "../../src/lib/banking/settlementJournal";
import { collectBalances } from "../../src/lib/ledger/balanceSnapshot";
import { reconcileLedger } from "../../src/lib/ledger/reconcile";
import type { LedgerEntry } from "../../src/lib/ledger/types";

const arg = (name: string) =>
  process.argv.find((s) => s.startsWith(`--${name}=`))?.slice(name.length + 3);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const countries = ["US", "UK", "DE", "JP", "IE"];
const now = new Date("2026-09-30T00:00:00Z");
const near = (actual: number, expected: number) =>
  assert(
    Math.abs(actual - expected) <= Math.max(0.02, Math.abs(expected) * 1e-9),
    `${actual} != ${expected}`
  );
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
  assert(!dirty() || process.argv.includes("--development"));
  const baseline = process.argv.includes("--baseline");
  const client = await new MongoClient(uri, { monitorCommands: true }).connect();
  const source = client.db(sourceName),
    db = client.db(targetName);
  Object.assign(process.env, { NODE_ENV: "test", MONGODB_URI: uri, MONGODB_DB: targetName });
  global._mongoClientPromise = Promise.resolve(client);
  let commands = 0,
    readBsonBytes = 0,
    measuring = false;
  const performance: Document[] = [];
  client.on("commandStarted", (e) => {
    if (measuring && e.databaseName === targetName) commands++;
  });
  client.on("commandSucceeded", (e) => {
    if (!measuring) return;
    const reply = e.reply as { cursor?: { firstBatch?: Document[]; nextBatch?: Document[] } };
    for (const row of reply.cursor?.firstBatch ?? reply.cursor?.nextBatch ?? [])
      readBsonBytes += BSON.calculateObjectSize(row);
  });
  async function measure<T>(label: string, fn: () => Promise<T>) {
    commands = 0;
    readBsonBytes = 0;
    measuring = true;
    try {
      return await fn();
    } finally {
      performance.push({ label, commands, readBsonBytes });
      measuring = false;
    }
  }
  try {
    assert.equal((await db.listCollections().toArray()).length, 0, "Target must be empty");
    const run = await source.collection("simRuns").findOne({ status: "completed" });
    assert(run?.source?.executedCommit);
    const filters: Record<string, Document> = {
      gameState: { _id: "current" },
      federalBudget: { countryId: { $in: countries } },
      centralBanks: { countryId: { $in: countries } },
      exchangeRates: {},
      bondMarketPools: {},
      countryGameStates: {},
      bonds: { issuerType: "sovereign", countryId: { $in: countries } },
      corporations: { countryOwnerId: { $in: countries } },
    };
    const saved = await Promise.all(
      Object.entries(filters).map(
        async ([name, filter]) =>
          [name, await source.collection(name).find(filter).sort({ _id: 1 }).toArray()] as const
      )
    );
    const sourceHash = hash(saved);
    const sourceTurn = Number(saved.find(([name]) => name === "gameState")![1][0].currentTurn);
    const turn = Math.ceil((sourceTurn + 1) / 12) * 12;
    const results: Document[] = [];
    async function reset() {
      for (const { name } of await db.listCollections().toArray())
        await db.collection(name).deleteMany({});
      for (const [name, rows] of saved) if (rows.length) await db.collection(name).insertMany(rows);
      await db.collection("gameConfig").insertOne({ _id: "default" as never, ledgerShadow: true });
      // External recipients and player configuration are never copied.
      await db
        .collection("centralBanks")
        .updateMany({}, { $unset: { chairCharacterId: "", governorCharacterId: "" } });
    }
    async function observed() {
      const budgets = await db.collection("federalBudget").find({}).toArray();
      const pools = await db.collection("bondMarketPools").find({}).toArray();
      const cash: Record<string, number> = {};
      for (const b of budgets)
        cash[b.currencyCode] = (cash[b.currencyCode] ?? 0) + Number(b.treasuryBalance ?? 0);
      for (const p of pools)
        cash[String(p._id)] = (cash[String(p._id)] ?? 0) + Number(p.cashLocal ?? 0);
      const principalByCountry = Object.fromEntries(
        budgets.map((b) => [b.countryId, Number(b.debt.principal)])
      );
      const faceByCountry: Record<string, number> = {};
      for (const bond of await db
        .collection("bonds")
        .find({ issuerType: "sovereign", matured: false, defaulted: false })
        .toArray()) {
        faceByCountry[bond.countryId] =
          (faceByCountry[bond.countryId] ?? 0) + Number(bond.totalIssued ?? 0);
      }
      return { cash, principalByCountry, faceByCountry, balances: await collectBalances(db) };
    }
    async function check(
      label: string,
      before: Awaited<ReturnType<typeof observed>>,
      checkTurn: number
    ) {
      const after = await observed();
      const moves = await db.collection("bankMoneyMoves").find({ turn: checkTurn }).toArray();
      const minted: Record<string, number> = {};
      for (const move of moves)
        for (const row of move.legs ?? []) {
          if (row.kind === "mint")
            minted[move.currency] = (minted[move.currency] ?? 0) + Number(row.amount);
        }
      const principalDeltaByCountry = Object.fromEntries(
        Object.keys(before.principalByCountry).map((country) => [
          country,
          after.principalByCountry[country] - before.principalByCountry[country],
        ])
      );
      if (!baseline)
        for (const [country, delta] of Object.entries(principalDeltaByCountry)) {
          near(delta, (after.faceByCountry[country] ?? 0) - (before.faceByCountry[country] ?? 0));
        }
      const cashResiduals = Object.fromEntries(
        Object.keys(before.cash).map((c) => [c, after.cash[c] - before.cash[c] - (minted[c] ?? 0)])
      );
      const entries = await db
        .collection<LedgerEntry>("ledgerEntries")
        .find({ turn: checkTurn })
        .toArray();
      const report = reconcileLedger({
        turn: checkTurn,
        entries,
        openingBalances: before.balances,
        closingBalances: after.balances,
      });
      if (!baseline) {
        for (const residual of Object.values(cashResiduals)) near(residual, 0);
        assert.equal(report.trialBalance.unbalancedCount, 0);
        assert.equal(report.stockVsFlow.divergentCount, 0);
        assert.equal(report.unattributed.length, 0);
        for (const move of moves) assert.equal(move.status, "applied");
      }
      return {
        label,
        cashResiduals,
        minted,
        journalCount: moves.length,
        ledgerCount: entries.length,
        trialBalance: report.trialBalance,
        stockVsFlow: report.stockVsFlow,
        unattributed: report.unattributed,
        principalDeltaByCountry,
      };
    }
    await reset();
    const before = await observed();
    await measure("retainedFiveCountryScheduled", () =>
      issueScheduledSovereignBondSeries(db, turn, now)
    );
    results.push(await check("retained_five_country_scheduled", before, turn));
    if (!baseline) {
      for (const scenario of [
        "admin",
        "partial",
        "unfunded",
        "monetary",
        "retry_after_credit",
        "twelve_turn_cohort",
      ]) {
        await reset();
        // Explicit financing fixture: keep the retained US budget, but isolate
        // its new offers and choose the buyer liquidity/central-bank policy.
        await db.collection("federalBudget").deleteMany({ countryId: { $ne: "US" } });
        await db.collection("bonds").deleteMany({});
        await db.collection("centralBanks").updateMany({}, { $set: { chairMode: "player" } });
        await db
          .collection("bondMarketPools")
          .updateOne(
            { _id: "USD" as never },
            {
              $set: {
                cashLocal:
                  scenario === "unfunded" || scenario === "monetary"
                    ? 0
                    : scenario === "partial"
                      ? 5000
                      : 1_000_000,
              },
            }
          );
        if (scenario === "monetary")
          await db
            .collection("centralBanks")
            .updateOne({ _id: "US" as never }, { $set: { chairMode: "npp" } });
        const days = scenario === "twelve_turn_cohort" ? 12 : 1;
        for (let offset = 0; offset < days; offset++) {
          const currentTurn = turn + offset;
          const opening = await observed();
          const args = {
            countryId: "US" as const,
            turn: currentTurn,
            now,
            faceValue: 10000,
            useQuarterDeficit: false,
          };
          let callDb = db;
          if (scenario === "retry_after_credit") {
            let armed = true;
            callDb = new Proxy(db, {
              get(target, property) {
                if (property !== "collection") {
                  const value = Reflect.get(target, property);
                  return typeof value === "function" ? value.bind(target) : value;
                }
                return (name: string) => {
                  const collection = target.collection(name);
                  return new Proxy(collection, {
                    get(coll, method) {
                      const value = Reflect.get(coll, method);
                      if (name === "federalBudget" && method === "updateOne")
                        return async (...args: Parameters<typeof collection.updateOne>) => {
                          const result = await collection.updateOne(...args);
                          if (
                            armed &&
                            !Array.isArray(args[1]) &&
                            args[1].$inc?.treasuryBalance > 0
                          ) {
                            armed = false;
                            throw new Error("Injected post-credit crash");
                          }
                          return result;
                        };
                      return typeof value === "function" ? value.bind(coll) : value;
                    },
                  });
                };
              },
            }) as Db;
          }
          if (scenario === "retry_after_credit") {
            await assert.rejects(
              issueAdminSovereignBondSeries(callDb, args),
              /Injected post-credit crash/
            );
            const move = await db.collection("bankMoneyMoves").findOne({ turn: currentTurn });
            assert(move);
            assert.equal((await resumeSettlement(db, String(move._id))).status, "applied");
          }
          const receipt = await measure(`fixture_${scenario}`, () =>
            issueAdminSovereignBondSeries(db, args)
          );
          assert(receipt);
          const once = await observed();
          await issueAdminSovereignBondSeries(db, args);
          assert.deepEqual(await observed(), once, "Repeated admin request changed balances");
          results.push({
            ...(await check(`${scenario}:${offset + 1}`, opening, currentTurn)),
            fundedFace: receipt.issueAmount,
          });
        }
      }
      await reset();
      await db.collection("federalBudget").deleteMany({ countryId: { $ne: "US" } });
      await db.collection("bonds").deleteMany({});
      await db
        .collection("bondMarketPools")
        .updateOne({ _id: "USD" as never }, { $set: { cashLocal: 100000, targetCashLocal: 0 } });
      await db
        .collection("bonds")
        .insertOne({
          _id: new ObjectId(),
          issuerType: "sovereign",
          countryId: "US",
          currencyCode: "USD",
          corporationId: new ObjectId(),
          totalIssued: 0,
          publicFloat: 0,
          unsoldUnits: 500,
          requestedUnits: 500,
          couponRate: 5,
          marketPrice: 1,
          matured: false,
          defaulted: false,
          issuedAtTurn: turn - 1,
          maturityTurn: turn + 48,
        });
      const opening = await observed();
      const placed = await measure("fixture_laterUnsold", () =>
        placeUnsoldBondUnits(db, turn, now)
      );
      assert(placed.unitsPlaced > 0);
      const once = await observed();
      await placeUnsoldBondUnits(db, turn, now);
      assert.deepEqual(await observed(), once);
      results.push({
        ...(await check("later_unsold", opening, turn)),
        placedUnits: placed.unitsPlaced,
      });
    }
    const afterSource = await Promise.all(
      Object.entries(filters).map(async ([name, filter]) => [
        name,
        await source.collection(name).find(filter).sort({ _id: 1 }).toArray(),
      ])
    );
    assert.equal(hash(afterSource), sourceHash);
    assert(!dirty() || process.argv.includes("--development"));
    writeFileSync(
      output,
      JSON.stringify(
        {
          sourceCommit,
          sourceDirty: dirty(),
          baseline,
          retainedRun: { id: run._id, sourceCommit: run.source.executedCommit, sourceTurn },
          sourceHash,
          sourcePreserved: true,
          countries,
          scope:
            "Retained fiscal/currency context; explicitly controlled offers, buyer cash and policy. Actual subsystem commands, not whole-economy qualification.",
          results,
          performance,
        },
        null,
        2
      )
    );
    console.log(JSON.stringify({ sourceCommit, cases: results.length, passed: !baseline }));
  } finally {
    await client.close();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
