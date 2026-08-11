import { TURNS_PER_DAY } from "@/lib/constants/turnTime";
import { LOC_DEPOSIT_FRACTION } from "@/lib/lineOfCredit/locMath";

/**
 * Once-per-real-day (24 turns) cooldown for chair transfers between
 * forex spread revenue and lending reserves.
 */
export const RESERVE_POOL_TRANSFER_COOLDOWN_TURNS = TURNS_PER_DAY;

/** Max fraction of the source pool that may move in a single transfer. */
export const RESERVE_POOL_TRANSFER_MAX_FRACTION = 0.5;

export type ReservePoolTransferDirection = "toLending" | "toForex";

export interface ReservePoolTransferLimits {
  /** Max home-currency face that may move forex → lending this action. */
  maxToLending: number;
  /**
   * Max home-currency face that may move lending → forex this action,
   * already capped so the 70% LOC pool stays ≥ outstanding loans.
   */
  maxToForex: number;
  /** Lending reserves that must remain so systemCap ≥ outstanding loans. */
  minLendingReservesToCoverLoans: number;
}

/**
 * Compute transfer caps for a chair reallocation between forexRevenue and
 * reserveBalance. Amounts are home-currency face values (floored).
 */
export function computeReservePoolTransferLimits(params: {
  forexRevenue: number;
  lendingReserves: number;
  totalDeposits: number;
  totalLoansOutstanding: number;
}): ReservePoolTransferLimits {
  const forexRevenue = Math.max(0, finiteOrZero(params.forexRevenue));
  const lendingReserves = Math.max(0, finiteOrZero(params.lendingReserves));
  const totalDeposits = Math.max(0, finiteOrZero(params.totalDeposits));
  const totalLoansOutstanding = Math.max(0, finiteOrZero(params.totalLoansOutstanding));

  const maxToLending = Math.floor(forexRevenue * RESERVE_POOL_TRANSFER_MAX_FRACTION);

  // systemCap = (deposits + reserves) * 0.7 ≥ outstanding
  // → reserves ≥ outstanding / 0.7 − deposits
  // Use a tiny epsilon before ceil so exact multiples (e.g. 700 / 0.7) don't
  // round up from floating-point noise.
  const minLendingReservesToCoverLoans = Math.max(
    0,
    Math.ceil(totalLoansOutstanding / LOC_DEPOSIT_FRACTION - totalDeposits - 1e-9)
  );
  const movableFromLending = Math.max(0, lendingReserves - minLendingReservesToCoverLoans);
  const maxToForex = Math.floor(
    Math.min(lendingReserves * RESERVE_POOL_TRANSFER_MAX_FRACTION, movableFromLending)
  );

  return {
    maxToLending,
    maxToForex,
    minLendingReservesToCoverLoans,
  };
}

export function resolveReservePoolTransferAmount(params: {
  direction: ReservePoolTransferDirection;
  amount: number;
  forexRevenue: number;
  lendingReserves: number;
  totalDeposits: number;
  totalLoansOutstanding: number;
}): { amount: number; limits: ReservePoolTransferLimits } {
  const limits = computeReservePoolTransferLimits(params);
  const requested = Math.floor(params.amount);
  if (!Number.isFinite(requested) || requested <= 0) {
    return { amount: 0, limits };
  }
  const cap = params.direction === "toLending" ? limits.maxToLending : limits.maxToForex;
  return { amount: Math.min(requested, cap), limits };
}

export function turnsUntilReservePoolTransferReady(params: {
  currentTurn: number;
  lastTransferTurn: number | null | undefined;
  isAdmin?: boolean;
}): number {
  if (params.isAdmin) return 0;
  if (params.lastTransferTurn == null || !Number.isFinite(params.lastTransferTurn)) return 0;
  const readyAt = params.lastTransferTurn + RESERVE_POOL_TRANSFER_COOLDOWN_TURNS;
  return Math.max(0, readyAt - params.currentTurn);
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
