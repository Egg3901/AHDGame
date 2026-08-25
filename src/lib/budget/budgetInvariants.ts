import type { Db } from "mongodb";
import type { FederalBudget } from "@/lib/db/types/budget";
import { federalSurplus, type SurplusInputs } from "./federalSurplus";
import { nationalDebtFromBalance } from "./treasuryBalance";

/**
 * Two derived fields on `federalBudget` are caches of an expression, not
 * independent state:
 *
 *   surplus        === revenue.total - spending.total   (see federalSurplus)
 *   debt.principal === max(0, -treasuryBalance)         (see fiscalImpact.ts,
 *                                                        treasuryBalance.ts)
 *
 * Both hold at every fiscal close but drift intra-year on the live world, and
 * every writer inspected maintains them on its own write, so the stale writer
 * is a read-modify-write race rather than a missing update.
 *
 * Measured at turn 366 and already ruled out: revenue is not stale
 * (`calculateFederalRevenue` reproduces the stored total to the unit on all 27
 * countries), and `spending.total` genuinely equals the sum of its parts. Six
 * countries recompute both identically and still drift.
 *
 * This check must run at the END of a turn. Live `updatedAt` values show budget
 * writes landing well after the corporation phase, so a check placed there
 * reports the state before the culprit acts.
 *
 * Tolerance is 1 unit: these are whole-currency amounts in the billions, so
 * sub-unit float noise is not a breach.
 */
const TOLERANCE = 1;

export interface InvariantInputs extends SurplusInputs {
  surplus?: number;
  treasuryBalance?: number;
  debt?: { principal?: number } | null;
}

export interface InvariantBreach {
  field: "surplus" | "debtPrincipal";
  stored: number;
  derived: number;
  absDelta: number;
}

export function checkFederalBudgetInvariants(budget: InvariantInputs): InvariantBreach[] {
  const breaches: InvariantBreach[] = [];

  if (typeof budget.surplus === "number") {
    const derived = federalSurplus(budget);
    const absDelta = Math.abs(budget.surplus - derived);
    if (absDelta > TOLERANCE) {
      breaches.push({ field: "surplus", stored: budget.surplus, derived, absDelta });
    }
  }

  const principal = budget.debt?.principal;
  if (typeof principal === "number" && typeof budget.treasuryBalance === "number") {
    const derived = nationalDebtFromBalance(budget.treasuryBalance);
    const absDelta = Math.abs(principal - derived);
    if (absDelta > TOLERANCE) {
      breaches.push({ field: "debtPrincipal", stored: principal, derived, absDelta });
    }
  }

  return breaches;
}

/**
 * Log every federal budget whose derived caches drifted this turn.
 *
 * Never throws and never writes: a diagnostic must not be able to fail a turn.
 * Call it once, after every phase has run.
 */
export async function reportFederalBudgetInvariantBreaches(db: Db, turn: number): Promise<void> {
  try {
    const budgets = await db
      .collection<FederalBudget>("federalBudget")
      .find(
        {},
        {
          projection: {
            countryId: 1,
            "revenue.total": 1,
            "spending.total": 1,
            surplus: 1,
            treasuryBalance: 1,
            "debt.principal": 1,
            updatedAt: 1,
          },
        }
      )
      .toArray();

    for (const budget of budgets) {
      for (const breach of checkFederalBudgetInvariants(budget)) {
        console.warn(
          `[BudgetInvariant] turn ${turn} ${budget.countryId ?? String(budget._id)} ` +
            `${breach.field}: stored ${breach.stored} vs derived ${breach.derived} ` +
            `(delta ${breach.absDelta}, updatedAt ${budget.updatedAt?.toISOString?.() ?? "unknown"})`
        );
      }
    }
  } catch (error) {
    console.warn("[BudgetInvariant] check skipped:", (error as Error).message);
  }
}
