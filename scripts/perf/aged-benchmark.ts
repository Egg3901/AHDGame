/**
 * Aged-world turn benchmark and qualification gate (#2696).
 *
 * Restores a world snapshot (mongodump --gzip --archive) into a scratch
 * database, runs real turns in-process with a fixed RNG seed, and reports
 * whole-turn and per-phase wall time and Mongo round trips separately for
 * quiet, NPP-action, fund-rebalance and election-deadline turns. A faster
 * quiet turn must not hide a slower boundary turn, and a young world
 * understates steady-state cost by about half, so use a turn 240+ snapshot.
 *
 *   npm run perf:aged-benchmark -- --archive <file.archive.gz> \
 *     --source-db <db name inside the archive> [--turns 1] [--warmup 1] \
 *     [--seed aged-benchmark] [--mongo mongodb://127.0.0.1:27018] \
 *     [--bench-db ahd_sim_bench_default] [--json out.json] \
 *     [--baseline before.json] [--wall-tolerance 0.1] [--rt-tolerance 0.05]
 *
 * Gate procedure for a turn performance PR: run once on the base revision with
 * `--json before.json`, then on the PR revision with `--baseline before.json`.
 * Pick `--turns` so every case the change touches is measured (24 turns from a
 * snapshot at a multiple of 24 covers all three cadences). The run exits 1
 * when the two results are not comparable (different snapshot, start turn,
 * seed or feature posture), when a baseline case is missing, or when a case or
 * phase regresses past the tolerance; see src/lib/observability/benchmarkGate.ts.
 * Paste the printed verdict into the PR.
 *
 * Safety: local Mongo only; only drops and restores a database whose name
 * starts with `ahd_sim_bench_`; refuses unless the restored world has
 * gameConfig.simSandbox set. Needs mongorestore on PATH.
 *
 * The first turn after a restore runs against a cold cache and freshly built
 * indexes, so `--warmup` turns run first and are left out of the summary.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { MongoClient } from "mongodb";
import {
  buildBenchmarkResult,
  compareBenchmarks,
  DEFAULT_BENCHMARK_TOLERANCE,
  featurePostureEntries,
  type BenchmarkResult,
} from "../../src/lib/observability/benchmarkGate";
import {
  attributeTurn,
  summarize,
  SUBSYSTEMS,
  type TurnLogLike,
} from "../../src/lib/observability/turnAttribution";

function arg(flag: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : process.argv[i + 1];
}

function isLocal(uri: string): boolean {
  const host =
    uri
      .replace(/^mongodb:\/\//, "")
      .split("/")[0]
      .split("@")
      .pop() ?? "";
  return host
    .split(",")
    .every((h) => ["localhost", "127.0.0.1", "::1", "[::1]"].includes(h.split(":")[0]));
}

const s = (ms: number) => (ms / 1000).toFixed(1).padStart(7);

/** Same mulberry-style generator the world sim harness uses for its run seed. */
function seededRandom(seedText: string): () => number {
  let state = 2_166_136_261;
  for (let index = 0; index < seedText.length; index++) {
    state ^= seedText.charCodeAt(index);
    state = Math.imul(state, 16_777_619);
  }
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function sourceRevision(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

async function main() {
  const archive = arg("--archive");
  const sourceDb = arg("--source-db");
  const mongo = arg("--mongo", "mongodb://127.0.0.1:27018")!;
  const benchDb = arg("--bench-db", "ahd_sim_bench_default")!;
  const turns = Number(arg("--turns", "1"));
  const warmup = Number(arg("--warmup", "1"));
  const seed = arg("--seed", "aged-benchmark")!;
  const baselinePath = arg("--baseline");
  if (!archive || !sourceDb) throw new Error("--archive and --source-db are required");
  if (!isLocal(mongo)) throw new Error(`Refusing a non-local Mongo: ${mongo}`);
  if (!benchDb.startsWith("ahd_sim_bench_"))
    throw new Error("--bench-db must start with ahd_sim_bench_");

  const client = new MongoClient(mongo, { maxPoolSize: 2 });
  await client.connect();
  try {
    await client.db(benchDb).dropDatabase();
    console.log(`Restoring ${sourceDb} into ${benchDb}...`);
    execFileSync(
      "mongorestore",
      [
        "--quiet",
        `--uri=${mongo}/`,
        "--gzip",
        `--archive=${archive}`,
        `--nsFrom=${sourceDb}.*`,
        `--nsTo=${benchDb}.*`,
        "--drop",
      ],
      { stdio: "inherit" }
    );
    const db = client.db(benchDb);
    const config = await db
      .collection<{ _id: string; simSandbox?: boolean }>("gameConfig")
      .findOne({ _id: "default" });
    if (config?.simSandbox !== true)
      throw new Error("Restored world is not a sandbox (gameConfig.simSandbox)");
    const start = await db
      .collection<{ _id: string; currentTurn?: number }>("gameState")
      .findOne({ _id: "current" });
    console.log(
      `Restored at turn ${start?.currentTurn}. Running ${warmup} warm-up and ${turns} measured turn(s)...`
    );

    const startTurn = start?.currentTurn ?? 0;
    const [postureConfig, postureState] = await Promise.all([
      db.collection("gameConfig").findOne({ _id: "default" as never }),
      db.collection("gameState").findOne({ _id: "current" as never }),
    ]);
    const featurePosture = createHash("sha256")
      .update(JSON.stringify(featurePostureEntries(postureConfig, postureState)))
      .digest("hex")
      .slice(0, 16);

    process.env.MONGODB_URI = `${mongo}/${benchDb}`;
    // Fixed seed for every engine Math.random caller and salted engine RNG, so
    // both sides of a comparison draw the same numbers.
    process.env.SIM_RNG_SALT = seed;
    Math.random = seededRandom(seed);
    const { processTurn } = await import("@/lib/turnSystem");
    for (let i = 0; i < warmup + turns; i++) {
      const t0 = Date.now();
      const result = await processTurn();
      console.log(
        `turn ${result.turn}: ${((Date.now() - t0) / 1000).toFixed(1)}s ${result.success ? "ok" : "FAILED"}${i < warmup ? " (warm-up)" : ""}`
      );
    }

    const logs = (await db
      .collection<TurnLogLike & { turn: number }>("turnLogs")
      .find({ turn: { $gt: startTurn + warmup } })
      .sort({ turn: 1 })
      .toArray()) as TurnLogLike[];
    const measured = logs.map((l) => l.turn);
    const deadlineRows = await db
      .collection<{ endTurn?: number; primaryEndTurn?: number }>("elections")
      .find(
        { $or: [{ endTurn: { $in: measured } }, { primaryEndTurn: { $in: measured } }] },
        { projection: { endTurn: 1, primaryEndTurn: 1 } }
      )
      .toArray();
    const electionDeadlineTurns = new Set(
      deadlineRows
        .flatMap((row) => [row.endTurn, row.primaryEndTurn])
        .filter((t): t is number => t != null && measured.includes(t))
    );
    const result = buildBenchmarkResult({
      identity: {
        snapshot: basename(archive),
        sourceDb,
        startTurn,
        warmupTurns: warmup,
        rngSeed: seed,
        featurePosture,
      },
      sourceRevision: sourceRevision(),
      logs,
      electionDeadlineTurns,
    });
    const rows = logs.map(attributeTurn);
    const summary = summarize(rows);
    console.log(
      `\nMean turn ${s(summary.meanWallMs).trim()} s over ${rows.length} turn(s); min coverage ${(summary.minCoverage * 100).toFixed(1)}%`
    );
    for (const name of SUBSYSTEMS)
      console.log(`  ${name.padEnd(28)} ${s(summary.subsystemMeanMs[name])} s`);

    const substeps = new Map<string, number>();
    for (const log of logs) {
      for (const [phase, status] of Object.entries(log.phaseStatuses ?? {})) {
        for (const [step, v] of Object.entries(
          (status as { substeps?: Record<string, { ms: number }> }).substeps ?? {}
        )) {
          substeps.set(`${phase}.${step}`, (substeps.get(`${phase}.${step}`) ?? 0) + v.ms);
        }
      }
    }
    console.log("\nTop sub-steps (s per turn)");
    for (const [k, ms] of [...substeps].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
      console.log(`  ${k.padEnd(48)} ${s(ms / Math.max(1, logs.length))}`);
    }
    console.log("\nPer case (median)");
    for (const [name, c] of Object.entries(result.cases)) {
      console.log(
        `  ${name.padEnd(18)} ${s(c.medianWallMs)} s  ${String(Math.round(c.medianRoundTrips)).padStart(7)} round trips  turns ${c.turns.join(",")}`
      );
    }
    const out = arg("--json");
    if (out)
      writeFileSync(
        out,
        JSON.stringify(
          { ...result, summary, rows, substeps: Object.fromEntries(substeps) },
          null,
          2
        )
      );

    if (baselinePath) {
      const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as BenchmarkResult;
      const verdict = compareBenchmarks(baseline, result, {
        ...DEFAULT_BENCHMARK_TOLERANCE,
        wall: Number(arg("--wall-tolerance", String(DEFAULT_BENCHMARK_TOLERANCE.wall))),
        roundTrips: Number(arg("--rt-tolerance", String(DEFAULT_BENCHMARK_TOLERANCE.roundTrips))),
      });
      console.log(
        `\nGate vs ${baseline.sourceRevision.slice(0, 10)}: ${verdict.ok ? "PASS" : "FAIL"}`
      );
      for (const line of verdict.mismatches) console.log(`  not comparable: ${line}`);
      for (const name of verdict.missingCases) console.log(`  missing case: ${name}`);
      for (const line of verdict.regressions) console.log(`  regression: ${line}`);
      for (const line of verdict.improvements) console.log(`  improved: ${line}`);
      if (!verdict.ok) process.exitCode = 1;
    }
  } finally {
    await client.close();
    process.exit(process.exitCode ?? 0);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
