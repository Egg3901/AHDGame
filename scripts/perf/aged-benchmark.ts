/**
 * Aged-world turn benchmark (#2696).
 *
 * Restores a world snapshot (mongodump --gzip --archive) into a scratch
 * database, runs one or more real turns in-process, and prints interval-based
 * attribution plus per-phase sub-steps for those turns. Use it as the before
 * and after gate for turn performance work: the same snapshot, source and
 * flags on both sides, an aged world rather than a fresh one.
 *
 *   npx tsx scripts/perf/aged-benchmark.ts --archive <file.archive.gz> \
 *     --source-db <db name inside the archive> [--turns 1] [--warmup 1] \
 *     [--mongo mongodb://127.0.0.1:27018] [--bench-db ahd_sim_bench_default] [--json out.json]
 *
 * Safety: local Mongo only; only drops and restores a database whose name
 * starts with `ahd_sim_bench_`; refuses unless the restored world has
 * gameConfig.simSandbox set. Needs mongorestore on PATH.
 *
 * The first turn after a restore runs against a cold cache and freshly built
 * indexes, so `--warmup` turns run first and are left out of the summary.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { MongoClient } from "mongodb";
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

async function main() {
  const archive = arg("--archive");
  const sourceDb = arg("--source-db");
  const mongo = arg("--mongo", "mongodb://127.0.0.1:27018")!;
  const benchDb = arg("--bench-db", "ahd_sim_bench_default")!;
  const turns = Number(arg("--turns", "1"));
  const warmup = Number(arg("--warmup", "1"));
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

    process.env.MONGODB_URI = `${mongo}/${benchDb}`;
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
      .find({ turn: { $gt: (start?.currentTurn ?? 0) + warmup } })
      .sort({ turn: 1 })
      .toArray()) as TurnLogLike[];
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
    const out = arg("--json");
    if (out)
      writeFileSync(
        out,
        JSON.stringify({ summary, rows, substeps: Object.fromEntries(substeps) }, null, 2)
      );
  } finally {
    await client.close();
    process.exit(process.exitCode ?? 0);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
