/**
 * Independence and reunification desire changes with the First Minister's
 * stance, regional and Westminster approval, inflation and baseline recovery.
 * computeIndependenceDesireDriftSnapshot returns the next value and its drivers.
 */
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { REQUEST_THRESHOLD } from "@/lib/constants/referendum";
import type { DevolutionPolicy } from "@/lib/db/types/governorOfficeState";

/**
 * Drift contribution per turn from the FM's Devolution Policy choice.
 * Policy alone adds 2.4 points per game year before baseline recovery.
 * A popular separatist government at 70 approval adds about 4.2 points
 * annually with a neutral pro-devolution Westminster stance and normal inflation.
 */
export const DEVOLUTION_POLICY_DRIFT: Record<DevolutionPolicy, number> = {
  anti: -0.04,
  pro: 0,
  independence: 0.05,
};

/**
 * Direction the seated FM's devolved-government approval pulls separation
 * desire, by their devolution policy. Approval is a *mandate* for the FM's
 * stance: a popular unionist FM pulls toward the union (−1), a popular
 * pro-independence FM toward separation (+1); Pro-Devolution is neutral on the
 * national question (0). Used by {@link regionalApprovalDrift}.
 */
export const DEVOLUTION_POLICY_APPROVAL_DIRECTION: Record<DevolutionPolicy, number> = {
  anti: -1,
  pro: 0,
  independence: 1,
};

/**
 * Approval moves desire continuously: each point from 50 contributes 0.002
 * per turn, capped at 0.05 in either direction. Ordinary changes matter more
 * without increasing the previous extreme contribution.
 */
export const APPROVAL_DRIFT_PER_POINT = 0.002;
export const APPROVAL_DRIFT_CAP = 0.05;

function approvalMandate(approval: number): number {
  return Math.max(
    -APPROVAL_DRIFT_CAP,
    Math.min(APPROVAL_DRIFT_CAP, (approval - 50) * APPROVAL_DRIFT_PER_POINT)
  );
}

/** Popular regional governments advance their stance; unpopular ones weaken it.
 * Pro-Devolution stays neutral on separation, regardless of approval. */
export function regionalApprovalDrift(approval: number, policy: DevolutionPolicy): number {
  const direction = DEVOLUTION_POLICY_APPROVAL_DIRECTION[policy];
  if (direction === 0 || approval === 50) return 0;
  return approvalMandate(approval) * direction;
}

/** Westminster has half the local government's direct and approval influence. */
export const WESTMINSTER_INFLUENCE = 0.5;
export function westminsterPolicyDrift(policy: DevolutionPolicy): number {
  return DEVOLUTION_POLICY_DRIFT[policy] * WESTMINSTER_INFLUENCE;
}

/** Approval endorses Westminster's chosen stance toward this particular region. */
export function nationalApprovalDrift(approval: number, policy: DevolutionPolicy = "anti"): number {
  return regionalApprovalDrift(approval, policy) * WESTMINSTER_INFLUENCE;
}

/** Missing fields on older worlds retain a unionist constitutional position. */
export function resolveWestminsterPolicy(policy?: DevolutionPolicy): DevolutionPolicy {
  return policy ?? "anti";
}

/** Drift from national inflation rate (annualised percent). High inflation
 *  read as Westminster economic mismanagement → push toward independence. */
export function inflationDrift(inflationPercent: number): number {
  if (inflationPercent > 5) return 0.02;
  if (inflationPercent >= 2) return 0;
  return -0.01;
}

/** Slow mean-reversion toward the long-run baseline. Pulls toward 25 (status-
 *  quo unionism / partition acceptance) rather than the mathematical midpoint
 *  of 50 — without sustained pro-indy drivers, sentiment defaults to the
 *  established settlement. Rate is intentionally small so the drift is only
 *  the floor pull, not a fast unwind. */
export const MEAN_REVERSION_TARGET = 25;
export const MEAN_REVERSION_RATE = 0.003;
export function meanReversionDrift(current: number): number {
  // Stop at the target instead of oscillating when less than one step away.
  return Math.max(
    -MEAN_REVERSION_RATE,
    Math.min(MEAN_REVERSION_RATE, MEAN_REVERSION_TARGET - current)
  );
}

export interface IndependenceDesireDriftPerRegion {
  stateId: string;
  policy: DevolutionPolicy;
  westminsterPolicy: DevolutionPolicy;
  trend: number;
  previous: number;
  next: number;
  delta: number;
  drivers: {
    policy: number;
    westminsterPolicy: number;
    regionalApproval: number;
    nationalApproval: number;
    inflation: number;
    meanReversion: number;
  };
  inputs: {
    regionalApproval: number;
    nationalApproval: number;
    inflationPercent: number;
  };
}

