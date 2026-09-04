/**
 * Differential proof that the batched index-fund dividend pass-through is
 * behaviourally identical to the per-accrual path.
 *
 * `src/lib/turn/corporation/index.ts` gates `processIndexFundDividendsBatch`
 * behind AHD_BATCH_FUND_DIVIDENDS and its comment claims the two are
 * "verified by an equivalence test". No such test exists, which is why the
 * flag was never flipped despite the same comment calling it "the single
 * biggest turn-time win".
 *
 * A mock-DB unit test cannot carry that claim: what has to match is the final
 * state in Mongo across five collections. So this runs both paths over the
 * SAME real starting state and diffs.
 *
 *   snapshot -> run per-accrual path -> capture A -> restore
 *            -> run batched path     -> capture B -> diff A vs B
 *
 * Fields excluded from the diff are the ones the batch path is documented to
 * differ on and which carry no game meaning: `updatedAt`/`createdAt` (the
 * batch shares one turn-instant instead of per-call `new Date()`) and the
 * `_id` of newly inserted transaction rows.
 *
 * Local databases only. Usage, from a worktree with a local .env.local:
 *   npx tsx scripts/perf/dividend-equivalence.ts [--accruals 200]
 */

import { connectDb, closeDb } from "../utils/db";
import { MongoClient, ObjectId, type Db } from "mongodb";

/**
 * True when a Mongo URI addresses this machine. This harness destroys and
 * restores collections, so it must never be pointed at a shared database.
 */
function isLocalMongoUri(uri: string): boolean {
  if (uri.startsWith("mongodb+srv://")) return false;
  const hosts = uri.replace(/^mongodb:\/\//, "").split("/")[0].split("@").pop();
  if (!hosts) return false;
  return hosts.split(",").every((hostPort) => {
    const host = hostPort.split(":")[0];
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  });
}

/** Every collection either dividend path writes to. */
const TOUCHED = [
  "indexFunds",
  "indexFundPositions",
  "indexFundTransactions",
  "characters",
  "imperialCharacters",
  "npps",
] as const;

const VOLATILE_FIELDS = new Set(["updatedAt", "createdAt", "_id"]);

type Snapshot = Record<string, unknown[]>;

function argNumber(flag: string, fallback: number): number {
  const i = process.argv.indexOf(flag);
  if (i === -1) return fallback;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) ? n : fallback;
}

async function snapshot(db: Db): Promise<Snapshot> {
  const out: Snapshot = {};
  for (const name of TOUCHED) {
    out[name] = await db.collection(name).find({}).sort({ _id: 1 }).toArray();
  }
  return out;
}

async function restore(db: Db, snap: Snapshot): Promise<void> {
  for (const name of TOUCHED) {
    await db.collection(name).deleteMany({});
    const docs = snap[name] ?? [];
    if (docs.length > 0) await db.collection(name).insertMany(docs as never[], { ordered: false });
  }
}

/**
 * Stable, comparable form of a document: volatile fields dropped, ObjectIds
 * and Dates flattened to strings, keys sorted so ordering never matters.
 */
function normalize(value: unknown): unknown {
  if (value instanceof ObjectId) return value.toString();
  if (value instanceof Date) return "<date>";
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      if (VOLATILE_FIELDS.has(key)) continue;
      out[key] = normalize(obj[key]);
    }
    return out;
  }
  // Numbers are compared separately, with a tolerance: see numericDeviations.
  // Stringifying them here would make last-bit float noise look like a
  // behavioural difference.
  if (typeof value === "number" && !Number.isInteger(value)) return "<number>";
  return value;
}

/** Transaction rows get fresh _ids per run, so compare them as a sorted multiset. */
function comparableRows(name: string, docs: unknown[]): string[] {
  const rows = docs.map((d) => JSON.stringify(normalize(d)));
  return name === "indexFundTransactions" ? rows.sort() : rows;
}

/**
 * Largest disagreement between the two paths across every numeric field.
 *
 * The paths cannot be bit-identical and are not meant to be: the per-accrual
 * path issues N separate `$inc`s that Mongo accumulates one at a time, while
 * the batch sums in JS and issues one. Double addition is not associative, so
 * the totals differ in the last bits. What matters is whether that ever
 * reaches an amount a player could notice, so measure it rather than round it
 * away.
 */
