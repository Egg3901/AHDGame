/**
 * Union membership, dues and approval.
 *
 * Replaces `membershipPressure`, the 0-100 organizing score that used to stand
 * in for all three. That number was doing too many jobs: it was the dues base,
 * the unionization drift bias, the strike-capacity gate and the leadership
 * threshold, and players read it as a headcount and saw "Membership 17.0" as a
 * broken stat. It is now three separate things that each mean what they say.
 *
 *   MEMBERS   a real headcount, summed from the workers in the sectors this
 *             union actually represents, weighted by each sector's unionization.
 *   DUES      money, set by the union head as an annual charge per member.
 *   APPROVAL  0-100, how the membership feels about the bargain they are
 *             getting. Dues push it down, services push it up, political
 *             contributions push it down.
 *
 * Approval is the load-bearing one. It anchors the unionization drift target in
 * every represented sector, so a union that charges heavily and gives nothing
 * back watches its own density bleed away, while a well-run union grows into
 * new shops. A targeted organizing drive spikes a sector above that anchor and
 * the existing `trendUnionization` walks it back down, which is what makes
 * drives a push rather than a permanent purchase.
 */

import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import {
  annualWageFromDaily,
  servicesApprovalBonus,
  servicesCostFraction,
  type UnionServiceId,
} from "./unionServices";
import { politicalContributionApprovalPenalty } from "./unionPoliticalContributions";

/** The slice of a sector's payroll a union may charge, as a fraction of annual wage. */
export const MAX_DUES_FRACTION_OF_WAGE = 0.1;

/**
 * Multiplier on per-turn treasury credits (dues) and debits (services).
 *
 * Annual dues are a few percent of era-deflated wages, then spread across
 * {@link TURNS_PER_YEAR} (48) turns. A 3x scale still left the ledger in
 * pennies against shop-sized organize costs. 12x makes a working union's
 * dues cover a typical drive over a handful of turns without retuning wages
 * or the dues slider. Approval math still uses the wage-fraction, not the
 * scaled cash.
 */
export const UNION_TREASURY_FLOW_SCALE = 12;

/**
 * Approval with no dues charged and no services running. Above the midpoint
 * because a union that asks nothing of its members is not disliked, it is
 * merely useless: it has no treasury, so it cannot strike, cannot run services
 * and cannot fund drives.
 */
export const BASE_APPROVAL = 55;

/**
 * Approval points lost per unit of dues burden. Dues at 2% of wages, roughly
 * the historical rate, cost 10 points, which the cheapest single service more
 * than repays. Dues at the 10% ceiling cost 50 and no slate of services can
 * cover that, so gouging the membership is always a losing position.
 */
export const APPROVAL_DUES_PENALTY_PER_UNIT = 500;

/** Most approval can move in one turn, so a slider change is felt over days rather than instantly. */
export const APPROVAL_TREND_STEP_PER_TURN = 1.5;

/** Sector fields needed to count members and price dues against local wages. */
export interface UnionMemberSector {
  workers?: number;
  unionization?: number;
  wagePerWorker?: number;
}

