/**
 * #992 stock-flow evidence collector (read-only).
 *
 * Reads per-turn ledgerReconciliations from ONE sandbox sim DB, attaches run
 * provenance (simRuns + machine-recorded pinned-source identity from
 * control-plane simExperimentReports when reachable), and runs the
 * deterministic gate in src/lib/ledger/stockFlowEvidence.ts.
 *
 * Post-activation proof is per-turn and machine-recorded: reconcileTurn
 * stamps each turn's gameConfig.savingsAccountsMode onto its persisted
 * ledgerReconciliation doc, and the gate requires every accepted turn to
 * carry authoritative there. No operator activation number exists: legacy
 * docs that predate the stamp fail closed as unstamped.
 *
 * The code revision comes from runConfig.source.executedCommit (the full SHA
 * runWorld re-checked in the child on the pinned worktree), never from the
 * legacy short runConfig.gitCommit, which is recorded on the collector
 * operator's own checkout and may be a different tree. Reports without
 * runConfig.source (pre-pinned jobs) degrade to operator-asserted provenance
 * and the gate fails closed with the exact reason.
 *
 * This script never writes to any database and never runs a turn. It cannot
 * manufacture evidence for a branch revision: when the executing code
 * revision is not machine-recorded, provenance degrades to operator-asserted
 * and the gate fails closed with the exact reason.
 *
 * Usage:
 *   SIM_MONGODB_URI=mongodb://127.0.0.1:27018 \
 *     OPS_MONGODB_URI=mongodb://... \
 *     npx tsx scripts/ledger/collectStockFlowEvidence.ts \
 *       --db=ahd_sim_992 --run-id=<runId> \
 *       --expected-revision=<full-sha> \
 *       [--lookback=30] [--out=/tmp/evidence.json]
 *
 * Exit 0 on PASS, 1 on FAIL, 2 on collection error.
 */

export {};

function arg(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  const found = process.argv.find((v) => v.startsWith(prefix));
  return found?.slice(prefix.length);
}

const SIM_MONGODB_URI = process.env.SIM_MONGODB_URI ?? process.env.MONGODB_URI;
const OPS_MONGODB_URI = process.env.OPS_MONGODB_URI;
const OPS_DB_NAME = process.env.OPS_DB_NAME || "a-house-divided";

const dbName = arg("db");
const runId = arg("run-id");
const expectedRevision = arg("expected-revision");
const lookbackRaw = arg("lookback") ?? "30";
const outPath = arg("out");

if (!SIM_MONGODB_URI || !dbName || !runId || !expectedRevision) {
  console.error(
    "Usage: SIM_MONGODB_URI=... npx tsx scripts/ledger/collectStockFlowEvidence.ts " +
      "--db=<sandboxDb> --run-id=<runId> --expected-revision=<full-sha> " +
      "[--lookback=30] [--out=path]"
  );
  process.exit(2);
}
const lookback = Number(lookbackRaw);
if (!Number.isInteger(lookback) || lookback < 12 || lookback > 500) {
  console.error("--lookback must be an integer 12..500");
  process.exit(2);
}

(process.env as { NODE_ENV: string }).NODE_ENV = "test";
process.env.MONGODB_URI = SIM_MONGODB_URI;
process.env.MONGODB_DB = dbName as string;

