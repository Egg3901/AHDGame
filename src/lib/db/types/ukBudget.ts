import type { ObjectId } from "mongodb";

/**
 * UK annual Budget (epic #856, ticket #858 — Cluster B).
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
  /** Defeated — triggers the budget-defeat confidence hit. */
  | "defeated";

export interface UKBudget {
  _id?: ObjectId;
  fiscalYear: number;
  status: UKBudgetStatus;
  /** Authoring Chancellor (null if authored by an NPP government / admin). */
  chancellorCharacterId: ObjectId | null;
  /**
   * Tax levers: UK tax legislation id → rate (percent). Keys validated against
   * the real UK tax laws.
   */
  taxRates: Record<string, number>;
  /**
   * Departmental spending split: spending category → share of the budget
   * (percent). Categories validated against KNOWN_SPENDING_CATEGORIES; shares
   * sum to ~100.
   */
  spendingAllocations: Record<string, number>;
  tabledAt?: Date | null;
  resolvedAt?: Date | null;
  votesFor?: number;
  votesAgainst?: number;
  createdAt: Date;
  updatedAt: Date;
}
