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
 * A drift so large the CACHE is probably not the broken half.
 *
 * Reconciliation assumes the derived expression is the truth, which is what makes it
 * safe: `surplus` and `debt.principal` are defined as expressions over other stored
 * fields. If `revenue.total` or `treasuryBalance` were themselves corrupt, writing the
 * cache from them would launder the corruption into a player-visible number instead of
 * reporting it. Observed real drift is fractions of a percent (BAL debtPrincipal 0.58%,
 * IE surplus 0.08%), so a quarter of the derived value is far outside the race this
 * fixes and squarely in "something else is wrong".
 */
const IMPLAUSIBLE_DRIFT_RATIO = 0.25;

export interface InvariantReconciliation {
  checked: number;
  corrected: number;
  skipped: number;
}

/**
 * Reconcile every federal budget whose derived caches drifted this turn.
 *
 * These two fields are caches of an expression, and they drift because every writer
 * does its own read-modify-write. That was diagnosed and then left as a log line, on the
 * reasoning that display surfaces derive the value anyway. They do not all derive it:
 * the stored `surplus` gates a player's treasury transfer against the debt ceiling
 * (`treasury-transfer/route.ts`), sizes quarterly sovereign bond issuance
 * (`bonds/sovereign.ts`), and feeds national metrics, the central-bank page and the
 * public API history. A stale cache there is wrong money, not noise.
 *
 * So this writes rather than warns. It runs once, after every phase, when the
 * authoritative fields have all landed, and sets each cache to its own definition. The
 * two consequential in-turn readers derive directly as well, because a turn phase can
 * read the cache before this runs.
 *
 * Never throws: a hygiene pass must not be able to fail a turn.
 */
export async function reconcileFederalBudgetInvariants(
  db: Db,
  turn: number
): Promise<InvariantReconciliation> {
  const result: InvariantReconciliation = { checked: 0, corrected: 0, skipped: 0 };
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
    result.checked = budgets.length;

    const ops = [];
    for (const budget of budgets) {
      const breaches = checkFederalBudgetInvariants(budget);
      if (breaches.length === 0) continue;

      const set: Record<string, number> = {};
      for (const breach of breaches) {
        const scale = Math.abs(breach.derived);
        if (scale > 0 && breach.absDelta > scale * IMPLAUSIBLE_DRIFT_RATIO) {
          // Report and leave alone. Writing this would hide a broken source field
          // behind a freshly consistent cache.
          result.skipped += 1;
          console.warn(
            `[BudgetInvariant] turn ${turn} ${budget.countryId ?? String(budget._id)} ` +
              `${breach.field}: NOT reconciled, drift ${breach.absDelta} is over ` +
              `${IMPLAUSIBLE_DRIFT_RATIO * 100}% of derived ${breach.derived} ` +
              `(stored ${breach.stored}). The source field is the suspect, not the cache.`
          );
          continue;
        }
        set[breach.field === "surplus" ? "surplus" : "debt.principal"] = breach.derived;
      }

      if (Object.keys(set).length > 0) {
        ops.push({ updateOne: { filter: { _id: budget._id }, update: { $set: set } } });
      }
    }

    if (ops.length > 0) {
      await db.collection<FederalBudget>("federalBudget").bulkWrite(ops, { ordered: false });
      result.corrected = ops.length;
      console.info(
        `[BudgetInvariant] turn ${turn}: reconciled ${result.corrected} of ${result.checked} ` +
          `federal budgets to their derived values`
      );
    }
  } catch (error) {
    console.warn("[BudgetInvariant] reconcile skipped:", (error as Error).message);
  }
  return result;
}
