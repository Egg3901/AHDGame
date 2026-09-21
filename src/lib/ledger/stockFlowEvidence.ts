/**
 * Deterministic #992 stock-flow evidence gate.
 *
 * Pure rules core: plain data in, plain data out. No DB, no clock, no random,
 * no env. The shell (scripts/ledger/collectStockFlowEvidence.ts) loads
 * per-turn ledgerReconciliations from one sandbox DB, attaches run provenance
 * and the banking activation turn, and calls {@link validateStockFlowWindow}.
 *
 * A window passes only when 12 consecutive turns are all genuine (the check
 * ran, not skipped), each machine-recorded as running under authoritative
 * banking, and show zero relevant divergence: trial balance green with no
 * unbalanced entries, stock-vs-flow green with zero divergent accounts,
 * money supply green, and an empty unattributed bucket. A skipped check
 * reports null/amber upstream (see reconcileLedger), and this gate rejects
 * it explicitly so a run of dead turns can never satisfy the 12-turn
 * criterion. Post-activation proof is per-turn: reconcileTurn stamps the
 * turn's `gameConfig.savingsAccountsMode` onto every persisted
 * ledgerReconciliation doc, so an accepted turn proves itself
 * post-activation. Docs that predate the stamp carry null (unknown, never
 * authoritative) and fail closed.
 *
 * Machine-recorded provenance means pinned-source identity, not just a git
 * string in the report. Since sim pinned-source support (#1969), a queued job
 * binds to a registered worktree + full commit SHA, the worker verifies HEAD
 * equality and a clean tree at claim AND immediately before spawn, runWorld
 * re-checks HEAD in the child and stamps
 * simRuns.source = {worktree, requestedCommit, executedPath, executedCommit},
 * and collectExperimentReport surfaces it as runConfig.source. The collector
 * reads that identity (never the short `runConfig.gitCommit` from the
 * collector operator's own checkout, which may be a different tree and is a
 * short SHA that can never equal a full expected revision). The gate requires
 * the executed commit to be a full SHA, requested == executed (the pin held),
 * codeRevision == executed (no mixed-report substitution), and a non-empty
 * executed path + worktree leaf. Legacy reports without runConfig.source fail
 * closed with the exact reason: rerun as a pinned job.
 *
 * One input stays operator-supplied by necessity and is documented as such:
 * expectedCodeRevision (the branch revision the evidence must come from).
 * Worker-side tree cleanliness is enforced fail-closed by the worker itself
 * (a dirty worktree fails the job, so no completed pinned run executed dirty);
 * the report's gitDirty flag covers the collector checkout and is still
 * required false.
 */

import type { ReconcileStatus } from "@/lib/ledger/types";

/** Minimum consecutive genuine turns the #992 exit criterion requires. */
export const STOCK_FLOW_WINDOW_TURNS = 12 as const;

/** Full commit SHA only: short SHAs can never satisfy the expected-revision pin. */
const FULL_SHA_RE = /^[0-9a-f]{40}$/;

/** How the executing code revision was established. */
export type ProvenanceSource = "simExperimentReport" | "operator";

/** One turn of reconciliation evidence, projected from a persisted doc. */
export interface StockFlowTurnEvidence {
  turn: number;
  /**
   * savingsAccountsMode the turn ran under, machine-stamped by
   * reconcileTurn. Null on docs that predate the stamp: unknown, and the
   * gate treats unknown as failing (never as authoritative).
   */
  bankingMode: string | null;
  trialBalanceStatus: ReconcileStatus;
  trialBalanceUnbalancedCount: number;
  stockVsFlowSkipped: boolean;
  /** null when skipped: unknown, not zero. */
  stockVsFlowDivergentCount: number | null;
  moneySupplyStatus: ReconcileStatus;
  unattributedCount: number;
  overallStatus: ReconcileStatus;
}

