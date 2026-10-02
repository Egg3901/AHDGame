/** Native NPP bond cash checks. Uses only fresh disposable local sandbox databases. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { BSON, MongoClient, ObjectId, type Document } from "mongodb";
import type { LedgerEntry } from "@/lib/ledger/types";
import type { NppBondCashWitness } from "@/lib/turn/nppBondCash";

async function main() {
  const uri = process.env.SIM_MONGODB_URI;
  assert(uri, "SIM_MONGODB_URI is required");
  const endpoint = new URL(uri);
  assert(["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname));
  assert.equal(endpoint.port, "27018", "Only the isolated local sandbox port is allowed");
  const prefix = `ahd_sim_npp_bond_${new ObjectId().toHexString()}_`;
  Object.assign(process.env, { NODE_ENV: "test" });
  process.env.MONGODB_URI = uri;
  process.env.SENTRY_DSN = "";
  process.env.NEXT_PUBLIC_SENTRY_DSN = "";
  const client = await MongoClient.connect(uri, { maxPoolSize: 2, monitorCommands: true });
  globalThis._mongoClientPromise = Promise.resolve(client);
  const { payNppBondReturns, flushNppBondCashWitnesses } = await import("@/lib/turn/nppBondCash");
  const { processBondTurn } = await import("@/lib/turn/bondTurn");
  const { collectBalances } = await import("@/lib/ledger/balanceSnapshot");
  const { reconcileLedger } = await import("@/lib/ledger/reconcile");
  const { resetLedgerShadowFlagCache } = await import("@/lib/ledger/featureFlag");
  let measuring = false;
  let commands = 0;
  let requestBytes = 0;
  client.on("commandStarted", (event) => {
    if (measuring) {
      commands++;
      requestBytes += BSON.calculateObjectSize(event.command);
    }
  });
  const results: Document[] = [];
  try {
    for (const mode of [
      "normal",
      "mixed",
      "partial",
      "first_rejected",
      "missing",
      "shadow_off",
      "zero",
      "processor_coupon",
      "processor_maturity",
    ] as const) {
      const target = prefix + mode;
      process.env.MONGODB_DB = target;
      process.env.MONGO_DB_NAME = target;
      const db = client.db(target);
      assert.equal((await db.listCollections().toArray()).length, 0);
      let created = false;
      try {
        resetLedgerShadowFlagCache();
        await db
          .collection<Document>("gameConfig")
          .insertOne({ _id: "default", ledgerShadow: mode !== "shadow_off", forexEnabled: true });
        created = true;
        await db.collection<Document & { _id: string }>("gameState").insertOne({
          _id: "current",
          currentTurn: 49,
          currentYear: 1991,
          preset: "1991-default",
          forexEnabled: true,
        });
        await db.collection("exchangeRates").insertMany([
          { currencyCode: "USD", rate: 1 },
          { currencyCode: "GBP", rate: 0.8 },
          { currencyCode: "JPY", rate: 150 },
        ]);
        const actors = ["US", "UK", "JP"].map((countryId, index) => ({
          _id: new ObjectId((4096 + index).toString(16).padStart(24, "0")),
          countryId,
          nppInvestmentCashAnchor:
            (mode === "partial" && index === 1) || (mode === "first_rejected" && index === 0)
              ? "invalid"
              : 100,
        }));
        if (mode !== "missing") await db.collection("npps").insertMany(actors);
        const processor = mode.startsWith("processor_");
        if (processor) {
          const issuerId = new ObjectId("000000000000000000000992");
          await db.collection("corporations").insertOne({
            _id: issuerId,
            name: "Synthetic issuer",
            countryId: "US",
            liquidCurrencyCode: "USD",
            liquidCapital: 100000,
            isNationalCorporation: false,
          });
          await db.collection("bonds").insertOne({
            _id: new ObjectId("000000000000000000000991"),
            issuerType: "corporation",
            countryId: "US",
            corporationId: issuerId,
            issuerName: "Synthetic issuer",
            currencyCode: "USD",
            faceValue: 1000,
            couponRate: 5.127,
            totalIssued: 3000,
            publicFloat: 0,
            centralBankHoldings: 0,
            holders: actors.map((actor) => ({ nppId: actor._id, units: 1 })),
            issuedAtTurn: 1,
            maturityTurns: 96,
            maturityTurn: mode === "processor_maturity" ? 49 : 97,
            matured: false,
            defaulted: false,
            defaultedAtTurn: null,
            marketPrice: 1,
            creditRating: "AAA",
          });
        }
        const payments = new Map(
          actors.map((actor) => [
            actor._id.toHexString(),
            {
              total: mode === "zero" ? 0 : mode === "mixed" ? 1001.0079999999999 : 1.0749,
              coupon: mode === "zero" ? 0 : mode === "mixed" ? 1.004 : 1.0749,
              maturity: mode === "mixed" ? 1000.004 : 0,
            },
          ])
        );
        const opening = await collectBalances(db);
        commands = requestBytes = 0;
        measuring = true;
        let rejected = false;
        let pending: NppBondCashWitness[] | undefined;
        try {
          if (processor) await processBondTurn(49);
          else
            pending = await payNppBondReturns(db, payments, 49, new Date("2026-01-01T00:00:00Z"));
        } catch (error) {
          if (mode !== "partial" && mode !== "first_rejected") throw error;
          rejected = true;
        } finally {
          measuring = false;
        }
        const profile = { commands, requestBytes };
        assert.equal(rejected, mode === "partial" || mode === "first_rejected");
        const closing = await collectBalances(db);
        const entries = await db
          .collection<LedgerEntry>("ledgerEntries")
          .find({ turn: 49 })
          .toArray();
        const report = reconcileLedger({
          turn: 49,
          entries,
          openingBalances: opening,
          closingBalances: closing,
        });
        const nppEntries = entries.filter((entry) =>
          entry.legs.some((leg) => leg.account.startsWith("npp:"))
        );
        const expected =
          mode === "mixed" || mode === "processor_maturity"
            ? 6
            : mode === "normal" || mode === "processor_coupon"
              ? 3
              : mode === "partial"
                ? 1
                : 0;
        assert.equal(nppEntries.length, expected);
        assert.equal(report.trialBalance.status, "green");
        assert.equal(report.unattributed.length, 0);
        if (mode === "shadow_off") assert.equal(report.stockVsFlow.divergentCount, 3);
        else assert.equal(report.stockVsFlow.divergentCount, 0);
        for (let index = 0; index < actors.length; index++) {
          if (mode === "missing" || typeof actors[index].nppInvestmentCashAnchor !== "number")
            continue;
          const actor = await db.collection("npps").findOne({ _id: actors[index]._id });
          const paid =
            mode !== "zero" && mode !== "first_rejected" && !(mode === "partial" && index > 0);
          const amount =
            mode === "processor_maturity" ? 1001.07 : mode === "mixed" ? 1001.01 : 1.07;
          assert(Math.abs(actor!.nppInvestmentCashAnchor - (100 + (paid ? amount : 0))) < 1e-9);
        }
        if (pending) {
          await flushNppBondCashWitnesses(db, pending);
          assert.equal(
            await db.collection("ledgerEntries").countDocuments({ turn: 49 }),
            entries.length
          );
          await flushNppBondCashWitnesses(
            db,
            pending.map((witness) => ({ ...witness, key: "wrong-stamp" }))
          );
          assert.equal(
            await db.collection("ledgerEntries").countDocuments({ turn: 49 }),
            entries.length
          );
        }
        if (mode === "partial") {
          const landed = await db.collection("npps").findOne({ _id: actors[0]._id });
          await flushNppBondCashWitnesses(db, [
            {
              nppId: actors[0]._id,
              key: landed!.nppBondCashWitnessKey,
              entries: entries.map((entry) => ({ id: entry._id, entry })),
            },
          ]);
          assert.equal(await db.collection("ledgerEntries").countDocuments({ turn: 49 }), 1);
        }
        results.push({
          mode,
          rejected,
          nppEntries: nppEntries.length,
          divergent: report.stockVsFlow.divergentCount,
          trial: report.trialBalance.status,
          unattributed: report.unattributed.length,
          profile,
          stockCheckRequired: mode !== "shadow_off",
        });
        console.log(JSON.stringify(results.at(-1)));
      } finally {
        measuring = false;
        if (created) {
          assert.equal(db.databaseName, target);
          assert(target.startsWith(prefix));
          await db.dropDatabase();
        }
      }
    }
  } finally {
    await client.close();
  }
  const report = {
    source: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    results,
    fullWorldAccepted: false,
  };
  const outIndex = process.argv.indexOf("--out");
  if (outIndex !== -1) {
    assert(process.argv[outIndex + 1], "--out requires a path");
    writeFileSync(process.argv[outIndex + 1], JSON.stringify(report, null, 2));
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
