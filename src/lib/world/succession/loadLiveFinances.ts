import type { ClientSession, Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Bond } from "@/lib/db/types/bond";
import type { FederalBudget } from "@/lib/db/types/budget";
import { sovereignBondOutstanding } from "@/lib/bonds/sovereignPrincipal";

export interface LiveSuccessionCreditorContract {
  bondId: string;
  currencyCode: Bond["currencyCode"] | null;
  totalIssued: number;
  outstandingPrincipal: number;
  maturityTurn: number;
  matured: boolean;
  defaulted: boolean;
}

export interface LiveSuccessionFinances {
  budgetId: string;
  /** Cash stays separate from bond debt and remains in its stored currency. */
  treasuryBalanceLocal: number;
  budgetCurrencyCode: FederalBudget["currencyCode"] | null;
  reportedDebtPrincipalLocal: number;
  activeBondPrincipalByCurrency: Record<string, number>;
  creditorContracts: LiveSuccessionCreditorContract[];
}

/** Capture actual cash and creditor contracts without redenominating or moving
 * any holder. A settlement writer must reconcile approved shared-accounting
 * allocations against this guarded snapshot before keyed application steps. */
export async function loadLiveSuccessionFinances(
  db: Db,
  sourceCountryId: CountryId,
  session?: ClientSession
): Promise<LiveSuccessionFinances> {
  const budgets = await db
    .collection<FederalBudget>("federalBudget")
    .find({ $or: [{ _id: sourceCountryId }, { countryId: sourceCountryId }] }, { session })
    .toArray();
  if (budgets.length !== 1)
    throw new Error("Federation settlement requires exactly one source budget");
  const budget = budgets[0];
  if (
    !Number.isFinite(budget.treasuryBalance) ||
    !Number.isFinite(budget.debt?.principal) ||
    budget.debt.principal < 0
  )
    throw new Error("Federation source budget has invalid cash or debt stock");

  const bonds = await db
    .collection<Bond>("bonds")
    .find({ issuerType: "sovereign", countryId: sourceCountryId }, { session })
    .toArray();
  const activeBondPrincipalByCurrency: Record<string, number> = {};
  const creditorContracts = bonds.map((bond) => {
    if (
      !Number.isFinite(bond.totalIssued) ||
      bond.totalIssued < 0 ||
      !Number.isSafeInteger(bond.maturityTurn) ||
      bond.maturityTurn < 0
    )
      throw new Error("Federation source has an invalid creditor contract");
    const currencyCode = bond.currencyCode ?? null;
    const outstandingPrincipal = sovereignBondOutstanding(bond);
    if (outstandingPrincipal > 0) {
      const currencyKey = currencyCode ?? "anchor";
      activeBondPrincipalByCurrency[currencyKey] =
        (activeBondPrincipalByCurrency[currencyKey] ?? 0) + outstandingPrincipal;
      if (!Number.isFinite(activeBondPrincipalByCurrency[currencyKey]))
        throw new Error("Federation source debt exceeds supported accounting precision");
    }
    return {
      bondId: bond._id.toString(),
      currencyCode,
      totalIssued: bond.totalIssued,
      outstandingPrincipal,
      maturityTurn: bond.maturityTurn,
      matured: bond.matured,
      defaulted: bond.defaulted,
    };
  });
  creditorContracts.sort((a, b) => a.bondId.localeCompare(b.bondId));
  return {
    budgetId: String(budget._id),
    treasuryBalanceLocal: budget.treasuryBalance,
    budgetCurrencyCode: budget.currencyCode ?? null,
    reportedDebtPrincipalLocal: budget.debt.principal,
    activeBondPrincipalByCurrency,
    creditorContracts,
  };
}