/** Run-level provenance the collector attaches to a window. */
export interface StockFlowProvenance {
  runId: string;
  /** Sandbox DB every turn was read from (single-DB assertion). */
  dbName: string;
  /** Executing code revision (full commit SHA). Must equal sourceExecutedCommit. */
  codeRevision: string;
  codeRevisionSource: ProvenanceSource;
  /** True when the executing checkout had uncommitted changes. */
  gitDirty: boolean | null;
  // Pinned-source identity from runConfig.source (#1966/#1969). Each field is
  // null on reports that predate pinned-source support (legacy: gate fails
  // closed). sourceWorktree is the registered worktree leaf the sim ran from.
  sourceWorktree: string | null;
  /** The commit SHA the queued job requested (full SHA). */
  sourceRequestedCommit: string | null;
  /** Canonical repo dir the worker spawned runWorld with as cwd. */
  sourceExecutedPath: string | null;
  /** The HEAD runWorld re-checked in the child (full SHA). */
  sourceExecutedCommit: string | null;
}

export interface StockFlowEvidenceInput {
  provenance: StockFlowProvenance;
  /** The exact code revision the evidence must come from (full SHA). */
  expectedCodeRevision: string;
  turns: StockFlowTurnEvidence[];
}

export interface StockFlowWindowFailure {
  turn: number | null;
  reason: string;
}

export interface StockFlowWindowResult {
  ok: boolean;
  /** Earliest qualifying consecutive window, when ok. */
  qualifyingWindow: { startTurn: number; endTurn: number } | null;
  failures: StockFlowWindowFailure[];
  summary: string;
}

function turnFailure(turn: number, reason: string): StockFlowWindowFailure {
  return { turn, reason };
}

/** Per-turn genuine + clean check. Returns failure reasons (empty = qualifies). */
function qualifyTurn(evidence: StockFlowTurnEvidence): string[] {
  const reasons: string[] = [];
  // Post-activation proof is machine-recorded on the turn doc itself: the
  // turn ran under authoritative banking. Shadow/off ran pre-activation (or
  // outside the rollout); null predates the stamp and is unknown, not
  // authoritative, so legacy docs fail closed here.
  if (evidence.bankingMode !== "authoritative") {
    reasons.push(
      `turn ${evidence.turn} ran under banking mode ${JSON.stringify(evidence.bankingMode)}, not authoritative (pre-activation or unstamped)`
    );
  }
  if (evidence.stockVsFlowSkipped || evidence.stockVsFlowDivergentCount === null) {
    reasons.push(
      `turn ${evidence.turn}: stock-vs-flow check was skipped (unverified, not passing)`
    );
  } else if (evidence.stockVsFlowDivergentCount !== 0) {
    reasons.push(`turn ${evidence.turn}: ${evidence.stockVsFlowDivergentCount} divergent accounts`);
  }
  if (evidence.trialBalanceStatus !== "green" || evidence.trialBalanceUnbalancedCount !== 0) {
    reasons.push(
      `turn ${evidence.turn}: trial balance not clean ` +
        `(status=${evidence.trialBalanceStatus}, unbalanced=${evidence.trialBalanceUnbalancedCount})`
    );
  }
  if (evidence.moneySupplyStatus !== "green") {
    reasons.push(`turn ${evidence.turn}: money supply status=${evidence.moneySupplyStatus}`);
  }
  if (evidence.unattributedCount !== 0) {
    reasons.push(
      `turn ${evidence.turn}: unattributed bucket has ${evidence.unattributedCount} rows`
    );
  }
  if (evidence.overallStatus !== "green") {
    reasons.push(`turn ${evidence.turn}: overall status=${evidence.overallStatus}`);
  }
  return reasons;
}

