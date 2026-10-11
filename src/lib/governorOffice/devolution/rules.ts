/**
 * Independence and reunification desire changes with the First Minister's
 * stance, regional and Westminster approval, inflation and baseline recovery.
 * computeIndependenceDesireDriftSnapshot returns the next value and its drivers.
 */
import type { DevolutionPolicy } from "@/lib/db/types/governorOfficeState";

/**
 * Drift contribution per turn from the FM's Devolution Policy choice.
 * Policy alone adds 2.4 points per game year before baseline recovery.
 * A popular separatist government at 70 approval adds about 4.2 points
 * annually with neutral Westminster approval and normal inflation.
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

/** Unpopular Westminster governments increase desire regardless of FM stance. */
export function nationalApprovalDrift(approval: number): number {
  if (approval === 50) return 0;
  return -approvalMandate(approval);
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
  previous: number;
  next: number;
  delta: number;
  drivers: {
    policy: number;
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
    nationalApproval: nationalApprovalDrift(nationalApproval),
    inflation: inflationDrift(inflationPercent),
    meanReversion: meanReversionDrift(previous),
  };
  const delta =
    drivers.policy +
    drivers.regionalApproval +
    drivers.nationalApproval +
    drivers.inflation +
    drivers.meanReversion;
  const next = round6(clamp(previous + delta, 0, 100));
  // Trend is the movement actually stored, including clipping at either bound.
  return { drivers, delta: round6(next - previous), next };
}