function numericDeviations(
  a: unknown,
  b: unknown,
  path = ""
): { path: string; abs: number; rel: number }[] {
  if (typeof a === "number" && typeof b === "number") {
    if (a === b) return [];
    const abs = Math.abs(a - b);
    const scale = Math.max(Math.abs(a), Math.abs(b));
    return [{ path, abs, rel: scale === 0 ? abs : abs / scale }];
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.flatMap((item, i) => numericDeviations(item, b[i], `${path}[${i}]`));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    return Object.keys(left)
      .filter((k) => !VOLATILE_FIELDS.has(k))
      .flatMap((k) => numericDeviations(left[k], right[k], path ? `${path}.${k}` : k));
  }
  return [];
}

/** One cent. Below this, no player-visible balance differs. */
const MATERIAL_ABS = 0.01;

function diff(a: Snapshot, b: Snapshot): string[] {
  const problems: string[] = [];
  for (const name of TOUCHED) {
    const left = comparableRows(name, a[name] ?? []);
    const right = comparableRows(name, b[name] ?? []);
    if (left.length !== right.length) {
      problems.push(`${name}: ${left.length} docs after per-call, ${right.length} after batch`);
      continue;
    }
    let shown = 0;
    for (let i = 0; i < left.length; i++) {
      if (left[i] === right[i]) continue;
      if (shown < 3) {
        problems.push(
          `${name}[${i}] differs:\n    per-call: ${left[i]}\n    batch:    ${right[i]}`
        );
        shown++;
      }
    }
    if (shown === 3) problems.push(`${name}: ...further differences suppressed`);
  }
  return problems;
}

function reportNumericDrift(
  a: Snapshot,
  b: Snapshot
): { worstAbs: number; worstRel: number; material: string[] } {
  let worstAbs = 0;
  let worstRel = 0;
  const material: string[] = [];
  for (const name of TOUCHED) {
    const left = (a[name] ?? []).slice().sort(byId);
    const right = (b[name] ?? []).slice().sort(byId);
    if (left.length !== right.length) continue;
    for (let i = 0; i < left.length; i++) {
      for (const d of numericDeviations(left[i], right[i], `${name}[${i}]`)) {
        if (d.abs > worstAbs) worstAbs = d.abs;
        if (d.rel > worstRel) worstRel = d.rel;
        if (d.abs >= MATERIAL_ABS && material.length < 5) {
          material.push(`${d.path}: differs by ${d.abs} (relative ${d.rel.toExponential(2)})`);
        }
      }
    }
  }
  return { worstAbs, worstRel, material };
}

function byId(x: unknown, y: unknown): number {
  const a = String((x as { _id?: unknown })?._id ?? "");
  const b = String((y as { _id?: unknown })?._id ?? "");
  return a < b ? -1 : a > b ? 1 : 0;
}

