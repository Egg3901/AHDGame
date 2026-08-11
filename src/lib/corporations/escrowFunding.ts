/**
 * How much to move from liquidCapital into escrow this turn. Never exceeds the
 * configured rate or what the treasury can afford; never negative.
 */
export function computeEscrowFundingTransfer(input: {
  fundingPerTurn?: number;
  liquidCapital?: number;
}): number {
  const rate = input.fundingPerTurn ?? 0;
  const liquid = input.liquidCapital ?? 0;
  if (!Number.isFinite(rate) || !Number.isFinite(liquid)) return 0;
  if (rate <= 0 || liquid <= 0) return 0;
  return Math.min(rate, liquid);
}

/**
 * Non-blocking UI guard: should the CEO Budget panel warn that escrow
 * auto-funding will perpetually drain the treasury? True only when a positive
 * funding rate exceeds a known-positive recent net income (funding > income
 * means the per-turn sweep takes the entire treasury every turn). Returns
 * false on unknown/zero/negative income to avoid false alarms on new corps.
 */
export function shouldWarnEscrowFunding(input: {
  fundingPerTurn: number;
  recentNetIncome: number;
}): boolean {
  const { fundingPerTurn, recentNetIncome } = input;
  if (!Number.isFinite(fundingPerTurn) || !Number.isFinite(recentNetIncome)) return false;
  if (fundingPerTurn <= 0 || recentNetIncome <= 0) return false;
  return fundingPerTurn > recentNetIncome;
}

/**
 * Bonds-only exception to escrow ring-fencing: when a corp's liquidCapital is
 * negative after bond obligations (coupons + maturities) hit it, it may pull the
 * shortfall from a POSITIVE escrow before defaulting. Returns the amount of escrow
 * to move into liquidCapital — `min(shortfall, positive escrow)`. Never uses a
 * negative escrow and never pushes escrow below zero (caller debits escrow by the
 * returned amount and credits liquidCapital by the same).
 */
export function computeBondShortfallEscrowCover(input: {
  liquidCapital: number;
  escrowBalance: number;
}): number {
  const { liquidCapital, escrowBalance } = input;
  if (!Number.isFinite(liquidCapital) || !Number.isFinite(escrowBalance)) return 0;
  if (liquidCapital >= 0 || escrowBalance <= 0) return 0;
  return Math.min(-liquidCapital, escrowBalance);
}

/**
 * Split a bond payment across liquidCapital then a POSITIVE escrow fallback (the
 * defaulted-bond cash-settlement path). liquidCapital is drawn first (floored at
 * 0 — a negative treasury contributes nothing); the remainder comes from positive
 * escrow. `covered` is true only when the two together meet `amountDue`.
 */
export function splitBondPaymentWithEscrow(input: {
  liquidCapital: number;
  escrowBalance: number;
  amountDue: number;
}): { fromLiquid: number; fromEscrow: number; covered: boolean } {
  const due = input.amountDue;
  if (!Number.isFinite(due) || due <= 0) return { fromLiquid: 0, fromEscrow: 0, covered: true };
  const liquid = Math.max(0, input.liquidCapital);
  const fromLiquid = Math.min(liquid, due);
  const remainingAfterLiquid = due - fromLiquid;
  const escrow = Math.max(0, input.escrowBalance);
  const fromEscrow = Math.min(escrow, remainingAfterLiquid);
  return {
    fromLiquid,
    fromEscrow,
    covered: remainingAfterLiquid - fromEscrow <= 1e-9,
  };
}

/** A CEO may sweep a positive escrow balance back to the treasury once per this many turns. */
export const ESCROW_WITHDRAW_COOLDOWN_TURNS = 24;

/**
 * Validate a CEO escrow→treasury withdrawal request. Pure: the route maps the
 * result to an HTTP response and performs the atomic move. The amount is in the
 * corp's local (liquidCurrencyCode) units, same as the escrow balance.
 *
 * Rules: escrow must be positive, the amount cannot exceed it (escrow can't be
 * driven negative by a withdrawal), and withdrawals are gated to once per
 * ESCROW_WITHDRAW_COOLDOWN_TURNS.
 */
export function evaluateEscrowWithdrawal(input: {
  escrowBalance: number;
  amount: number;
  currentTurn: number;
  lastWithdrawalTurn?: number;
}): { ok: true } | { ok: false; status: number; error: string } {
  const { escrowBalance, amount, currentTurn, lastWithdrawalTurn } = input;
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, status: 400, error: "Withdrawal amount must be positive" };
  }
  if (escrowBalance <= 0) {
    return { ok: false, status: 400, error: "No positive escrow balance to withdraw" };
  }
  if (amount > escrowBalance) {
    return {
      ok: false,
      status: 400,
      error: `Can withdraw at most ${escrowBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })} (cannot make escrow negative)`,
    };
  }
  if (
    lastWithdrawalTurn != null &&
    currentTurn - lastWithdrawalTurn < ESCROW_WITHDRAW_COOLDOWN_TURNS
  ) {
    const remaining = ESCROW_WITHDRAW_COOLDOWN_TURNS - (currentTurn - lastWithdrawalTurn);
    return {
      ok: false,
      status: 400,
      error: `Escrow withdrawal is available again in ${remaining} turns`,
    };
  }
  return { ok: true };
}
