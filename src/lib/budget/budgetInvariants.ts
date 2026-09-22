import type { Db } from "mongodb";
import type { Bond } from "@/lib/db/types/bond";
import type { FederalBudget } from "@/lib/db/types/budget";
import { federalSurplus, type SurplusInputs } from "./federalSurplus";
import { sovereignBondOutstanding, sovereignDebtTerms } from "@/lib/bonds/sovereignPrincipal";

/**
 * Stored fiscal fields that must agree with their definitions at every close:
 *
 *   surplus        === revenue.total - spending.total   (see federalSurplus)
 *   debt.principal === outstanding sovereign bond stock (see
 *                      bonds/sovereignPrincipal.ts: active, non-defaulted
 *                      sovereign face minus restructure haircuts)
 *
 * `surplus` is a cache of sibling fields and can drift intra-turn while writers
 * interleave, which is why the hygiene pass below reconciles it. `debt.principal`
 * is maintained incrementally by the bond-ledger writers (issuance, maturity,
 * default resolution, merger, secession) and is NEVER derived from
 * `treasuryBalance`: treasury cash is a separate position, and a country may
 * hold cash assets and bond debt at the same time (refs #1975).
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
  /**
   * Canonical outstanding sovereign principal for this country: the
   * haircut-adjusted active non-defaulted sovereign bond face (see
   * bonds/sovereignPrincipal.ts). The reconciliation pass supplies it from the
   * `bonds` collection; unit callers pass the sum they set up. When absent the
   * debt leg cannot be validated against the ledger and is skipped, so legacy
   * docs and bond-blind callers never trip a false breach.
   */
  outstandingSovereignPrincipal?: number;
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
  const outstanding = budget.outstandingSovereignPrincipal;
  if (typeof principal === "number" && typeof outstanding === "number") {
    const derived = Math.max(0, outstanding);
    const absDelta = Math.abs(principal - derived);
    if (absDelta > TOLERANCE) {
      breaches.push({ field: "debtPrincipal", stored: principal, derived, absDelta });
    }
  }

  return breaches;
}

/**
 * A drift so large the STORED value is probably not the broken half.
 *
 * Reconciliation assumes the derived expression is the truth, which is what makes it
 * safe: `surplus` is defined over stored revenue/spending, and `debt.principal`
 * is defined as the outstanding bond stock. If a source field were itself corrupt,
 * writing the stored value from it would launder the corruption into a
 * player-visible number instead of reporting it. Observed real drift is fractions
 * of a percent, so a quarter of the derived value is far outside the race this
 * fixes and squarely in "something else is wrong".
 *
 * Zero outstanding principal is always reconcilable: repudiation and merger
 * legitimately empty the stock, so a zero derived value is expected, not suspect.
 */
const IMPLAUSIBLE_DRIFT_RATIO = 0.25;

export interface InvariantReconciliation {
  checked: number;
  corrected: number;
  skipped: number;
}

/**
 * Reconcile every federal budget whose stored fiscal values drifted this turn.
 *
 * `surplus` drifts because every writer does its own read-modify-write. That was
 * diagnosed and then left as a log line, on the reasoning that display surfaces
 * derive the value anyway. They do not all derive it: the stored `surplus` gates
 * a player's treasury transfer against the debt ceiling, sizes quarterly
 * sovereign bond issuance, and feeds national metrics, the central-bank page and
 * the public API history. A stale cache there is wrong money, not noise.
 *
 * `debt.principal` is reconciled against the bond ledger, never the treasury
 * balance: the pass sums haircut-adjusted active non-defaulted sovereign face
 * per country and re-points any drifted stock at that sum (refreshing the
 * debt-service terms off the corrected stock). Cash movements cannot move it.
 *
 * So this writes rather than warns. It runs once, after every phase, when the
 * authoritative fields have all landed. The consequential in-turn readers derive
 * directly as well, because a turn phase can read the stored value before this
 * runs.
 *
 * Never throws: a hygiene pass must not be able to fail a turn.
 */
export async function reconcileFederalBudgetInvariants(
  db: Db,
  turn: number
): Promise<InvariantReconciliation> {
  const result: InvariantReconciliation = { checked: 0, corrected: 0, skipped: 0 };
  try {
    const [budgets, bonds] = await Promise.all([
      db
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
              gdp: 1,
              gdpSmoothed: 1,
              investorConfidence: 1,
              imfSovereignBailoutActive: 1,
              sovereignRiskAnchor: 1,
              updatedAt: 1,
            },
          }
        )
        .toArray(),
      db
        .collection<Bond>("bonds")
        .find(
          { issuerType: "sovereign", matured: false, defaulted: false },
          // The outstanding helper re-checks the query-filtered fields, so
          // they must be projected: a doc arriving without `issuerType`
          // reads as non-sovereign and contributes 0, which would re-point
          // every stored principal at zero (refs #1975).
          {
            projection: {
              countryId: 1,
              issuerType: 1,
              matured: 1,
              defaulted: 1,
              totalIssued: 1,
              restructureHaircutPercent: 1,
            },
          }
        )
        .toArray(),
    ]);
    result.checked = budgets.length;

    const outstandingByCountry = new Map<string, number>();
    for (const bond of bonds) {
      if (!bond.countryId) continue;
      const key = String(bond.countryId);
      const prior = outstandingByCountry.get(key) ?? 0;
      outstandingByCountry.set(key, prior + sovereignBondOutstanding(bond));
    }

    const ops = [];
    for (const budget of budgets) {
      const key = String(budget.countryId ?? budget._id);
      // A successful bonds read with no rows for this country means the stock
      // is genuinely empty (repudiated, merged away, or never indebted), not
      // unknown: the debt leg then expects zero.
      const outstanding = outstandingByCountry.get(key) ?? 0;
      const breaches = checkFederalBudgetInvariants({
        ...budget,
        outstandingSovereignPrincipal: outstanding,
      });
      if (breaches.length === 0) continue;

      const set: Record<string, number | string> = {};
      for (const breach of breaches) {
        const scale = Math.abs(breach.derived);
        if (scale > 0 && breach.absDelta > scale * IMPLAUSIBLE_DRIFT_RATIO) {
          // Report and leave alone. Writing this would hide a broken source field
          // behind a freshly consistent stored value.
          result.skipped += 1;
          console.warn(
            `[BudgetInvariant] turn ${turn} ${budget.countryId ?? String(budget._id)} ` +
              `${breach.field}: NOT reconciled, drift ${breach.absDelta} is over ` +
              `${IMPLAUSIBLE_DRIFT_RATIO * 100}% of derived ${breach.derived} ` +
              `(stored ${breach.stored}). The source field is the suspect, not the stored value.`
          );
          continue;
        }
        if (breach.field === "surplus") {
          set.surplus = breach.derived;
        } else {
          const terms = sovereignDebtTerms(breach.derived, {
            gdp: budget.gdp ?? 0,
            gdpSmoothed: budget.gdpSmoothed,
            investorConfidence: budget.investorConfidence,
            imfBailoutActive: budget.imfSovereignBailoutActive,
            sovereignRiskAnchor: budget.sovereignRiskAnchor,
          });
          set["debt.principal"] = Math.round(breach.derived);
          set["debt.interestRate"] = terms.interestRate;
          set.debtToGdpRatio = terms.debtToGdpRatio;
          set.creditRating = terms.creditRating;
        }
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
