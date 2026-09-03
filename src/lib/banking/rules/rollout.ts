/**
 * The staged activation of savings accounts, as rules.
 *
 * The rollout has three settings: the mode (off, shadow, authoritative) and
 * the read cohort (the currencies whose accounts the balance sheet counts),
 * plus the private-banking kill switch above them. Widening any of them is
 * decided here against evidence the health surface gathers; narrowing is
 * always allowed, because rolling back must never be the thing that is
 * refused. The rollback conditions are listed here too, so the surface that
 * shows them and the pass that raises them read the same list.
 */

import type { BankingPolicySnapshot, SavingsAccountsMode } from "@/lib/banking/rules/policy";

export type RolloutChange =
  | { kind: "mode"; mode: SavingsAccountsMode }
  | { kind: "add_read_currency"; currency: string }
  | { kind: "remove_read_currency"; currency: string };

/** What the decision is made against. Every field is something the health report shows. */
export interface RolloutEvidence {
  /** The activation gate: nothing unfinished from earlier turns, no stuck estate, no drift. */
  gateOk: boolean;
  gateReasons: string[];
  /** The last shadow comparison, per currency. Null when the mode is off. */
  comparison: {
    turn: number;
    currencies: Array<{
      currency: string;
      legacyOwnerTotal: number;
      accountOwnerTotal: number;
      rowDiscrepancies: number;
      discrepancies: number;
    }>;
  } | null;
  /** The in-flight turn, to judge how fresh the comparison is. */
  currentTurn: number;
}

export interface RolloutState {
  mode: SavingsAccountsMode;
  readCurrencies: string[];
}

export interface RolloutDecision {
  allowed: boolean;
  /** The settings after the change, when allowed. */
  next: RolloutState;
  /** Why not, in the operator's terms. Empty when allowed. */
  reasons: string[];
  /** Whether the change widens exposure (needs evidence) or narrows it (a rollback). */
  direction: "widen" | "narrow" | "none";
}

const MODE_RANK: Record<SavingsAccountsMode, number> = { off: 0, shadow: 1, authoritative: 2 };

/** A comparison older than this many turns is not evidence of anything. */
export const COMPARISON_MAX_AGE_TURNS = 1;

export function rolloutStateOf(policy: BankingPolicySnapshot): RolloutState {
  return { mode: policy.savingsAccounts, readCurrencies: [...policy.savingsReadCurrencies] };
}

/**
 * Decide a rollout change.
 *
 * - Narrowing (a lower mode, a currency out of the cohort) is always allowed.
 * - Shadow needs nothing: it writes nothing anyone reads.
 * - Authoritative needs the gate open and a fresh, clean comparison across
 *   every currency, and is reached from shadow only: the comparison that
 *   justifies it does not exist in off.
 * - A currency joins the read cohort only in authoritative mode, with the gate
 *   open and its own fresh comparison clean, with the accounts holding the
 *   same total as the legacy fields (that is what "migrated" means here).
 */
