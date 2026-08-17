/**
 * Union services: named programmes a union head switches on, paid for out of
 * the treasury every turn and priced per member.
 *
 * Costs are a FRACTION OF A MEMBER'S ANNUAL WAGE, never an absolute figure.
 * A union in 1953 Nigeria and one in 1953 America both charge dues and run
 * welfare funds, but their currencies differ by orders of magnitude, and eras
 * move the whole wage scale again. Anything denominated in currency here would
 * be correctly tuned in exactly one world. The dues slider is the only figure
 * the player sets in money, and even that is read against the wage when it
 * feeds approval.
 *
 * Three effect channels, all of which land on machinery that already exists:
 *   - `approvalBonus` feeds the union's own approval target (`unionEconomy`).
 *   - `strikeSoftening` damps strike pressure in represented sectors.
 *   - `workerSecurityNudge` feeds the political board through
 *     `labourRelationsPoliticalProvider`, inheriting its cap and decay rather
 *     than opening a second uncapped channel onto the same metric.
 */

import { TURNS_PER_DAY, TURNS_PER_YEAR } from "@/lib/constants/turnTime";

export type UnionServiceId = "strikeFund" | "healthFund" | "legalAid" | "training";

export interface UnionService {
  id: UnionServiceId;
  name: string;
  /** One line, player-facing, says what the members actually get. */
  description: string;
  /** Annual cost per member as a fraction of that member's annual wage. */
  costFractionOfAnnualWage: number;
  /** Points added to the union's approval target while this is running. */
  approvalBonus: number;
  /**
   * Fraction by which this programme damps strike pressure in represented
   * sectors. The strike fund is deliberately 0: it pays members THROUGH a
   * stoppage, so it makes striking survivable rather than unnecessary.
   */
  strikeSoftening: number;
  /** Per-turn nudge toward `economy.workerSecurity`, before the provider's cap. */
  workerSecurityNudge: number;
}

/**
 * Priced against the 1950s reality that dues ran a few percent of wages and a
 * welfare fund was the expensive one. Total cost with everything switched on is
 * ~6.5% of payroll, which a union cannot sustain on a token dues rate: running
 * the full slate is a real commitment, not a box-ticking exercise.
 */
export const UNION_SERVICES: readonly UnionService[] = [
  {
    id: "strikeFund",
    name: "Strike Fund",
    description: "Pays members a stipend while they are out, so a stoppage does not starve them.",
    costFractionOfAnnualWage: 0.015,
    approvalBonus: 8,
    strikeSoftening: 0,
    workerSecurityNudge: 0.4,
  },
  {
    id: "healthFund",
    name: "Health and Welfare Fund",
    description: "Sickness pay, medical cover and a death benefit for members and their families.",
    costFractionOfAnnualWage: 0.025,
    approvalBonus: 12,
    strikeSoftening: 0.18,
    workerSecurityNudge: 1.2,
  },
  {
    id: "legalAid",
    name: "Legal Representation",
    description: "Union lawyers fight dismissals, compensation claims and contract violations.",
    costFractionOfAnnualWage: 0.01,
    approvalBonus: 6,
    strikeSoftening: 0.12,
    workerSecurityNudge: 0.9,
  },
  {
    id: "training",
    name: "Training and Apprenticeship",
    description: "Apprenticeships and skills courses that move members up the wage ladder.",
    costFractionOfAnnualWage: 0.015,
    approvalBonus: 7,
    strikeSoftening: 0.06,
    workerSecurityNudge: 0.6,
  },
] as const;

const BY_ID = new Map<UnionServiceId, UnionService>(UNION_SERVICES.map((s) => [s.id, s]));

export function getUnionService(id: UnionServiceId): UnionService | undefined {
  return BY_ID.get(id);
}

/** Drops unknown ids and duplicates, so a stale or hand-edited document cannot widen the effect. */
export function normalizeServiceIds(ids: readonly string[] | undefined | null): UnionServiceId[] {
  if (!ids) return [];
  const seen = new Set<UnionServiceId>();
  for (const id of ids) {
    if (BY_ID.has(id as UnionServiceId)) seen.add(id as UnionServiceId);
  }
  return [...seen];
}

/**
 * A game year is {@link TURNS_PER_YEAR} turns while wages are quoted per real
 * day ({@link TURNS_PER_DAY} turns), so an annual figure is the daily one times
 * the number of days in a game year. Getting this wrong by using 365 would
 * overstate every wage by two orders of magnitude and make dues look free.
 */
export const GAME_DAYS_PER_YEAR = TURNS_PER_YEAR / TURNS_PER_DAY;

/** Annual wage for one member from the sector's daily `wagePerWorker`. */
export function annualWageFromDaily(wagePerWorkerDaily: number): number {
  const daily = Number.isFinite(wagePerWorkerDaily) ? Math.max(0, wagePerWorkerDaily) : 0;
  return daily * GAME_DAYS_PER_YEAR;
}

/** Combined annual cost per member, as a fraction of annual wage, for the active slate. */
export function servicesCostFraction(active: readonly UnionServiceId[]): number {
  return active.reduce((sum, id) => sum + (BY_ID.get(id)?.costFractionOfAnnualWage ?? 0), 0);
}

/** Combined approval bonus for the active slate. */
export function servicesApprovalBonus(active: readonly UnionServiceId[]): number {
  return active.reduce((sum, id) => sum + (BY_ID.get(id)?.approvalBonus ?? 0), 0);
}

/**
 * Combined strike damping for the active slate, as a fraction in [0, 0.6].
 * Capped below 1 on purpose: services make a workforce less likely to walk out,
 * they never make a sector strike-proof, or a union could buy its way out of
 * the wage mechanic entirely.
 */
export const MAX_STRIKE_SOFTENING = 0.6;

export function servicesStrikeSoftening(active: readonly UnionServiceId[]): number {
  const raw = active.reduce((sum, id) => sum + (BY_ID.get(id)?.strikeSoftening ?? 0), 0);
  return Math.max(0, Math.min(MAX_STRIKE_SOFTENING, raw));
}

/** Combined per-turn `economy.workerSecurity` nudge for the active slate. */
export function servicesWorkerSecurityNudge(active: readonly UnionServiceId[]): number {
  return active.reduce((sum, id) => sum + (BY_ID.get(id)?.workerSecurityNudge ?? 0), 0);
}
