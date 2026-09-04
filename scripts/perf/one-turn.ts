/**
 * Run exactly one turn, in-process, so it can be CPU-profiled.
 *
 * Singleplayer and production are bound by different things. Production talks
 * to a remote Mongo, so its turn cost is round trips x latency and the fix is
 * batching queries (see mongoRoundTrips.ts). Singleplayer runs the database on
 * the player's own machine, where a round trip is ~0.05ms, so batching buys
 * nothing and the turn is bound by actual CPU work.
 *
 * That work is invisible to the round-trip profiler, so profile it directly:
 *
 *   npx tsx scripts/perf/one-turn.ts --profile /path/to/out.cpuprofile
 *
 * The profile is taken through the inspector API and written as soon as the
 * turn returns, rather than via `node --cpu-prof`, which only writes on a
 * clean process exit. The turn leaves timers and pooled connections behind
 * that keep the event loop busy afterwards, so exit-time writing never
 * happened and the profile was lost.
 *
 * Local databases only.
 */

import { writeFileSync } from "node:fs";
import { Session } from "node:inspector/promises";
import { connectDb, closeDb } from "../utils/db";
import { isLocalMongoUri } from "@/lib/singleplayer";

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const uri = process.env.MONGODB_URI ?? "";
  if (!isLocalMongoUri(uri)) {
    throw new Error(`Refusing to run against a non-local database (${uri || "unset"}).`);
  }

  const db = await connectDb();

  // A turn aborted by a previous profiling run leaves the lock set; clear it
  // so the profile is of a turn that actually ran rather than of an early
  // return. Only ever reached on a local database.
  const before = await db
    .collection<{ _id: string; isProcessing?: boolean; currentTurn?: number }>("gameState")
    .findOne({ _id: "current" }, { projection: { isProcessing: 1, currentTurn: 1 } });
  if (before?.isProcessing) {
    console.log("Clearing a stale local processing lock before profiling.");
    await db
      .collection<{ _id: string; isProcessing?: boolean }>("gameState")
      .updateOne({ _id: "current" }, { $set: { isProcessing: false } });
  }
  console.log(`Starting from turn ${before?.currentTurn ?? "?"}.`);

  const profilePath = argValue("--profile");
  let session: Session | null = null;
  if (profilePath) {
    session = new Session();
    session.connect();
    await session.post("Profiler.enable");
    // 1000us sampling: fine enough to separate functions across a ~30s turn
    // without the profile itself becoming the hot path.
    await session.post("Profiler.setSamplingInterval", { interval: 1000 });
    await session.post("Profiler.start");
  }

  const { processTurn } = await import("@/lib/turnSystem");
  const started = Date.now();
  const result = await processTurn();
  const elapsedMs = Date.now() - started;

  if (session && profilePath) {
    const { profile } = await session.post("Profiler.stop");
    writeFileSync(profilePath, JSON.stringify(profile));
    session.disconnect();
    console.log(`wrote ${profilePath}`);
  }

  console.log(`turn ${result.turn}: ${(elapsedMs / 1000).toFixed(1)}s — ${result.message}`);
  if (result.warnings.length > 0) {
    for (const warning of result.warnings) console.log(`  warning: ${warning}`);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
    // The turn leaves timers and pooled sockets behind. Nothing here needs to
    // outlive it, and waiting on them is what lost the profile before.
    process.exit(process.exitCode ?? 0);
  });
