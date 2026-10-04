/** Native treasury redemption checks, restricted to fresh local sandbox databases. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { BSON, MongoClient, ObjectId, type Document } from "mongodb";
import type { LedgerEntry } from "@/lib/ledger/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";

async function main() {
  const uri = process.env.SIM_MONGODB_URI;
  assert(uri, "SIM_MONGODB_URI is required");
  const endpoint = new URL(uri);
  assert(["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname));
  assert.equal(endpoint.port, "27018");
  Object.assign(process.env, {
    NODE_ENV: "test",
    MONGODB_URI: uri,
    SENTRY_DSN: "",
    NEXT_PUBLIC_SENTRY_DSN: "",
  });
  const client = await MongoClient.connect(uri, { maxPoolSize: 2, monitorCommands: true });
  globalThis._mongoClientPromise = Promise.resolve(client);
  const { processBondTurn } = await import("@/lib/turn/bondTurn");
  const { getNationalBudgetId } = await import("@/lib/bonds/sovereign");
  const { collectBalances } = await import("@/lib/ledger/balanceSnapshot");
  const { reconcileLedger } = await import("@/lib/ledger/reconcile");
  const { resetLedgerShadowFlagCache } = await import("@/lib/ledger/featureFlag");
  const prefix = `ahd_sim_sovereign_${new ObjectId().toHexString()}_`;
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
      "usd",
      "gbp",
      "jpy",
      "authored_pl",
      "shadow_off",
      "missing",
      "zero",
      "haircut",
      "deficit",
      "invalid_ccy",
      "invalid_cash",
    ] as const) {
      const countryId: CountryId =
        mode === "gbp"
          ? COUNTRY_CONFIGS.UK.id
          : mode === "jpy"
            ? COUNTRY_CONFIGS.JP.id
            : mode === "authored_pl"
              ? COUNTRY_CONFIGS.PL.id
              : COUNTRY_CONFIGS.US.id;
      const currencyCode = COUNTRY_CURRENCY_MAP[countryId];
      const target = prefix + mode;
      Object.assign(process.env, { MONGODB_DB: target, MONGO_DB_NAME: target });
      const db = client.db(target);
      assert.equal((await db.listCollections().toArray()).length, 0);
      let created = false;
      try {
        resetLedgerShadowFlagCache();
        await db.collection<Document & { _id: string }>("gameConfig").insertOne({
          _id: "default",
          ledgerShadow: mode !== "shadow_off",
          forexEnabled: true,
          auditLog: false,
        });
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
        const actors = ["US", "UK", "JP"].map((country, index) => ({
          _id: new ObjectId((4096 + index).toString(16).padStart(24, "0")),
          countryId: country,
          nppInvestmentCashAnchor: 100,
        }));
        await db.collection("npps").insertMany(actors);
        const initialCash = mode === "deficit" ? 100 : 100000;
        const initialDebt = mode === "zero" ? 0 : mode === "haircut" ? 1800 : 3000;
        if (mode !== "missing")
          await db.collection<Document & { _id: string }>("federalBudget").insertOne({
            _id: getNationalBudgetId(countryId),
            countryId,
            currencyCode,
            treasuryBalance: mode === "invalid_cash" ? "invalid" : initialCash,
            gdp: 100000,
            debt: { principal: initialDebt, interestRate: 0 },
            spending: { total: 100, debtInterest: 0 },
            revenue: { total: 100 },
          });
        await db.collection("bonds").insertOne({
          _id: new ObjectId("000000000000000000000991"),
          issuerType: "sovereign",
          countryId,
          corporationId: new ObjectId("000000000000000000000992"),
          issuerName: "Synthetic treasury",
          currencyCode: mode === "invalid_ccy" ? "GBP" : currencyCode,
          faceValue: 1000,
          couponRate: 0,
          totalIssued: mode === "zero" ? 0 : 3000,
          publicFloat: 0,
          centralBankHoldings: 0,
          holders: mode === "zero" ? [] : actors.map((actor) => ({ nppId: actor._id, units: 1 })),
          issuedAtTurn: 1,
          maturityTurns: 48,
          maturityTurn: 49,
          matured: false,
          defaulted: false,
          defaultedAtTurn: null,
          marketPrice: 1,
          creditRating: "AAA",
          ...(mode === "haircut" ? { restructureHaircutPercent: 0.4 } : {}),
        });
        const opening = await collectBalances(db);
        commands = requestBytes = 0;
        measuring = true;
        let rejected = false;
        try {
          await processBondTurn(49);
        } catch (error) {
          if (mode !== "invalid_ccy" && mode !== "invalid_cash") throw error;
          assert(
            error instanceof Error &&
              error.message.includes(mode === "invalid_ccy" ? "currency" : "$inc")
          );
          rejected = true;
        } finally {
          measuring = false;
        }
        const profile = { commands, requestBytes };
        assert.equal(rejected, mode === "invalid_ccy" || mode === "invalid_cash");
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
        const budget = await db.collection("federalBudget").findOne({ countryId });
        const govHistory = await db
          .collection("financialTxLog")
          .find({ type: "gov_bond_maturity_payment" })
          .toArray();
        const paid = mode !== "zero" && mode !== "missing" && !rejected;
        assert.equal(govHistory.length, paid ? 1 : 0);
        if (budget) {
          assert.equal(
            budget.treasuryBalance,
            mode === "invalid_cash" ? "invalid" : initialCash - (paid ? 3000 : 0)
          );
          assert.equal(budget.debt.principal, rejected ? initialDebt : 0);
        }
        assert.equal(report.trialBalance.status, "green");
        assert.equal(report.unattributed.length, 0);
        if (mode !== "shadow_off") assert.equal(report.stockVsFlow.divergentCount, 0);
        else assert.equal(entries.length, 0);
        if (!rejected) {
          await processBondTurn(49);
          assert.equal(
            await db.collection("ledgerEntries").countDocuments({ turn: 49 }),
            entries.length
          );
          assert.equal(
            await db
              .collection("financialTxLog")
              .countDocuments({ type: "gov_bond_maturity_payment" }),
            govHistory.length
          );
          if (budget)
            assert.equal(
              (await db.collection("federalBudget").findOne({ countryId }))!.treasuryBalance,
              budget.treasuryBalance
            );
        }
        results.push({
          mode,
          currencyCode,
          treasuryDeltaLocal:
            typeof budget?.treasuryBalance === "number"
              ? budget.treasuryBalance - initialCash
              : null,
          principalAfter: budget?.debt.principal ?? null,
          govHistory: govHistory.length,
          divergent: report.stockVsFlow.divergentCount,
          trial: report.trialBalance.status,
          unattributed: report.unattributed.length,
          rejected,
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
    assert(process.argv[outIndex + 1]);
    writeFileSync(process.argv[outIndex + 1], JSON.stringify(report, null, 2));
  }
}
main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
