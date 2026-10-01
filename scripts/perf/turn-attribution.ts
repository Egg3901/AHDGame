/**
 * Interval-based turn attribution report (#2691). Read-only.
 *
 * Reads `turnLogs.phaseStatuses` and splits each turn's wall time across the
 * phases and subsystems open during it, instead of summing per-phase `ms`
 * (which double-counts every concurrent group). Use this as the before/after
 * evidence format for turn performance work.
 *
 *   npx tsx scripts/perf/turn-attribution.ts [--last 60] [--from 1195 --to 1254] [--json out.json] [--top 20]
 *
 * Uses MONGODB_URI from .env.local. Issues only `find` on `turnLogs`.
 */

import { writeFileSync } from "node:fs";
import { connectDb, closeDb } from "../utils/db";
import {
  attributeTurn,
  summarize,
  SUBSYSTEMS,
  type TurnLogLike,
} from "../../src/lib/observability/turnAttribution";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

const s = (ms: number) => (ms / 1000).toFixed(1).padStart(7);

async function main() {
  const db = await connectDb();
  const from = arg("--from");
  const to = arg("--to");
  const last = Number(arg("--last") ?? 60);
  const top = Number(arg("--top") ?? 20);
  const filter =
    from || to
      ? { turn: { ...(from ? { $gte: Number(from) } : {}), ...(to ? { $lte: Number(to) } : {}) } }
      : {};
  const cursor = db
    .collection<TurnLogLike>("turnLogs")
    .find(filter, { projection: { turn: 1, realTime: 1, durationMs: 1, phaseStatuses: 1 } })
    .sort({ turn: -1 });
  const logs = (from || to ? await cursor.toArray() : await cursor.limit(last).toArray())
    .filter((log) => typeof log.durationMs === "number" && log.realTime != null)
    .reverse();
  if (logs.length === 0) throw new Error("No turn logs matched");

  const rows = logs.map(attributeTurn);
  const summary = summarize(rows);
  const meanWall = summary.meanWallMs;

  console.log(
    `Turns ${rows[0].turn} to ${rows.at(-1)!.turn} (${rows.length}); ` +
      `median ${s(summary.medianWallMs).trim()} s, mean ${s(meanWall).trim()} s; ` +
      `min phase coverage ${(summary.minCoverage * 100).toFixed(2)}%`
  );
  console.log("\nSubsystem (mean per turn, interval-attributed)");
  for (const name of SUBSYSTEMS) {
    const ms = summary.subsystemMeanMs[name];
    console.log(
      `  ${name.padEnd(28)} ${s(ms)} s  ${((100 * ms) / meanWall).toFixed(1).padStart(5)}%`
    );
  }
  console.log("\nCadence tier (median)");
  for (const [tier, t] of Object.entries(summary.byTier)) {
    if (t.turns === 0) continue;
    console.log(
      `  ${tier.padEnd(14)} ${String(t.turns).padStart(3)} turns  ${s(t.medianWallMs)} s  ` +
        `${Math.round(t.medianRoundTrips).toLocaleString("en-US")} round trips`
    );
  }

  const phaseTotals = new Map<string, { ms: number; rt: number }>();
  for (const row of rows) {
    for (const [name, ms] of Object.entries(row.phaseMs)) {
      const cur = phaseTotals.get(name) ?? { ms: 0, rt: 0 };
      cur.ms += ms;
      cur.rt += row.phaseRoundTrips[name] ?? 0;
      phaseTotals.set(name, cur);
    }
  }
  console.log(`\nTop ${top} phases (attributed s per turn, round trips per turn)`);
  for (const [name, t] of [...phaseTotals].sort((a, b) => b[1].ms - a[1].ms).slice(0, top)) {
    console.log(
      `  ${name.padEnd(34)} ${s(t.ms / rows.length)} s  ${Math.round(t.rt / rows.length)
        .toLocaleString("en-US")
        .padStart(7)}`
    );
  }
  if (summary.unmappedPhases.length > 0) {
    console.log(
      `\nUnmapped phases (add to turnAttribution.ts): ${summary.unmappedPhases.join(", ")}`
    );
  }

  const out = arg("--json");
  if (out) writeFileSync(out, JSON.stringify({ summary, rows }, null, 2));
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
