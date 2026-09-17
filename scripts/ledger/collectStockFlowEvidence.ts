/**
 * #992 stock-flow evidence collector (read-only).
 *
 * Reads per-turn ledgerReconciliations from ONE sandbox sim DB, attaches run
 * provenance (simRuns + gameConfig banking mode + machine-recorded git
 * revision from control-plane simExperimentReports when reachable), and runs
 * the deterministic gate in src/lib/ledger/stockFlowEvidence.ts.
 *
 * This script never writes to any database and never runs a turn. It cannot
 * manufacture evidence for a branch revision: when the executing code
 * revision is not machine-recorded, provenance degrades to operator-asserted
 * and the gate fails closed with the exact reason.
 *
 * Usage:
 *   SIM_MONGODB_URI=mongodb://127.0.0.1:27018 \
 *     npx tsx scripts/ledger/collectStockFlowEvidence.ts \
 *       --db=ahd_sim_992 --run-id=<runId> \
 *       --expected-revision=<full-sha> --banking-activation-turn=<turn> \
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
const activationTurnRaw = arg("banking-activation-turn");
const lookbackRaw = arg("lookback") ?? "30";
const outPath = arg("out");

if (!SIM_MONGODB_URI || !dbName || !runId || !expectedRevision || !activationTurnRaw) {
  console.error(
    "Usage: SIM_MONGODB_URI=... npx tsx scripts/ledger/collectStockFlowEvidence.ts " +
      "--db=<sandboxDb> --run-id=<runId> --expected-revision=<full-sha> " +
      "--banking-activation-turn=<turn> [--lookback=30] [--out=path]"
  );
  process.exit(2);
}
const bankingActivationTurn = Number(activationTurnRaw);
const lookback = Number(lookbackRaw);
if (!Number.isInteger(bankingActivationTurn) || bankingActivationTurn < 0) {
  console.error("--banking-activation-turn must be a non-negative integer");
  process.exit(2);
}
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
  const gameConfig = await db
    .collection<{ _id: string; savingsAccountsMode?: string }>("gameConfig")
    .findOne({ _id: "default" });

  // Machine-recorded executing revision lives in the control-plane experiment
  // report (written by collectExperimentReport.ts from the worker checkout).
  // Read-only here; absent means operator-asserted provenance (gate fails closed).
  let codeRevision = "";
  let codeRevisionSource: "simExperimentReport" | "operator" = "operator";
  let gitDirty: boolean | null = null;
  if (OPS_MONGODB_URI) {
    try {
      const { MongoClient } = await import("mongodb");
      const opsClient = new MongoClient(OPS_MONGODB_URI);
      try {
        await opsClient.connect();
        const report = await opsClient
          .db(OPS_DB_NAME)
          .collection<{ runConfig?: { gitCommit?: string; gitDirty?: boolean } }>(
            "simExperimentReports"
          )
          .findOne({ _id: runId as never });
        if (typeof report?.runConfig?.gitCommit === "string" && report.runConfig.gitCommit) {
          codeRevision = report.runConfig.gitCommit;
          codeRevisionSource = "simExperimentReport";
          gitDirty = report.runConfig.gitDirty ?? null;
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
    console.error("OPS_MONGODB_URI unset: code revision is operator-asserted, gate will fail closed.");
  }

  // Cross-check against the independent vital-signs surface for the same turns.
  const vitalTurns = new Map<
    number,
    { divergent: number | null; skipped: boolean | null }
  >();
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
      bankingMode: gameConfig?.savingsAccountsMode ?? null,
      bankingActivationTurn,
    },
    expectedCodeRevision: expectedRevision,
    turns: ordered.map((doc) => ({
      turn: doc.turn,
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
      windowTurns: ordered.length > 0 ? { from: ordered[0].turn, to: ordered[ordered.length - 1].turn } : null,
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