function finitePositive(value: number | undefined, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Headcount across the sectors this union represents: each sector's workers
 * scaled by how unionized it is. A sector at 40% unionization contributes 40%
 * of its workforce, which is what the union can actually charge dues on.
 */
export function unionMembers(sectors: readonly UnionMemberSector[]): number {
  let total = 0;
  for (const sector of sectors) {
    const workers = finitePositive(sector.workers);
    const density = Math.max(0, Math.min(100, finitePositive(sector.unionization)));
    total += workers * (density / 100);
  }
  return Math.round(total);
}

/**
 * Member-weighted average annual wage across represented sectors, used to read
 * dues and service costs against what members actually earn. Falls back to 0
 * when the labour system has not yet written `wagePerWorker`, which makes dues
 * burden 0 and leaves approval at its services-only value rather than dividing
 * by zero.
 */
export function averageAnnualWage(sectors: readonly UnionMemberSector[]): number {
  let weighted = 0;
  let weight = 0;
  for (const sector of sectors) {
    const workers = finitePositive(sector.workers);
    const density = Math.max(0, Math.min(100, finitePositive(sector.unionization)));
    const members = workers * (density / 100);
    if (members <= 0) continue;
    weighted += annualWageFromDaily(finitePositive(sector.wagePerWorker)) * members;
    weight += members;
  }
  return weight > 0 ? weighted / weight : 0;
}

/** Dues as a fraction of annual wage. 0 when wages are unknown, so it cannot fabricate a penalty. */
export function duesBurdenRatio(duesPerWorkerAnnual: number, annualWage: number): number {
  const dues = Math.max(0, finitePositive(duesPerWorkerAnnual));
  if (annualWage <= 0) return 0;
  return dues / annualWage;
}

/** Highest annual dues this union may charge, given local wages. */
export function maxDuesForWage(annualWage: number): number {
  return Math.max(0, annualWage * MAX_DUES_FRACTION_OF_WAGE);
}

/** Treasury gained this turn: the annual per-member charge, spread across the game year. */
export function duesIncomePerTurn(members: number, duesPerWorkerAnnual: number): number {
  const m = Math.max(0, finitePositive(members));
  const rate = Math.max(0, finitePositive(duesPerWorkerAnnual));
  return (UNION_TREASURY_FLOW_SCALE * m * rate) / TURNS_PER_YEAR;
}

/** Treasury spent this turn running the active service slate. */
export function servicesCostPerTurn(
  members: number,
  annualWage: number,
  active: readonly UnionServiceId[]
): number {
  const m = Math.max(0, finitePositive(members));
  const wage = Math.max(0, finitePositive(annualWage));
  return (UNION_TREASURY_FLOW_SCALE * m * wage * servicesCostFraction(active)) / TURNS_PER_YEAR;
}

export interface ApprovalInputs {
  duesPerWorkerAnnual: number;
  annualWage: number;
  activeServices: readonly UnionServiceId[];
  /**
   * True when the treasury could not cover this turn's service bill. Unfunded
   * programmes are promises the union is not keeping, so they stop paying
   * approval instead of continuing to earn it for free.
   */
  servicesLapsed?: boolean;
  /**
   * Share of remaining per-turn budget sent to organizers as political
   * contributions, 0-0.5. Absent reads as none. Costs approval the same way
   * dues do: the membership is judging the policy, not this turn's cash.
   */
  politicalContributionPct?: number;
}

export interface ApprovalTargetBreakdown {
  base: number;
  servicesBonus: number;
  duesPenalty: number;
  politicalPenalty: number;
  target: number;
}

/**
 * Every term in the approval target, exposed from the same authority the turn engine uses.
 * Keeping this arithmetic here lets the UI explain a flat target without reimplementing the
 * balance rule and drifting away from actual turn processing (ticket #1168).
 */
export function approvalTargetBreakdown(inputs: ApprovalInputs): ApprovalTargetBreakdown {
  const burden = duesBurdenRatio(inputs.duesPerWorkerAnnual, inputs.annualWage);
  const duesPenalty = burden * APPROVAL_DUES_PENALTY_PER_UNIT;
  const politicalPenalty = politicalContributionApprovalPenalty(inputs.politicalContributionPct);
  const servicesBonus = inputs.servicesLapsed ? 0 : servicesApprovalBonus(inputs.activeServices);
  const target = Math.max(
    0,
    Math.min(100, BASE_APPROVAL + servicesBonus - duesPenalty - politicalPenalty)
  );
  return { base: BASE_APPROVAL, servicesBonus, duesPenalty, politicalPenalty, target };
}

/**
 * Where approval is heading. Dues and political contributions subtract,
 * services add, and lapsed services add nothing.
 */
export function approvalTarget(inputs: ApprovalInputs): number {
  return approvalTargetBreakdown(inputs).target;
}

/** Steps approval toward its target by at most `APPROVAL_TREND_STEP_PER_TURN`, no overshoot. */
export function trendApproval(current: number, target: number): number {
  const from = Math.max(0, Math.min(100, finitePositive(current, 0)));
  const to = Math.max(0, Math.min(100, target));
  if (from === to) return from;
  const step = Math.min(APPROVAL_TREND_STEP_PER_TURN, Math.abs(to - from));
  return Math.round((from + Math.sign(to - from) * step) * 100) / 100;
}

/** Approval as stored, treating a missing field on pre-existing documents as the base. */
export function unionApproval(union: { approval?: number }): number {
  const a = union.approval;
  return typeof a === "number" && Number.isFinite(a)
    ? Math.max(0, Math.min(100, a))
    : BASE_APPROVAL;
}