export interface IndependenceDesireDriftResult {
  regionsProcessed: number;
  perRegion: IndependenceDesireDriftPerRegion[];
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Preserve sub-hundredth drivers while avoiding accumulated floating-point noise. */
function round6(x: number): number {
  return Math.round(x * 1_000_000) / 1_000_000;
}

/**
 * Pure compute helper — shared by the turn engine and the Devolution tab's
 * driver-breakdown preview, so both stay in lockstep with the constants.
 * No DB I/O.
 */
export function computeIndependenceDesireDriftSnapshot(args: {
  previous: number;
  policy: DevolutionPolicy;
  westminsterPolicy?: DevolutionPolicy;
  regionalApproval: number;
  nationalApproval: number;
  inflationPercent: number;
}): {
  drivers: IndependenceDesireDriftPerRegion["drivers"];
  delta: number;
  next: number;
} {
  const { previous, policy, regionalApproval, nationalApproval, inflationPercent } = args;
  const drivers = {
    policy: DEVOLUTION_POLICY_DRIFT[policy],
    regionalApproval: regionalApprovalDrift(regionalApproval, policy),
    westminsterPolicy: westminsterPolicyDrift(resolveWestminsterPolicy(args.westminsterPolicy)),
    nationalApproval: nationalApprovalDrift(
      nationalApproval,
      resolveWestminsterPolicy(args.westminsterPolicy)
    ),
    inflation: inflationDrift(inflationPercent),
    meanReversion: meanReversionDrift(previous),
  };
  const delta =
    drivers.policy +
    drivers.westminsterPolicy +
    drivers.regionalApproval +
    drivers.nationalApproval +
    drivers.inflation +
    drivers.meanReversion;
  const next = round6(clamp(previous + delta, 0, 100));
  // Trend is the movement actually stored, including clipping at either bound.
  return { drivers, delta: round6(next - previous), next };
}

export const DEVOLUTION_POLICY_CHANGE_AP_COST = 2;
export const DEVOLUTION_POLICY_CHANGE_COOLDOWN_TURNS = 72;

/** Shared policy-change eligibility, including independent regional cooldowns. */
export function westminsterStanceChangeError(args: {
  currentPolicy: DevolutionPolicy;
  policy: DevolutionPolicy;
  changedAtTurn?: number;
  currentTurn: number;
  actions: number;
  changedUnderGovernment?: string;
  government?: WestminsterGovernment | null;
}): string | null {
  if (args.currentPolicy === args.policy) return "Policy is already set to this value.";
  if (args.actions < DEVOLUTION_POLICY_CHANGE_AP_COST) return "Insufficient office action points.";
  const remaining = westminsterStanceCooldownRemaining(args);
  const readyAt = args.currentTurn + remaining;
  if (remaining > 0) return `Policy change on cooldown until turn ${readyAt}.`;
  return null;
}

/** A seated ministry, including a new election or same-turn PM succession. */
export interface WestminsterGovernment {
  key: string;
  formedTurn: number | null;
}

/** Old saves infer inheritance conservatively from the government's formation turn. */
export function hasInitialWestminsterChange(args: {
  changedAtTurn?: number;
  changedUnderGovernment?: string;
  government?: WestminsterGovernment | null;
}): boolean {
  if (!args.government || args.changedAtTurn == null) return false;
  if (args.changedUnderGovernment != null)
    return args.changedUnderGovernment !== args.government.key;
  return args.government.formedTurn != null && args.changedAtTurn < args.government.formedTurn;
}

export function westminsterStanceCooldownRemaining(args: {
  changedAtTurn?: number;
  changedUnderGovernment?: string;
  government?: WestminsterGovernment | null;
  currentTurn: number;
}): number {
  if (hasInitialWestminsterChange(args)) return 0;
  return Math.max(
    0,
    (args.changedAtTurn ?? -Infinity) + DEVOLUTION_POLICY_CHANGE_COOLDOWN_TURNS - args.currentTurn
  );
}

/** Replays the actual drift rules with fixed stances, approval and inflation.
 * One-year movement respects bounds and recovery; the threshold is only a Desire
 * requirement, not a prediction of consent, cooldown eligibility or the vote. */
export function forecastIndependenceDesire(
  args: Parameters<typeof computeIndependenceDesireDriftSnapshot>[0]
) {
  const horizonTurns = TURNS_PER_YEAR * 100;
  let previous = args.previous;
  let annualChange = 0;
  let turnsToThreshold: number | null = previous >= REQUEST_THRESHOLD ? 0 : null;
  for (let turn = 1; turn <= horizonTurns; turn++) {
    previous = computeIndependenceDesireDriftSnapshot({ ...args, previous }).next;
    if (turn === TURNS_PER_YEAR) annualChange = round6(previous - args.previous);
    if (turnsToThreshold == null && previous >= REQUEST_THRESHOLD) turnsToThreshold = turn;
    if (turn >= TURNS_PER_YEAR && turnsToThreshold != null) break;
  }
  return { annualChange, turnsToThreshold, horizonTurns, threshold: REQUEST_THRESHOLD };
}