export function validateStockFlowWindow(input: StockFlowEvidenceInput): StockFlowWindowResult {
  const failures: StockFlowWindowFailure[] = [];
  const { provenance, expectedCodeRevision } = input;

  if (!provenance.runId) {
    failures.push({ turn: null, reason: "missing runId: evidence is not pinned to a run" });
  }
  if (!provenance.dbName) {
    failures.push({ turn: null, reason: "missing dbName: turns may come from mixed databases" });
  }
  if (!provenance.codeRevision) {
    failures.push({ turn: null, reason: "missing codeRevision: executing code is unverified" });
  } else if (provenance.codeRevision !== expectedCodeRevision) {
    failures.push({
      turn: null,
      reason:
        `executing code ${provenance.codeRevision} does not match ` +
        `expected branch revision ${expectedCodeRevision}`,
    });
  }
  if (provenance.codeRevisionSource !== "simExperimentReport") {
    failures.push({
      turn: null,
      reason:
        `code revision is ${provenance.codeRevisionSource}-asserted, ` +
        `not machine-recorded in simExperimentReports`,
    });
  } else if (
    !provenance.sourceExecutedCommit ||
    !FULL_SHA_RE.test(provenance.sourceExecutedCommit)
  ) {
    failures.push({
      turn: null,
      reason:
        "machine-recorded provenance without a pinned full-SHA executed commit " +
        `(runConfig.source.executedCommit=${JSON.stringify(provenance.sourceExecutedCommit)}): ` +
        "rerun as a pinned-source job; the legacy short gitCommit cannot pin a revision",
    });
  } else {
    if (provenance.sourceRequestedCommit !== provenance.sourceExecutedCommit) {
      failures.push({
        turn: null,
        reason:
          `pinned source moved: requested ${JSON.stringify(provenance.sourceRequestedCommit)} ` +
          `but executed ${provenance.sourceExecutedCommit}`,
      });
    }
    if (provenance.codeRevision !== provenance.sourceExecutedCommit) {
      failures.push({
        turn: null,
        reason:
          `code revision ${JSON.stringify(provenance.codeRevision)} does not match ` +
          `pinned executed commit ${provenance.sourceExecutedCommit} (mixed report refused)`,
      });
    }
    if (!provenance.sourceWorktree || !provenance.sourceExecutedPath) {
      failures.push({
        turn: null,
        reason:
          `pinned source path unproven (worktree=${JSON.stringify(provenance.sourceWorktree)}, ` +
          `executedPath=${JSON.stringify(provenance.sourceExecutedPath)})`,
      });
    }
  }
  if (provenance.gitDirty !== false) {
    failures.push({
      turn: null,
      reason: "executing checkout is dirty or its dirty flag is unknown",
    });
  }

  const turns = [...input.turns].sort((a, b) => a.turn - b.turn);
  if (turns.length < STOCK_FLOW_WINDOW_TURNS) {
    failures.push({
      turn: null,
      reason: `only ${turns.length} turns supplied, need ${STOCK_FLOW_WINDOW_TURNS} consecutive`,
    });
  }

  // Scan for the earliest run of consecutive qualifying turns.
  let qualifyingWindow: { startTurn: number; endTurn: number } | null = null;
  let runStart: number | null = null;
  let prevTurn: number | null = null;
  const disqualified = new Map<number, string[]>();

  for (const evidence of turns) {
    const turnReasons = qualifyTurn(evidence);
    if (turnReasons.length > 0) {
      disqualified.set(evidence.turn, turnReasons);
      runStart = null;
      prevTurn = null;
      continue;
    }
    if (runStart === null || prevTurn === null || evidence.turn !== prevTurn + 1) {
      runStart = evidence.turn;
    }
    prevTurn = evidence.turn;
    if (
      qualifyingWindow === null &&
      runStart !== null &&
      prevTurn - runStart + 1 >= STOCK_FLOW_WINDOW_TURNS
    ) {
      qualifyingWindow = { startTurn: runStart, endTurn: prevTurn };
    }
  }

  if (qualifyingWindow === null) {
    if (turns.length >= STOCK_FLOW_WINDOW_TURNS) {
      failures.push({
        turn: null,
        reason: `no ${STOCK_FLOW_WINDOW_TURNS} consecutive genuine post-activation clean turns found`,
      });
    }
    for (const [turn, reasons] of [...disqualified.entries()].sort((a, b) => a[0] - b[0])) {
      for (const reason of reasons) failures.push(turnFailure(turn, reason));
    }
    return {
      ok: false,
      qualifyingWindow: null,
      failures,
      summary: `FAIL: ${failures.length} blocking reason(s), no clean ${STOCK_FLOW_WINDOW_TURNS}-turn window`,
    };
  }

  if (failures.length > 0) {
    return {
      ok: false,
      qualifyingWindow: null,
      failures,
      summary: `FAIL: run-level provenance blocked despite a clean turn run ${qualifyingWindow.startTurn}..${qualifyingWindow.endTurn}`,
    };
  }
  return {
    ok: true,
    qualifyingWindow,
    failures: [],
    summary:
      `PASS: ${STOCK_FLOW_WINDOW_TURNS} consecutive genuine post-activation turns ` +
      `${qualifyingWindow.startTurn}..${qualifyingWindow.endTurn} with zero relevant divergence`,
  };
}
