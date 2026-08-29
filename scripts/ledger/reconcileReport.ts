/**
 * Shadow-ledger reconciliation report for a sandbox sim DB.
 *
 * Prints the latest reconciliation as a green/amber/red Watchtower section, a
 * per-turn status trend, and the aggregated Phase 3 backlog (unattributed emit
 * sites ranked by ₳). Also estimates the ledger turn-time overhead from
 * turnLogs telemetry. Attach the output to the shadow-ledger PR.
 *
 * Usage:
 *   SIM_MONGODB_URI=mongodb://127.0.0.1:27018 \
 *     npx tsx scripts/ledger/reconcileReport.ts --db=ahd_sim_ledger150 [--backlog-out=path.md]
 *
 * Prod Mongo (rs0) needs directConnection=true in the URI; never point this at
 * a real world with intent to mutate — this script is read-only.
 */

// Module marker — keeps this file's top-level `arg`/`main` out of the shared
// global-script scope other scripts/*.ts live in (avoids duplicate-impl errors).
export {};

function arg(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  return process.argv.find((v) => v.startsWith(prefix))?.slice(prefix.length);
}

const SIM_MONGODB_URI = process.env.SIM_MONGODB_URI ?? process.env.MONGODB_URI;
if (!SIM_MONGODB_URI) {
  console.error("SIM_MONGODB_URI (or MONGODB_URI) is required.");
  process.exit(1);
}
const dbName = arg("db");
if (!dbName) {
  console.error("--db=<sandbox db name> is required.");
  process.exit(1);
}

(process.env as { NODE_ENV: string }).NODE_ENV = "test";
process.env.MONGODB_URI = SIM_MONGODB_URI;
process.env.MONGODB_DB = dbName;

async function main() {
  const { writeFileSync } = await import("node:fs");
  const { getDb } = await import("@/lib/mongodb");
  const { formatReconciliationMarkdown, buildWatchtowerSection } =
    await import("@/lib/ledger/report");
  const { LEDGER_RECONCILIATIONS_COLLECTION } = await import("@/lib/ledger/reconcile");
  type Recon = import("@/lib/ledger/types").LedgerReconciliation;

  const db = await getDb();
  const recons = db.collection<Recon>(LEDGER_RECONCILIATIONS_COLLECTION);
  const total = await recons.countDocuments();
  if (total === 0) {
    console.log("No ledgerReconciliations found — was the sim run with ledgerShadow on?");
    return;
  }

  const all = await recons.find({}).sort({ turn: 1 }).toArray();
  const latest = all[all.length - 1];

  const statusCounts = { green: 0, amber: 0, red: 0 };
  let maxUnbalanced = 0;
  let maxDivergent = 0;
  for (const r of all) {
    statusCounts[r.status] += 1;
    maxUnbalanced = Math.max(maxUnbalanced, r.trialBalance.unbalancedCount);
    maxDivergent = Math.max(maxDivergent, r.stockVsFlow.divergentCount ?? 0);
  }

  // Aggregate the Phase 3 backlog across every turn.
  const backlog = new Map<string, { txType: string; emitSite: string; anchorAmount: number }>();
  for (const r of all) {
    for (const u of r.unattributed) {
      const key = `${u.txType}@${u.emitSite}`;
      const prev = backlog.get(key) ?? { txType: u.txType, emitSite: u.emitSite, anchorAmount: 0 };
      prev.anchorAmount += u.anchorAmount;
      backlog.set(key, prev);
    }
  }
  const rankedBacklog = [...backlog.values()].sort((a, b) => b.anchorAmount - a.anchorAmount);

  // Turn-time overhead from turnLogs telemetry (phaseStatuses durations).
  const overhead = await estimateOverhead(db);

  const { _id: _drop, ...latestReport } = latest;
  void _drop;

  console.log("=".repeat(72));
  console.log("SHADOW LEDGER — 150-TURN SIM RECONCILER REPORT");
  console.log("=".repeat(72));
  console.log(`Reconciliations: ${total}  (turns ${all[0].turn}..${latest.turn})`);
  console.log(
    `Status distribution: 🟢 ${statusCounts.green}  🟡 ${statusCounts.amber}  🔴 ${statusCounts.red}`
  );
  console.log(`Max unbalanced entries in any turn (trial-balance breaks): ${maxUnbalanced}`);
  console.log(`Max stock-vs-flow divergent accounts in any turn: ${maxDivergent}`);
  if (overhead) {
    console.log(
      `Ledger turn-time overhead: ${overhead.pct.toFixed(2)}% ` +
        `(${overhead.ledgerMs.toFixed(0)}ms of ${overhead.totalMs.toFixed(0)}ms avg turn)`
    );
  } else {
    console.log("Ledger turn-time overhead: (no phase-duration telemetry found)");
  }
  console.log("");
  console.log(buildWatchtowerSection(latestReport, { enabled: true }).headline);
  console.log("");
  console.log(formatReconciliationMarkdown(latestReport));
  console.log("");
  console.log("### Aggregated Phase 3 backlog (all turns, top 30 by ₳)");
  console.log("");
  console.log("| ₳ (abs, cumulative) | txType | emitSite |");
  console.log("| ---: | --- | --- |");
  for (const b of rankedBacklog.slice(0, 30)) {
    console.log(`| ${Math.round(b.anchorAmount).toLocaleString()} | ${b.txType} | ${b.emitSite} |`);
  }

  const backlogOut = arg("backlog-out");
  if (backlogOut) {
    const lines = [
      "# Shadow ledger — Phase 3 coverage backlog (sim-seeded)",
      "",
      "Unattributed mint/sink emit sites from a 150-turn sandbox sim, ranked by",
      "cumulative anchor value. Refresh from the first prod observe-mode week.",
      "",
      "| ₳ (abs, cumulative) | txType | emitSite |",
      "| ---: | --- | --- |",
      ...rankedBacklog.map(
        (b) => `| ${Math.round(b.anchorAmount).toLocaleString()} | ${b.txType} | ${b.emitSite} |`
      ),
      "",
    ];
    writeFileSync(backlogOut, lines.join("\n"));
    console.log(`\nWrote backlog to ${backlogOut}`);
  }
}

type PhaseTelemetry = { startedAt?: string | Date | null; completedAt?: string | Date | null };

function phaseMs(p?: PhaseTelemetry): number {
  if (!p?.startedAt || !p?.completedAt) return 0;
  const ms = new Date(p.completedAt).getTime() - new Date(p.startedAt).getTime();
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

async function estimateOverhead(
  db: import("mongodb").Db
): Promise<{ pct: number; ledgerMs: number; totalMs: number } | null> {
  const logs = await db
    .collection<{ phaseStatuses?: Record<string, PhaseTelemetry>; durationMs?: number }>("turnLogs")
    .find({}, { projection: { phaseStatuses: 1, durationMs: 1 } })
    .sort({ turn: -1 })
    .limit(50)
    .toArray();
  let ledgerMs = 0;
  let totalMs = 0;
  let n = 0;
  for (const log of logs) {
    const ps = log.phaseStatuses;
    const t = log.durationMs ?? 0;
    if (!ps || t <= 0) continue;
    ledgerMs += phaseMs(ps.ledgerBalanceSnapshot) + phaseMs(ps.ledgerReconcile);
    totalMs += t;
    n += 1;
  }
  if (n === 0 || totalMs === 0) return null;
  return { pct: (ledgerMs / totalMs) * 100, ledgerMs: ledgerMs / n, totalMs: totalMs / n };
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
