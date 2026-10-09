/**
 * Bounded, real-Mongo qualification of corporation payout money moves.
 * No world or configured database is read. The existing owned-mongod fixture
 * supplies synthetic state. Run the identical harness on each source pin:
 *   npx tsx scripts/perf/money-move-qualification.ts --receipt receipt.json
 *   npx tsx scripts/perf/money-move-qualification.ts --receipt candidate.json --baseline receipt.json
 * This is primitive I/O evidence, not a whole-phase or world simulation pass.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { MongoClient, type Db } from "mongodb";
import { applyMoneyMove, resumeMoneyMove, type MoneyMoveRecordLeg } from "@/lib/banking/moneyMove";
import { attachMongoCommandMonitor } from "@/lib/observability/mongoMonitor";
import { PHASE_ROUND_TRIP_BUDGETS } from "@/simulation/engine/turnPhaseBudgets";
import {
  beginPhaseProfiling,
  endPhaseProfiling,
  resetRoundTripProfiler,
  roundTripReport,
} from "@/lib/observability/mongoRoundTrips";
import {
  fixtureProcExited,
  startIsolatedMongod,
  stopIsolatedMongod,
  sleep,
  type IsolatedMongod,
} from "@/lib/test-utils/realMongoFixture";
import {
  FIXTURE_VERSION,
  balanceAt,
  compareMatchedCase,
  outcomeHash,
  payoutFixture,
} from "./money-move-qualification-fixture";

const CAP_MS = 10 * 60 * 1000;
const COLLECTIONS = ["corporations", "characters", "npps", "indexFunds"];

function argument(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index < 0 ? undefined : process.argv[index + 1];
}

/** Delay each awaited database operation; this models latency, not a wire proxy. */
function delayedDb(db: Db, latencyMs: number, crashAfterCredit = false): Db {
  let armed = crashAfterCredit;
  return new Proxy(db, {
    get(target, property) {
      if (property !== "collection") {
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return (name: string) =>
        new Proxy(target.collection(name), {
          get(collection, operation) {
            const value = Reflect.get(collection, operation);
            if (typeof value !== "function") return value;
            if (operation === "find") {
              return (...args: unknown[]) => {
                const cursor = value.apply(collection, args);
                return new Proxy(cursor, {
                  get(cursorTarget, method) {
                    const fn = Reflect.get(cursorTarget, method);
                    if (method === "toArray") {
                      return async () => {
                        if (latencyMs) await sleep(latencyMs);
                        return fn.call(cursorTarget);
                      };
                    }
                    return typeof fn === "function" ? fn.bind(cursorTarget) : fn;
                  },
                });
              };
            }
            return async (...args: unknown[]) => {
              if (latencyMs) await sleep(latencyMs);
              const result = await value.apply(collection, args);
              const update = args[1] as { $inc?: Record<string, number> } | undefined;
              if (
                armed &&
                name === "characters" &&
                (operation === "bulkWrite" ||
                  (operation === "updateOne" &&
                    Object.values(update?.$inc ?? {}).some((amount) => amount > 0)))
              ) {
                armed = false;
                throw new Error("qualification: lost credit acknowledgement");
              }
              return result;
            };
          },
        });
    },
  });
}

async function outcomes(db: Db, holders: number, key: string) {
  const accounts = [];
  for (const collection of COLLECTIONS) {
    const docs = await db.collection(collection).find({}).sort({ _id: 1 }).toArray();
    for (const doc of docs) {
      const balance = balanceAt(doc, collection);
      assert.equal(Number.isFinite(balance), true, "non-finite balance");
      assert.equal(balance, collection === "corporations" ? holders * 90 : 10);
      assert.equal(doc.pendingMoneyMoveReceipt, undefined, "unfinished credit receipt");
      accounts.push({
        collection,
        id: doc._id,
        balance,
        settledKeys: [...(doc.settledKeys ?? [])].sort(),
      });
    }
  }
  assert.equal(accounts.length, holders + 1, "missing required account output");
  assert.equal(
    accounts.reduce((sum, account) => sum + account.balance, 0),
    holders * 100,
    "unexplained payout imbalance"
  );
  const journal = await db
    .collection<{ _id: string; status: string; legs: MoneyMoveRecordLeg[] }>("bankMoneyMoves")
    .findOne({ _id: key });
  assert.ok(journal, "missing settlement journal");
  assert.equal(journal?.status, "applied");
  assert.equal(journal.legs.length, holders + 1);
  assert.equal(
    journal.legs.every((leg) => leg.applied),
    true
  );
  return {
    accounts,
    journal: {
      status: journal.status,
      legs: journal.legs.map((leg) => ({
        kind: leg.kind,
        amount: leg.amount,
        applied: leg.applied,
      })),
    },
  };
}

async function caseRun(db: Db, holders: number, latencyMs: number, lostAcknowledgement: boolean) {
  const fixture = payoutFixture(holders);
  for (const collection of [...COLLECTIONS, "bankMoneyMoves", "bankingTelemetry"]) {
    await db.collection(collection).deleteMany({});
  }
  for (const [collection, docs] of Object.entries(fixture.documents)) {
    if (docs.length) await db.collection(collection).insertMany(docs);
  }
  resetRoundTripProfiler();
  const phase = "qualification:corporation-payout-primitive";
  beginPhaseProfiling(phase);
  const start = performance.now();
  const instrumented = delayedDb(db, latencyMs, lostAcknowledgement);
  try {
    if (lostAcknowledgement) {
      await assert.rejects(
        applyMoneyMove(instrumented, fixture.move),
        /lost credit acknowledgement/
      );
      assert.equal((await resumeMoneyMove(instrumented, fixture.move.key)).status, "applied");
    } else {
      assert.equal((await applyMoneyMove(instrumented, fixture.move)).status, "applied");
    }
  } finally {
    endPhaseProfiling(phase);
  }
  const elapsedMs = performance.now() - start;
  const resources = roundTripReport().find((entry) => entry.phase === phase);
  assert.ok(resources && resources.roundTrips > 0, "command monitor did not measure this run");
  const outcome = await outcomes(db, holders, fixture.move.key);
  assert.equal((await applyMoneyMove(db, fixture.move)).status, "replayed");
  assert.deepEqual(
    await outcomes(db, holders, fixture.move.key),
    outcome,
    "duplicate payout moved cash"
  );
  return {
    resourceComparison: lostAcknowledgement
      ? "diagnostic only: scalar and bulk acknowledgement loss interrupt different states"
      : "matched same-state baseline caps",
    holders,
    latencyMs,
    lostAcknowledgement,
    elapsedMs,
    resources,
    nodeLifetimePeakRssBytes: process.resourceUsage().maxRSS * 1024,
    nodeHeapUsedBytes: process.memoryUsage().heapUsed,
    outcomeHash: outcomeHash(outcome),
    outcome,
  };
}

type CaseReceipt = Awaited<ReturnType<typeof caseRun>>;
type Receipt = {
  fixture: string;
  harnessHash: string;
  sourceCommit: string;
  sourceDirty: boolean;
  capMs: number;
  cases: CaseReceipt[];
  status: string;
  errors: string[];
  environment: { node: string; mongo: string; dependencyHash: string };
  coverage: { scope: string; state: string; rng: string; unqualified: string[] };
  corporationPhaseBudget: number;
};

function compare(receipt: Receipt, baseline: Receipt): void {
  assert.equal(baseline.status, "passed", "baseline is not qualified");
  assert.equal(baseline.fixture, receipt.fixture);
  assert.equal(baseline.harnessHash, receipt.harnessHash, "different qualification harness");
  assert.deepEqual(baseline.environment, receipt.environment, "runtime or dependencies differ");
  assert.equal(baseline.cases.length, receipt.cases.length);
  for (const [index, run] of receipt.cases.entries()) {
    compareMatchedCase(baseline.cases[index], run, receipt.corporationPhaseBudget);
  }
}

async function main() {
  const receiptPath = argument("--receipt");
  assert.ok(receiptPath, "--receipt is required");
  // Never load .env.local or a configured connection. Remote telemetry is disabled.
  Object.assign(process.env, {
    NODE_ENV: "test",
    AHD_TURN_ROUNDTRIP_PROFILE: "1",
    OBSERVABILITY_DB_MONITOR: "false",
  });
  const receipt: Receipt = {
    fixture: FIXTURE_VERSION,
    harnessHash: outcomeHash([
      readFileSync(new URL(import.meta.url), "utf8"),
      readFileSync(new URL("./money-move-qualification-fixture.ts", import.meta.url), "utf8"),
    ]),
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    sourceDirty: Boolean(
      execFileSync("git", ["diff", "HEAD", "--", "src", "package-lock.json"], {
        encoding: "utf8",
      }).trim()
    ),
    capMs: CAP_MS,
    cases: [],
    status: "failed",
    errors: [],
    environment: {
      node: process.version,
      mongo: "",
      dependencyHash: outcomeHash(readFileSync("package-lock.json", "utf8")),
    },
    corporationPhaseBudget: PHASE_ROUND_TRIP_BUDGETS.corporationTurn,
    coverage: {
      scope: "corporation payout money-move primitive, not a whole phase or world",
      state: FIXTURE_VERSION,
      rng: "none; deterministic integer payouts",
      unqualified: [
        "whole corporation phase and cross-phase order",
        "first-world-turn initialization",
        "periodic settlement boundary",
        "aged-world accumulation",
        "simultaneous writers and service retries",
        "mongod and total host memory",
        "post-deployment observation",
      ],
    },
  };
  let isolated: IsolatedMongod | null = null;
  let client: MongoClient | null = null;
  let stopReason: string | null = null;
  const stop = (reason: string) => {
    stopReason = reason;
    // Stop the owned storage process before reporting a timeout. No writes can outlive it.
    if (isolated && !fixtureProcExited(isolated.proc)) isolated.proc.kill("SIGKILL");
    void client?.close().catch(() => {});
  };
  const onTerm = () => stop("interrupted by SIGTERM; owned mongod stopped");
  const onInt = () => stop("interrupted by SIGINT; owned mongod stopped");
  process.once("SIGTERM", onTerm);
  process.once("SIGINT", onInt);
  const timer = setTimeout(() => stop("10-minute cap exceeded; owned mongod stopped"), CAP_MS);
  try {
    assert.equal(receipt.sourceDirty, false, "source inputs must be committed");
    isolated = await startIsolatedMongod("ahd-payout-qualification-");
    assert.equal(stopReason, null);
    client = new MongoClient(isolated.uri, {
      monitorCommands: true,
      serverSelectionTimeoutMS: 2000,
    });
    await client.connect();
    receipt.environment.mongo = String(
      (await client.db().admin().command({ buildInfo: 1 })).version
    );
    attachMongoCommandMonitor(client);
    const db = client.db(isolated.dbName);
    for (const holders of [3, 12, 120]) {
      for (const latencyMs of [0, 3]) {
        receipt.cases.push(await caseRun(db, holders, latencyMs, false));
      }
    }
    receipt.cases.push(await caseRun(db, 12, 3, true));
    assert.equal(stopReason, null);
    const baselinePath = argument("--baseline");
    if (baselinePath) compare(receipt, JSON.parse(readFileSync(baselinePath, "utf8")) as Receipt);
    receipt.status = "passed";
  } catch (error) {
    receipt.errors.push(stopReason ?? String(error));
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    await client?.close().catch((error: unknown) => {
      receipt.status = "failed";
      receipt.errors.push(String(error));
      process.exitCode = 1;
    });
    await stopIsolatedMongod(isolated);
    if (isolated && !fixtureProcExited(isolated.proc)) {
      receipt.status = "failed";
      receipt.errors.push("Owned mongod exit could not be confirmed");
      process.exitCode = 1;
    }
    writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n");
    process.removeListener("SIGTERM", onTerm);
    process.removeListener("SIGINT", onInt);
  }
  console.log(`${receipt.status}: ${receipt.cases.length} primitive cases; receipt written`);
}

void main().catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
});
