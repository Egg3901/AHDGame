/** Synthetic native Mongo qualification; invoked by fundPlayerCommandReplay.mjs. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { MongoClient, ObjectId } from "mongodb";
import { POST as subscribe } from "../../src/app/api/investment-funds/[slug]/subscribe/route";
import { GET as readFund } from "../../src/app/api/investment-funds/[slug]/route";
import { POST as redeem } from "../../src/app/api/investment-funds/[slug]/redeem/route";
import { runIndexFundCron } from "../../src/lib/indexFunds/fundCron";
const [target, out] = process.argv.slice(2);
assert(/^ahd_sim_fund_commands_[a-z0-9_]+$/.test(target));
const client = new MongoClient("mongodb://127.0.0.1:27018/", { monitorCommands: true });
let activeCommands = 0;
client.on("commandStarted", () => activeCommands++);
client.on("commandSucceeded", () => activeCommands--);
client.on("commandFailed", () => activeCommands--);
async function drain() {
  let quiet = 0;
  for (let n = 0; n < 100; n++) {
    await new Promise((r) => setTimeout(r, 50));
    quiet = activeCommands === 0 ? quiet + 1 : 0;
    if (quiet >= 5) return;
  }
  throw Error("Mongo commands did not drain");
}
const actor = new ObjectId("000000000000000000002120"),
  fundId = new ObjectId("000000000000000000002121");
const id = () => crypto.randomUUID();
async function main() {
  await client.connect();
  const db = client.db(target);
  assert.equal((await db.listCollections().toArray()).length, 0);
  globalThis._mongoClientPromise = Promise.resolve(client);
  globalThis.fundCommandDb = db;
  globalThis.fundCommandActor = actor;
  globalThis.fundCommandClient = client;
  const pin = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
  assert.equal(dirty, "", "Fixture requires a clean source tree");
  await db.collection("gameConfig").insertOne({
    _id: "default",
    indexFundsMode: "full",
    nppEconomyEnabled: false,
    indexFundsDomesticSovereignCoverageEnabled: false,
    auditLog: false,
  });
  await db
    .collection("gameState")
    .insertOne({ _id: "current", currentTurn: 1, turnInProgress: false });
  await db.collection("exchangeRates").insertOne({ currencyCode: "USD", rate: 1 });
  await db.collection("characters").insertOne({
    _id: actor,
    name: "Synthetic fund investor",
    countryId: "US",
    homeCurrency: "USD",
    autoConvertEnabled: false,
    cashOnHand: 10000,
    currencyBalances: { personal: { USD: 10000 } },
  });
  await db.collection("indexFunds").insertOne({
    _id: fundId,
    slug: "fixture",
    name: "Synthetic fund",
    status: "active",
    kind: "broad",
    scope: "country",
    countryId: "US",
    tickerSymbol: "FIX",
    reserveUnits: 0,
    anchorCurrencyCode: "USD",
    quotedNav: 10,
    unitSupply: 10,
    cashAnchor: 100,
    holdings: [],
    targetConstituents: [],
    countries: ["US"],
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.collection("indexFundPositions").insertOne({
    _id: new ObjectId(),
    fundId,
    holderKind: "character",
    characterId: actor,
    units: 10,
    avgNavAnchor: 10,
    legacyUnits: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const params = { params: Promise.resolve({ slug: "fixture" }) };
  async function call(kind, operationId, units = 1) {
    const response = await (kind === "subscribe" ? subscribe : redeem)(
      new Request(`http://fixture.invalid/api/investment-funds/fixture/${kind}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ units, operationId }),
      }),
      params
    );
    return { status: response.status, body: await response.json() };
  }
  async function state() {
    const c = await db.collection("characters").findOne({ _id: actor }),
      f = await db.collection("indexFunds").findOne({ _id: fundId });
    return {
      wallet: c.currencyBalances.personal.USD,
      fundCash: f.cashAnchor,
      supply: f.unitSupply,
      units:
        (await db.collection("indexFundPositions").findOne({ fundId, characterId: actor }))
          ?.units ?? 0,
      transactions: await db.collection("indexFundTransactions").countDocuments(),
      queued: await db.collection("indexFundRedemptionQueue").countDocuments(),
    };
  }
  const cases = [];
  for (const kind of ["subscribe", "redeem"]) {
    const before = await state(),
      operationId = id(),
      first = await call(kind, operationId, 2);
    assert.equal(first.status, 200, JSON.stringify(first));
    const after = await state(),
      retry = await call(kind, operationId, 2);
    assert.deepEqual(retry, first);
    assert.deepEqual(await state(), after);
    assert.equal(after.wallet + after.fundCash, before.wallet + before.fundCash);
    assert.equal(after.supply, after.units);
    const mismatch = await call(kind, operationId, 3);
    assert.equal(mismatch.status, 409);
    assert.deepEqual(await state(), after);
    const repeated = await call(kind, id(), 2);
    assert.equal(repeated.status, 200, JSON.stringify(repeated));
    assert.notDeepEqual(await state(), after);
    cases.push({
      case: kind,
      first,
      retry,
      before,
      after,
      changedRequestRejected: true,
      newIntentAllowed: true,
    });
  }
  const command = id(),
    before = await state();
  const results = await Promise.all([call("subscribe", command), call("subscribe", command)]);
  assert(results.some((x) => x.status === 200));
  const final = await call("subscribe", command);
  assert.equal(final.status, 200);
  const after = await state();
  assert.equal(after.units, before.units + 1);
  assert.equal(after.wallet, before.wallet - 10);
  cases.push({ case: "concurrent", statuses: results.map((x) => x.status), before, after });
  // Completion acknowledgement is lost after the response has durably landed.
  let fired = false;
  const original = db.collection.bind(db);
  globalThis.fundCommandDb = new Proxy(db, {
    get(target, key) {
      if (key === "collection")
        return (name) => {
          const c = original(name);
          if (name !== "indexFundCommands") return c;
          return new Proxy(c, {
            get(t, p) {
              if (p === "updateOne")
                return async (...args) => {
                  const r = await t.updateOne(...args);
                  if (!fired && args[1]?.$set?.state === "completed") {
                    fired = true;
                    throw Error("synthetic completion acknowledgement lost");
                  }
                  return r;
                };
              const v = Reflect.get(t, p);
              return typeof v === "function" ? v.bind(t) : v;
            },
          });
        };
      const v = Reflect.get(target, key);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  const lostId = id(),
    lost = await call("redeem", lostId);
  assert(fired);
  assert.equal(lost.status, 409);
  const committed = await state();
  globalThis.fundCommandDb = db;
  const recovered = await call("redeem", lostId);
  assert.equal(recovered.status, 200);
  assert.deepEqual(await state(), committed);
  cases.push({
    case: "completion_ack",
    lostStatus: lost.status,
    recoveredStatus: recovered.status,
    committed,
  });
  // A process failure before completion is explicitly unknown, not a replay lease.
  let stopped = false;
  globalThis.fundCommandDb = new Proxy(db, {
    get(target, key) {
      if (key === "collection")
        return (name) => {
          const c = original(name);
          if (name !== "indexFundCommands") return c;
          return new Proxy(c, {
            get(t, p) {
              if (p === "updateOne")
                return async (...args) => {
                  if (!stopped && args[1]?.$set?.state === "completed") {
                    stopped = true;
                    throw Error("synthetic stop before completion receipt");
                  }
                  return t.updateOne(...args);
                };
              const v = Reflect.get(t, p);
              return typeof v === "function" ? v.bind(t) : v;
            },
          });
        };
      const v = Reflect.get(target, key);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  const interruptedId = id(),
    interrupted = await call("subscribe", interruptedId);
  assert(stopped);
  assert.equal(interrupted.status, 409);
  const interruptedState = await state();
  globalThis.fundCommandDb = db;
  const blockedReplay = await call("subscribe", interruptedId);
  assert.equal(blockedReplay.status, 409);
  assert.equal(blockedReplay.body.pending, true);
  assert.deepEqual(await state(), interruptedState);
  cases.push({
    case: "standalone_before_completion",
    knownIncompleteRecovery: true,
    financialState: interruptedState,
    retryStatus: blockedReplay.status,
    noSecondExecution: true,
  });
  // An old pending command is never replayed by assuming a lease expired.
  const pendingId = id();
  await db.collection("indexFundCommands").insertOne({
    _id: `fund:${actor}:${pendingId}`,
    request: { fundId: fundId.toHexString(), kind: "subscribe", units: 1 },
    state: "pending",
    createdAt: new Date(0),
  });
  const stable = await state();
  const pending = await call("subscribe", pendingId);
  assert.equal(pending.status, 409);
  assert.equal(pending.body.pending, true);
  assert.deepEqual(await state(), stable);
  cases.push({ case: "unknown_standalone_outcome", status: pending.status, noReexecution: true });
  const turn = await runIndexFundCron(db, { currentTurn: 2 });
  const postTurn = await state();
  assert.equal(postTurn.wallet + postTurn.fundCash, stable.wallet + stable.fundCash);
  assert.equal(postTurn.supply, postTurn.units);
  cases.push({ case: "actual_fund_turn", turn, postTurn });
  const readResponse = await readFund(
    new Request("http://fixture.invalid/api/investment-funds/fixture"),
    params
  );
  assert.equal(readResponse.status, 200);
  const model = await readResponse.json();
  assert.equal(model.myPosition.units, postTurn.units);
  assert.equal(model.fund.cashAnchor, postTurn.fundCash);
  cases.at(-1).readModelMatches = true;
  await drain();
  const financialRows = await db
    .collection("financialTxLog")
    .find({ subjectId: actor })
    .project({ type: 1, amount: 1, anchorAmount: 1, currencyCode: 1 })
    .toArray();
  writeFileSync(
    out,
    JSON.stringify(
      {
        sourceCommit: pin,
        sourceDirty: !!dirty,
        scope:
          "Synthetic native Mongo player fund routes, production accounting and fund turn; synthetic auth, selected sandbox DB and transport rate limiter",
        cases,
        financialRows,
      },
      null,
      2
    )
  );
  await drain();
  await client.close();
}
main().catch(async (e) => {
  console.error(e);
  await drain();
  await client.close();
  process.exitCode = 1;
});