export function decideRolloutChange(
  state: RolloutState,
  change: RolloutChange,
  evidence: RolloutEvidence
): RolloutDecision {
  const reasons: string[] = [];
  const next: RolloutState = { mode: state.mode, readCurrencies: [...state.readCurrencies] };

  if (change.kind === "mode") {
    if (change.mode === state.mode) {
      return { allowed: true, next, reasons, direction: "none" };
    }
    next.mode = change.mode;
    if (MODE_RANK[change.mode] < MODE_RANK[state.mode]) {
      // A rollback clears the cohort with it: no reads may be authoritative
      // outside authoritative mode.
      if (change.mode !== "authoritative") next.readCurrencies = [];
      return { allowed: true, next, reasons, direction: "narrow" };
    }
    if (change.mode === "shadow") {
      return { allowed: true, next, reasons, direction: "widen" };
    }
    // authoritative
    if (state.mode !== "shadow") {
      reasons.push("Authoritative is reached from shadow, after the comparison has run.");
    }
    if (!evidence.gateOk) reasons.push(...gateReasons(evidence));
    const comparison = freshComparison(evidence);
    if (!comparison) {
      reasons.push("No comparison from the current or previous turn to judge by.");
    } else {
      const dirty = comparison.currencies.filter((c) => c.discrepancies > 0);
      if (dirty.length > 0) {
        reasons.push(
          `The last comparison shows discrepancies in ${dirty.map((c) => c.currency).join(", ")}.`
        );
      }
    }
    return { allowed: reasons.length === 0, next, reasons, direction: "widen" };
  }

  if (change.kind === "remove_read_currency") {
    next.readCurrencies = next.readCurrencies.filter((c) => c !== change.currency);
    return {
      allowed: true,
      next,
      reasons,
      direction: next.readCurrencies.length === state.readCurrencies.length ? "none" : "narrow",
    };
  }

  // add_read_currency
  if (state.readCurrencies.includes(change.currency)) {
    return { allowed: true, next, reasons, direction: "none" };
  }
  next.readCurrencies = [...next.readCurrencies, change.currency].sort();
  if (state.mode !== "authoritative") {
    reasons.push("The read cohort applies in authoritative mode only.");
  }
  if (!evidence.gateOk) reasons.push(...gateReasons(evidence));
  const comparison = freshComparison(evidence);
  const row = comparison?.currencies.find((c) => c.currency === change.currency);
  if (!comparison) {
    reasons.push("No comparison from the current or previous turn to judge by.");
  } else if (!row) {
    reasons.push(`The last comparison has no ${change.currency} rows: nothing to switch.`);
  } else {
    if (row.discrepancies > 0) {
      reasons.push(
        `${change.currency} shows ${row.discrepancies} discrepancy(ies) in the last comparison.`
      );
    }
    if (Math.abs(row.legacyOwnerTotal - row.accountOwnerTotal) > 0.005) {
      reasons.push(
        `${change.currency} accounts hold ${row.accountOwnerTotal.toFixed(2)} against ${row.legacyOwnerTotal.toFixed(2)} in the legacy fields: run the migration first.`
      );
    }
  }
  return { allowed: reasons.length === 0, next, reasons, direction: "widen" };
}

function gateReasons(evidence: RolloutEvidence): string[] {
  return evidence.gateReasons.length > 0
    ? evidence.gateReasons.map((r) => `Gate closed: ${r}`)
    : ["Gate closed."];
}

function freshComparison(evidence: RolloutEvidence): RolloutEvidence["comparison"] {
  const comparison = evidence.comparison;
  if (!comparison) return null;
  if (evidence.currentTurn - comparison.turn > COMPARISON_MAX_AGE_TURNS) return null;
  return comparison;
}

/**
 * The conditions under which the rollout should be rolled back, from the same
 * evidence. Listed, not acted on: the pass that sees them closes the gate and
 * raises them on the health surface, and an operator narrows the rollout,
 * because flipping the reading of a balance sheet mid-turn is worse than one
 * more turn of a known drift.
 */
export interface RollbackCondition {
  code: "cohort_drift" | "stuck_estate" | "stale_unfinished" | "comparison_missing";
  detail: string;
  /** The narrowest change that clears the condition. */
  suggested: RolloutChange;
}

export function rollbackConditions(
  state: RolloutState,
  evidence: RolloutEvidence
): RollbackCondition[] {
  const out: RollbackCondition[] = [];
  if (state.mode === "off") return out;
  const comparison = freshComparison(evidence);
  if (state.mode === "authoritative" && !comparison) {
    out.push({
      code: "comparison_missing",
      detail: "Accounts are authoritative and no comparison has run this turn or last.",
      suggested: { kind: "mode", mode: "shadow" },
    });
  }
  for (const currency of state.readCurrencies) {
    const row = comparison?.currencies.find((c) => c.currency === currency);
    if (row && row.discrepancies > 0) {
      out.push({
        code: "cohort_drift",
        detail: `${currency} is in the read cohort and its last comparison shows ${row.discrepancies} discrepancy(ies).`,
        suggested: { kind: "remove_read_currency", currency },
      });
    }
  }
  for (const reason of evidence.gateReasons) {
    if (/resolution/.test(reason)) {
      out.push({
        code: "stuck_estate",
        detail: reason,
        suggested:
          state.readCurrencies.length > 0
            ? { kind: "remove_read_currency", currency: state.readCurrencies[0] }
            : { kind: "mode", mode: "shadow" },
      });
    } else if (/unfinished/.test(reason)) {
      out.push({
        code: "stale_unfinished",
        detail: reason,
        suggested: { kind: "mode", mode: state.mode === "authoritative" ? "shadow" : "off" },
      });
    }
  }
  return out;
}