async function main() {
  const uri = process.env.MONGODB_URI ?? "";
  if (!isLocalMongoUri(uri)) {
    throw new Error(`Refusing to run against a non-local database (${uri || "unset"}).`);
  }

  // A second client with command monitoring on. Wall-clock on a local mongod
  // says little about production, where Mongo is remote and every round trip
  // costs 1-5ms instead of ~0.05ms. Round-trip COUNT is latency-independent,
  // so it is the number that actually predicts the production win.
  const meterClient = new MongoClient(uri, { monitorCommands: true });
  await meterClient.connect();
  const meteredDb = meterClient.db();
  let commandCount = 0;
  let counting = false;
  meterClient.on("commandStarted", (event) => {
    // Ignore driver housekeeping; count only real data operations.
    if (counting && !["ping", "hello", "ismaster", "endSessions"].includes(event.commandName)) {
      commandCount += 1;
    }
  });

  const db = meteredDb;
  const { processIndexFundDividend, processIndexFundDividendsBatch } =
    await import("@/lib/indexFunds/dividendPassThrough");

  // Build accruals from real funds and real constituent corporations, so the
  // shapes match what corporationTurn actually produces.
  const funds = await db.collection("indexFunds").find({}).limit(40).toArray();
  const corps = await db.collection("corporations").find({}).limit(80).toArray();
  if (funds.length === 0 || corps.length === 0) {
    throw new Error(
      `Need seeded funds and corporations (funds=${funds.length}, corps=${corps.length}).`
    );
  }

  const wanted = argNumber("--accruals", 200);
  const adversarial = process.argv.includes("--adversarial");
  const accruals = [];
  for (let i = 0; i < wanted; i++) {
    const fund = funds[i % funds.length]!;
    const corp = corps[(i * 7) % corps.length]!;
    accruals.push({
      fundId: fund._id as ObjectId,
      corporationId: corp._id as ObjectId,
      // Deterministic, non-round amounts so 2dp flooring is actually exercised.
      amountAnchor: Number((1000 + ((i * 37) % 9000) + i / 7).toFixed(4)),
      shares: 100 + ((i * 13) % 900),
    });
  }

  // The cases where an aggregate-then-write path usually diverges from a
  // write-per-call one: repeated keys that must sum, sub-cent amounts that
  // floor to nothing individually but not together, and values both paths
  // are supposed to reject outright.
  if (adversarial) {
    const fund = funds[0]!._id as ObjectId;
    const corp = corps[0]!._id as ObjectId;
    const other = corps[1]!._id as ObjectId;
    for (let i = 0; i < 40; i++) {
      accruals.push({ fundId: fund, corporationId: corp, amountAnchor: 0.004, shares: 1 });
    }
    for (const amount of [0, -1, -0.5, Number.NaN, Number.POSITIVE_INFINITY, 0.001, 0.005, 0.01]) {
      accruals.push({ fundId: fund, corporationId: other, amountAnchor: amount, shares: 5 });
    }
    accruals.push({ fundId: fund, corporationId: corp, amountAnchor: 1e9, shares: 0 });
    accruals.push({ fundId: fund, corporationId: corp, amountAnchor: 123.456789, shares: -10 });
    console.log(`Plus ${accruals.length - wanted} adversarial accruals.`);
  }
  console.log(
    `Comparing ${accruals.length} accruals across ${funds.length} funds and ${corps.length} corporations.`
  );

  const baseline = await snapshot(db);

  counting = true;
  commandCount = 0;
  const t0 = Date.now();
  for (const a of accruals) {
    await processIndexFundDividend(db, a.fundId, a.amountAnchor, a.corporationId, a.shares, {
      turn: 2,
    });
  }
  const perCallMs = Date.now() - t0;
  const perCallRoundTrips = commandCount;
  counting = false;
  const afterPerCall = await snapshot(db);

  await restore(db, baseline);

  counting = true;
  commandCount = 0;
  const t1 = Date.now();
  await processIndexFundDividendsBatch(db, accruals, { turn: 2 });
  const batchMs = Date.now() - t1;
  const batchRoundTrips = commandCount;
  counting = false;
  const afterBatch = await snapshot(db);

  const problems = diff(afterPerCall, afterBatch);
  const drift = reportNumericDrift(afterPerCall, afterBatch);

  console.log(`\nper-accrual path: ${perCallMs} ms, ${perCallRoundTrips} Mongo round trips`);
  console.log(`batched path:     ${batchMs} ms, ${batchRoundTrips} Mongo round trips`);
  if (batchMs > 0) console.log(`local speedup:    ${(perCallMs / batchMs).toFixed(1)}x wall clock`);
  if (batchRoundTrips > 0) {
    const saved = perCallRoundTrips - batchRoundTrips;
    console.log(
      `round trips saved: ${saved} (${(perCallRoundTrips / batchRoundTrips).toFixed(1)}x fewer)`
    );
    // Production Mongo is remote. Project the saving across a plausible range.
    for (const rttMs of [1, 3, 5]) {
      console.log(
        `  at ${rttMs}ms RTT that is ~${((saved * rttMs) / 1000).toFixed(1)}s off the turn`
      );
    }
  }

  console.log(
    `\nlargest numeric drift: ${drift.worstAbs.toExponential(2)} absolute, ` +
      `${drift.worstRel.toExponential(2)} relative` +
      (drift.material.length === 0 ? " (nothing reaches one cent)" : "")
  );
  for (const m of drift.material) console.log(`  MATERIAL: ${m}`);

  if (problems.length === 0 && drift.material.length === 0) {
    console.log(`EQUIVALENT: all ${TOUCHED.length} written collections match to within a cent.`);
  } else {
    problems.push(...drift.material);
    console.log(`\nNOT EQUIVALENT (${problems.length} finding(s)):`);
    for (const p of problems) console.log("  - " + p);
    process.exitCode = 1;
  }

  // Leave the world as it was found.
  await restore(db, baseline);
  console.log("Restored the starting state.");
  await meterClient.close();
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
