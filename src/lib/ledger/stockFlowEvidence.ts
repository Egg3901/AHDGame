/**
 * Deterministic #992 stock-flow evidence gate.
 *
 * Pure rules core: plain data in, plain data out. No DB, no clock, no random,
 * no env. The shell (scripts/ledger/collectStockFlowEvidence.ts) loads
 * per-turn ledgerReconciliations from one sandbox DB, attaches run provenance
 * and the banking activation turn, and calls {@link validateStockFlowWindow}.
 *
 * A window passes only when 12 consecutive turns are all genuine (the check
 * ran, not skipped), post banking activation, and show zero relevant
 * divergence: trial balance green with no unbalanced entries, stock-vs-flow
 * green with zero divergent accounts, money supply green, and an empty
 * unattributed bucket. A skipped check reports null/amber upstream (see
 * reconcileLedger), and this gate rejects it explicitly so a run of dead
 * turns can never satisfy the 12-turn criterion.
 */

import type { ReconcileStatus } from "@/lib/ledger/types";

/** Minimum consecutive genuine turns the #992 exit criterion requires. */
export const STOCK_FLOW_WINDOW_TURNS = 12 as const;

/** How the executing code revision was established. */
export type ProvenanceSource = "simExperimentReport" | "operator";

/** One turn of reconciliation evidence, projected from a persisted doc. */
export interface StockFlowTurnEvidence {
  turn: number;
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
  /** Executing code revision (full commit SHA). */
  codeRevision: string;
  codeRevisionSource: ProvenanceSource;
  /** True when the executing checkout had uncommitted changes. */
  gitDirty: boolean | null;
  /** savingsAccountsMode observed on the run at collection time. */
  bankingMode: string | null;
  /** First turn AFTER banking activation cohorts completed. */
  bankingActivationTurn: number;
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
function qualifyTurn(
  evidence: StockFlowTurnEvidence,
  provenance: StockFlowProvenance
): string[] {
  const reasons: string[] = [];
  if (evidence.turn > provenance.bankingActivationTurn) {
    // post-activation; the mode gate below still applies
  } else {
    reasons.push(
      `turn ${evidence.turn} is not post banking activation (activation turn ${provenance.bankingActivationTurn})`
    );
  }
  if (evidence.stockVsFlowSkipped || evidence.stockVsFlowDivergentCount === null) {
    reasons.push(
      `turn ${evidence.turn}: stock-vs-flow check was skipped (unverified, not passing)`
    );
  } else if (evidence.stockVsFlowDivergentCount !== 0) {
    reasons.push(
      `turn ${evidence.turn}: ${evidence.stockVsFlowDivergentCount} divergent accounts`
    );
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
    reasons.push(`turn ${evidence.turn}: unattributed bucket has ${evidence.unattributedCount} rows`);
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
  }
  if (provenance.gitDirty !== false) {
    failures.push({
      turn: null,
      reason: "executing checkout is dirty or its dirty flag is unknown",
    });
  }
  if (provenance.bankingMode !== "authoritative") {
    failures.push({
      turn: null,
      reason: `banking mode is ${JSON.stringify(provenance.bankingMode)}, not authoritative`,
    });
  }
  if (!Number.isInteger(provenance.bankingActivationTurn) || provenance.bankingActivationTurn < 0) {
    failures.push({ turn: null, reason: "bankingActivationTurn must be a non-negative integer" });
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
    const turnReasons = qualifyTurn(evidence, provenance);
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
    if (qualifyingWindow === null && runStart !== null && prevTurn - runStart + 1 >= STOCK_FLOW_WINDOW_TURNS) {
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
