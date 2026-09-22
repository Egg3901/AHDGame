import type { ObjectId } from "mongodb";

/**
 * UK annual Budget (epic #856, ticket #858, Cluster B).
 *
 * A dedicated Budget subsystem: the Chancellor authors an annual bundle of tax
 * levers + departmental spending allocations, tables it, and the Commons votes
 * it as a single confidence matter. Defeat fires the `budgetDefeat` confidence
 * event (the biggest single hit on the gauge).
 *
 * One document per fiscal year. See ops-knowledge `uk-rework-design-2026-08-25`.
 */

export type UKBudgetStatus =
  /** Chancellor is still editing. */
  | "draft"
  /** Tabled before the Commons, awaiting the vote. */
  | "tabled"
  /** Passed the confidence vote. */
  | "passed"
  /** Defeated, which triggers the budget-defeat confidence hit. */
  | "defeated";

export interface UKBudget {
  _id?: ObjectId;
  fiscalYear: number;
  status: UKBudgetStatus;
  /** Authoring Chancellor or acting Prime Minister (null for an NPP government). */
  chancellorCharacterId: ObjectId | null;
  /**
   * Tax levers: UK tax legislation id → rate (percent). Keys validated against
   * the real UK tax laws.
   */
  taxRates: Record<string, number>;
  /**
   * Statutory programme changes bundled into this Budget: political-law id to
   * target level (0-4). These compile into ordinary policy provisions so the
   * enacted-law ledger remains authoritative.
   */
  programLevels: Record<string, number>;
  /** Legacy unshipped v1 field. Never execute these percentages. */
  spendingAllocations?: Record<string, number>;
  tabledAt?: Date | null;
  resolvedAt?: Date | null;
  votesFor?: number;
  votesAgainst?: number;
  createdAt: Date;
  updatedAt: Date;
}
