/** Bounded native Mongo LOC parity and recovery. Synthetic fixtures, never live data. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { BSON, MongoClient, ObjectId, type Db } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { processBondTurn } from "@/lib/turn/bondTurn";
import { processLineOfCreditTurn } from "@/lib/turn/lineOfCreditTurn";
import { garnishLocFromIncome } from "@/lib/lineOfCredit/garnishment";
import { recoverPendingLoc, settleLocPlan, type LocPlan } from "@/lib/lineOfCredit/settlement";

const arg = (key: string) =>
  process.argv.find((x) => x.startsWith(`--${key}=`))?.slice(key.length + 3);
const owner = new ObjectId("000000000000000000001328");
const baseline = "dde248f1cb2b1ab8aba882b3af2c6428dc490a89";
async function seed(db: Db, mode: string) {
  assert.equal((await db.listCollections().toArray()).length, 0, "Target must be new");
  await db.collection("gameConfig").insertOne({
    _id: "default" as never,
    forexEnabled: true,
    lineOfCreditEnabled: true,
    privateBankingEnabled: false,
    savingsAccountsMode: mode.includes("savings") ? "authoritative" : "shadow",
    savingsAccountsReadCurrencies: mode.includes("savings") ? ["USD"] : [],
    auditLog: false,
  });
  await db
    .collection("gameState")
    .insertOne({ _id: "current" as never, currentTurn: 500, preset: "2019-default" });
  await db.collection("centralBanks").insertMany([
    {
      _id: "US" as never,
      countryId: "US",
      primeRate: 5,
      reserveBalance: 0,
      externalBroadMoney: mode === "savings_refused" ? 0 : 1e6,
      householdSavingsLiability: 50000,
      bankReserveRequirement: 0.1,
    },
    { _id: "ECB" as never, countryId: "DE", primeRate: 4, reserveBalance: 0 },
  ]);
  await db.collection("exchangeRates").insertMany([
    { _id: "US" as never, currencyCode: "USD", rate: 1 },
    { _id: "DE" as never, currencyCode: "EUR", rate: 0.8 },
  ]);
  await db.collection("characters").insertOne({
    _id: owner,
    name: "Synthetic LOC borrower",
    countryId: "US",
    savingsAccountsOpened: { USD: true },
    currencyBalances: {
      personal: {
        USD: mode === "wallet" || mode === "io" ? 10000 : 0,
        EUR: mode === "cross_currency" ? 10000 : 0,
      },
      savings: { USD: mode.includes("savings") ? 50000 : 0 },
      campaign: { USD: 12345 },
    },
    lineOfCredit: {
      balances: { USD: 100000 },
      arrears: {},
      accountsOpened: { USD: true },
      ...(mode === "io" ? { paymentMode: { USD: "io" } } : {}),
      drawFrozen: mode === "income_unfreeze",
    },
  });
  if (mode.includes("savings"))
    await db.collection("savingsAccounts").insertOne({
      _id: new ObjectId(),
      ownerType: "character",
      ownerId: owner,
      currency: "USD",
      balance: 50000,
      holder: "centralBank",
      status: "open",
      version: 0,
      accruedInterest: 0,
      interestEarned: 0,
      openedTurn: 1,
    });
}
async function state(db: Db) {
  const char = await db.collection("characters").findOne({ _id: owner });
  const banks = await db.collection("centralBanks").find({}).sort({ _id: 1 }).toArray();
  return {
    personal: char!.currencyBalances.personal,
    savings: char!.currencyBalances.savings,
    campaign: char!.currencyBalances.campaign,
    loc: char!.lineOfCredit,
    banks: banks.map((b) => ({
      bank: String(b._id),
      reserves: b.reserveBalance ?? 0,
      pool: b.externalBroadMoney ?? 0,
      savingsLiability: b.householdSavingsLiability ?? 0,
      forexRevenue: b.forexRevenue ?? 0,
      foreignReserves: b.spreadFeeReserveBalances ?? {},
    })),
    accounts: (await db.collection("savingsAccounts").find({}).toArray()).map((a) => ({
      balance: a.balance,
      status: a.status,
    })),
  };
}
function failAfter(db: Db, collection: string) {
  let fired = false;
  return {
    didFire: () => fired,
    db: new Proxy(db, {
      get(target, key) {
        if (key === "collection")
          return (name: string) => {
            const c = target.collection(name);
            if (name !== collection) return c;
            return new Proxy(c, {
              get(coll, prop) {
                if (prop === "updateOne")
                  return async (...args: Parameters<typeof coll.updateOne>) => {
                    const result = await coll.updateOne(...args);
                    if (!fired) {
                      fired = true;
                      throw new Error("Injected acknowledgement loss");
                    }
                    return result;
                  };
                const value = Reflect.get(coll, prop);
                return typeof value === "function" ? value.bind(coll) : value;
              },
            });
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }),
  };
}
async function main() {
  const uri = process.env.SIM_MONGODB_URI,
    prefix = arg("target"),
    out = arg("out");
  assert(uri && /^mongodb:\/\/(127\.0\.0\.1|localhost):27018\/?$/.test(uri));
  assert(prefix && /^ahd_sim_[a-zA-Z0-9_]+$/.test(prefix) && out);
  if (arg("development") !== "true")
    assert.equal(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(), "");
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const scratch = mkdtempSync(join(tmpdir(), "loc-parity-"));
  writeFileSync(
    join(scratch, "baseline.ts"),
    execFileSync("git", ["show", `${baseline}:src/lib/turn/lineOfCreditTurn.ts`], {
      encoding: "utf8",
    })
  );
  const old = await import(pathToFileURL(join(scratch, "baseline.ts")).href);
  Object.assign(process.env, { NODE_ENV: "test", MONGODB_URI: uri });
  const client = await MongoClient.connect(uri, { monitorCommands: true });
  let collecting = false;
  let commands = 0,
    requestBytes = 0,
    responseBytes = 0;
  client.on("commandStarted", (event) => {
    if (collecting) {
      commands++;
      requestBytes += BSON.calculateObjectSize(event.command);
    }
  });
  client.on("commandSucceeded", (event) => {
    if (collecting && event.reply && typeof event.reply === "object" && !Array.isArray(event.reply))
      responseBytes += BSON.calculateObjectSize(event.reply as Record<string, unknown>);
  });
  const measured = async <T>(work: () => Promise<T>) => {
    commands = 0;
    requestBytes = 0;
    responseBytes = 0;
    collecting = true;
    try {
      const value = await work();
      return { value, roundTrips: commands, requestBytes, responseBytes };
    } finally {
      collecting = false;
    }
  };
  global._mongoClientPromise = Promise.resolve(client);
  const select = (name: string) => {
    Object.assign(process.env, { MONGODB_DB: name, MONGO_DB_NAME: name });
    return client.db(name);
  };
  const results: unknown[] = [];
  try {
    for (const mode of [
      "wallet",
      "io",
      "cross_currency",
      "empty",
      "income_unfreeze",
      "savings",
      "savings_refused",
    ]) {
      const income = new Map([[owner.toHexString(), mode === "income_unfreeze" ? 100000 : 0]]);
      const base = select(`${prefix}_${mode}_base`);
      await seed(base, mode);
      const baselineProfile = await measured(() =>
        old.processLineOfCreditTurn(base, 500, income, new Map(), true)
      );
      const beforeFix = await state(base);
      const db = select(`${prefix}_${mode}_fixed`);
      await seed(db, mode);
      const before = await state(db);
      const profile = await measured(() =>
        processLineOfCreditTurn(db, 500, income, new Map(), true)
      );
      const outcome = profile.value;
      const after = await state(db);
      if (mode !== "savings_refused") assert.deepEqual(after, beforeFix, `Baseline parity ${mode}`);
      else {
        assert.equal(after.loc.balances.USD, 100000);
        assert(after.loc.arrears.USD > 0);
        assert(beforeFix.loc.balances.USD < 100000);
      }
      const ledgerCount = await db.collection("locLedger").countDocuments();
      await processLineOfCreditTurn(db, 500, income, new Map(), true);
      assert.deepEqual(await state(db), after, "Same turn cannot accrue or pay twice");
      assert.equal(await db.collection("locLedger").countDocuments(), ledgerCount);
      results.push({
        case: mode,
        before,
        beforeFix,
        after,
        outcome,
        performance: {
          baseline: { ...baselineProfile, value: undefined },
          fixed: { ...profile, value: undefined },
        },
        sameTurnRetryUnchanged: true,
        ledgerCount,
      });
    }
    for (const point of ["characters", "centralBanks", "locLedger"]) {
      const db = select(`${prefix}_ack_${point}`);
      await seed(db, "wallet");
      await db
        .collection("characters")
        .updateOne({ _id: owner }, { $set: { "lineOfCredit.arrears.USD": 10 } });
      const character = await db.collection("characters").findOne({ _id: owner });
      const plan: LocPlan = {
        characterId: owner,
        expectedLoc: character!.lineOfCredit,
        expectedRevision: null,
        request: { operation: "repay", currency: "USD", amount: 100 },
        createdAt: new Date(),
        effect: {
          locAfter: { ...character!.lineOfCredit, balances: { USD: 99910 }, arrears: {} },
          walletInc: { "currencyBalances.personal.USD": -100 },
          reserves: [{ bankId: "US", increments: { reserveBalance: 10 } }],
          ledger: [
            {
              characterId: owner,
              countryId: "US",
              currencyCode: "USD",
              type: "repay",
              amount: 100,
              principalPortion: 90,
              interestPortion: 10,
              balanceAfter: 99910,
              arrearsAfter: 0,
              turn: 500,
            },
          ],
          transactions: [],
          flows: [
            { kind: "debit", currency: "USD", amount: 100, note: "Synthetic accepted repayment" },
            { kind: "credit", currency: "USD", amount: 10, note: "Interest reserve" },
            { kind: "burn", currency: "USD", amount: 90, note: "Principal retirement" },
          ],
          result: { amount: 100 },
        },
      };
      const fault = failAfter(db, point);
      await assert.rejects(
        settleLocPlan(fault.db, "loc-native-repay", 500, plan),
        /acknowledgement/
      );
      assert(fault.didFire());
      const resumes = await Promise.all([
        settleLocPlan(db, "loc-native-repay", 500, plan),
        settleLocPlan(db, "loc-native-repay", 500, plan),
      ]);
      assert(resumes.every((r) => !r.error));
      const final = await state(db);
      assert.equal(final.personal.USD, 9900);
      assert.equal(final.loc.balances.USD, 99910);
      assert.equal(final.banks.find((b) => b.bank === "US")!.reserves, 10);
      assert.equal(await db.collection("locLedger").countDocuments(), 1);
      results.push({ case: `lost_${point}_ack`, final, concurrentRecoveryOnce: true });
    }
    const db = select(`${prefix}_garnish`);
    await seed(db, "wallet");
    await db.collection("characters").updateOne(
      { _id: owner },
      {
        $set: {
          lineOfCredit: { balances: { USD: 90 }, arrears: { USD: 10 }, drawFrozen: true },
          "currencyBalances.personal": { USD: 0, EUR: 0 },
        },
      }
    );
    const income = () =>
      new Map([[owner.toHexString(), new Map<CurrencyCode, number>([["EUR", 200]])]]);
    const fault = failAfter(db, "characters"),
      first = income();
    await assert.rejects(
      garnishLocFromIncome(fault.db, first, 500, "bond_coupon"),
      /acknowledgement/
    );
    assert.equal(first.size, 1, "Source caller stops before its residual payout");
    await garnishLocFromIncome(db, first, 500, "bond_coupon");
    assert.equal(first.size, 0, "Source payout and conversion maps consumed by joined settlement");
    const final = await state(db),
      trades = await db.collection("tradeHistory").countDocuments();
    assert.equal(trades, 1);
    await db
      .collection("characters")
      .updateOne({ _id: owner }, { $set: { "lineOfCredit.drawFrozen": false } });
    const unfrozen = await state(db),
      repeated = income();
    await garnishLocFromIncome(db, repeated, 500, "bond_coupon");
    assert.deepEqual(await state(db), unfrozen);
    assert.equal(repeated.size, 0);
    assert.equal(await db.collection("tradeHistory").countDocuments(), trades);
    const changed = income();
    changed.get(owner.toHexString())!.set("EUR", 201);
    await assert.rejects(garnishLocFromIncome(db, changed, 500, "bond_coupon"), /event changed/);
    results.push({
      case: "garnished_residual_fx",
      final,
      trades,
      repeatedAfterUnfreezeUnchanged: true,
      changedIncomeStopped: true,
    });
    // Actual source phase, including the issuer cash debit before LOC diversion.
    const sourceDb = select(`${prefix}_bond_source`);
    await seed(sourceDb, "wallet");
    await sourceDb.collection("characters").updateOne(
      { _id: owner },
      {
        $set: {
          lineOfCredit: { balances: { USD: 1 }, arrears: { USD: 1 }, drawFrozen: true },
          "currencyBalances.personal": { USD: 0, EUR: 0 },
        },
      }
    );
    const issuer = new ObjectId("000000000000000000001329");
    await sourceDb.collection("corporations").insertOne({
      _id: issuer,
      countryId: "DE",
      liquidCurrencyCode: "EUR",
      liquidCapital: 1000000,
      name: "Synthetic coupon issuer",
      status: "active",
      netAssets: 1000000,
    });
    await sourceDb.collection("bonds").insertOne({
      _id: new ObjectId("000000000000000000001330"),
      issuerType: "corporation",
      corporationId: issuer,
      countryId: "DE",
      currencyCode: "EUR",
      couponRate: 5,
      maturityTurn: 1000,
      issuedTurn: 1,
      matured: false,
      defaulted: false,
      holders: [{ characterId: owner, units: 200 }],
      publicFloat: 0,
      totalUnits: 200,
      marketPrice: 1000,
    });
    const sourceFault = failAfter(sourceDb, "characters");
    global._mongoClientPromise = Promise.resolve(
      new Proxy(client, {
        get(target, prop) {
          if (prop === "db")
            return (name?: string) =>
              name === sourceDb.databaseName ? sourceFault.db : target.db(name);
          const value = Reflect.get(target, prop);
          return typeof value === "function" ? value.bind(target) : value;
        },
      })
    );
    try {
      await assert.rejects(processBondTurn(500), /acknowledgement/);
    } finally {
      global._mongoClientPromise = Promise.resolve(client);
    }
    assert(sourceFault.didFire());
    const issuerAfterSource = (await sourceDb.collection("corporations").findOne({ _id: issuer }))!
      .liquidCapital;
    assert(issuerAfterSource < 1000000, "Actual source must pay the coupon");
    const sourceAfterCommit = await state(sourceDb);
    await recoverPendingLoc(sourceDb, 501);
    const sourceAfterRecovery = await state(sourceDb);
    assert.equal(
      (await sourceDb.collection("corporations").findOne({ _id: issuer }))!.liquidCapital,
      issuerAfterSource
    );
    assert.equal(await sourceDb.collection("tradeHistory").countDocuments(), 1);
    await recoverPendingLoc(sourceDb, 501);
    assert.deepEqual(await state(sourceDb), sourceAfterRecovery);
    results.push({
      case: "actual_bond_source_interruption",
      issuerBefore: 1000000,
      issuerAfterSource,
      sourceAfterCommit,
      sourceAfterRecovery,
      durableRecoveryDoesNotRerunSource: true,
      scope:
        "Actual processBondTurn through its issuer debit and joined LOC/residual publication, then pending journal recovery; whole bond phase replay is not claimed",
    });
    writeFileSync(
      out,
      JSON.stringify(
        {
          sourceCommit,
          baseline,
          scope:
            "Synthetic native Mongo command/service qualification, not a full-world run or historical consent",
          results,
        },
        null,
        2
      )
    );
    console.log("LOC native parity and recovery passed");
  } finally {
    await client.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