async function main() {
  const { writeFileSync } = await import("node:fs");
  const { getDb } = await import("@/lib/mongodb");
  const { LEDGER_RECONCILIATIONS_COLLECTION } = await import("@/lib/ledger/reconcile");
  const { ECONOMIC_VITAL_SIGNS_COLLECTION } = await import("@/lib/economy/economicVitalSigns");
  const { validateStockFlowWindow } = await import("@/lib/ledger/stockFlowEvidence");
  type Recon = import("@/lib/ledger/types").LedgerReconciliation;

  const db = await getDb();
  const recons = db.collection<Recon>(LEDGER_RECONCILIATIONS_COLLECTION);
  const total = await recons.countDocuments();
  if (total === 0) {
    console.error("No ledgerReconciliations found: was the run executed with ledgerShadow on?");
    process.exit(2);
  }
  const docs = await recons.find({}).sort({ turn: -1 }).limit(lookback).toArray();
  const ordered = [...docs].sort((a, b) => a.turn - b.turn);

  const simRun = await db.collection("simRuns").findOne({ _id: runId as never });
  if (!simRun) {
    console.error(`No simRuns doc for runId ${runId} in ${dbName}: cannot pin evidence to a run.`);
    process.exit(2);
  }
  // Machine-recorded pinned-source identity lives in the control-plane
  // experiment report (runConfig.source, written by collectExperimentReport.ts
  // from the simRuns.source stamp the worker/runWorld recorded on the pinned
  // worktree). Read-only here; absent means operator-asserted provenance
  // (gate fails closed). The legacy short runConfig.gitCommit is deliberately
  // NOT used as a revision: it is recorded on this collector's own checkout,
  // which may be a different tree, and a short SHA can never equal a full
  // expected revision.
  let codeRevision = "";
  let codeRevisionSource: "simExperimentReport" | "operator" = "operator";
  let gitDirty: boolean | null = null;
  let sourceWorktree: string | null = null;
  let sourceRequestedCommit: string | null = null;
  let sourceExecutedPath: string | null = null;
  let sourceExecutedCommit: string | null = null;
  if (OPS_MONGODB_URI) {
    try {
      const { MongoClient } = await import("mongodb");
      const opsClient = new MongoClient(OPS_MONGODB_URI);
      try {
        await opsClient.connect();
        const report = await opsClient
          .db(OPS_DB_NAME)
          .collection<{
            runConfig?: {
              gitCommit?: string;
              gitDirty?: boolean;
              source?: {
                worktree?: string | null;
                requestedCommit?: string | null;
                executedPath?: string | null;
                executedCommit?: string | null;
              } | null;
            };
          }>("simExperimentReports")
          .findOne({ _id: runId as never });
        gitDirty = report?.runConfig?.gitDirty ?? null;
        const source = report?.runConfig?.source ?? null;
        sourceWorktree = source?.worktree ?? null;
        sourceRequestedCommit = source?.requestedCommit ?? null;
        sourceExecutedPath = source?.executedPath ?? null;
        sourceExecutedCommit = source?.executedCommit ?? null;
        if (
          typeof sourceExecutedCommit === "string" &&
          /^[0-9a-f]{40}$/.test(sourceExecutedCommit)
        ) {
          codeRevision = sourceExecutedCommit;
          codeRevisionSource = "simExperimentReport";
        } else if (source !== null) {
          console.error(
            "Experiment report has a pinned-source block without a full-SHA executed commit: " +
              "provenance stays operator-asserted, gate will fail closed."
          );
        } else {
          console.error(
            "Experiment report has no pinned-source identity (pre-pinned job or legacy report): " +
              "provenance stays operator-asserted, gate will fail closed."
          );
        }
      } finally {
        await opsClient.close();
      }
    } catch (err) {
      console.error(
        `Control-plane experiment report unreadable (non-fatal, provenance degrades): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  } else {
    console.error(
      "OPS_MONGODB_URI unset: code revision is operator-asserted, gate will fail closed."
    );
  }

  // Cross-check against the independent vital-signs surface for the same turns.
  const vitalTurns = new Map<number, { divergent: number | null; skipped: boolean | null }>();
  try {
    const vitals = await db
      .collection<{
        turn: number;
        reconciliation?: {
          stockVsFlowDivergentCount?: number | null;
          stockVsFlowSkipped?: boolean | null;
        };
      }>(ECONOMIC_VITAL_SIGNS_COLLECTION)
      .find(
        { turn: { $in: ordered.map((d) => d.turn) } },
        { projection: { turn: 1, reconciliation: 1 } }
      )
      .toArray();
    for (const v of vitals) {
      vitalTurns.set(v.turn, {
        divergent: v.reconciliation?.stockVsFlowDivergentCount ?? null,
        skipped: v.reconciliation?.stockVsFlowSkipped ?? null,
      });
    }
  } catch {
    // Best-effort: the reconciler docs remain authoritative.
  }
  const mismatches: string[] = [];
  for (const doc of ordered) {
    const vital = vitalTurns.get(doc.turn);
    if (!vital) continue;
    if (
      vital.skipped !== null &&
      (vital.skipped !== doc.stockVsFlow.skipped ||
        (!doc.stockVsFlow.skipped && vital.divergent !== doc.stockVsFlow.divergentCount))
    ) {
      mismatches.push(
        `turn ${doc.turn}: vital-signs divergent=${String(vital.divergent)} skipped=${String(vital.skipped)} ` +
          `vs reconciler divergent=${String(doc.stockVsFlow.divergentCount)} skipped=${String(doc.stockVsFlow.skipped)}`
      );
    }
  }
  if (mismatches.length > 0) {
    console.error("Vital-signs cross-check mismatches (evidence surfaces disagree):");
    for (const m of mismatches) console.error(`  ${m}`);
    process.exit(2);
  }

  const evidence = {
    provenance: {
      runId,
      dbName,
      codeRevision,
      codeRevisionSource,
      gitDirty,
      sourceWorktree,
      sourceRequestedCommit,
      sourceExecutedPath,
      sourceExecutedCommit,
    },
    expectedCodeRevision: expectedRevision,
    turns: ordered.map((doc) => ({
      turn: doc.turn,
      // Per-turn post-activation proof, machine-stamped by reconcileTurn.
      // Docs that predate the stamp carry undefined -> null -> gate rejects.
      bankingMode: (doc as { bankingMode?: string | null }).bankingMode ?? null,
      trialBalanceStatus: doc.trialBalance.status,
      trialBalanceUnbalancedCount: doc.trialBalance.unbalancedCount,
      stockVsFlowSkipped: doc.stockVsFlow.skipped,
      stockVsFlowDivergentCount: doc.stockVsFlow.divergentCount,
      moneySupplyStatus: doc.moneySupply.status,
      unattributedCount: doc.unattributed.length,
      overallStatus: doc.status,
    })),
  };

  const result = validateStockFlowWindow(evidence);
  const output = JSON.stringify(
    {
      collectedAt: new Date().toISOString(),
      windowTurns:
        ordered.length > 0 ? { from: ordered[0].turn, to: ordered[ordered.length - 1].turn } : null,
      simSeed: (simRun as { seed?: string }).seed ?? null,
      simPreset: (simRun as { preset?: string }).preset ?? null,
      evidence,
      result,
    },
    null,
    2
  );
  if (outPath) writeFileSync(outPath as string, output);
  else console.log(output);
  console.error(result.summary);
  for (const failure of result.failures) {
    console.error(`  [turn ${failure.turn === null ? "-" : failure.turn}] ${failure.reason}`);
  }
  process.exit(result.ok ? 0 : 1);
}

main().catch((error) => {
  console.error("FAILED:", error instanceof Error ? error.message : String(error));
  process.exit(2);
});
