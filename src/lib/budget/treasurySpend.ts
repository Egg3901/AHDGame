import type { Db } from "mongodb";
import type { FederalBudget } from "@/lib/db/types/budget";
import { deriveFiscalState } from "@/lib/budget/treasuryBalance";
import { computeFiscalImpact } from "@/lib/budget/fiscalImpact";

export interface FiscalImpact {
  fromSurplus: number;
  addedToDebt: number;
  newTreasuryBalance: number;
  newDebtPrincipal: number;
}

/**
 * Canonical treasury mover. `delta` is signed (negative = spend, positive =
 * credit). Decrements the SSOT `treasuryBalance` and, when `resyncDerived`,
 * immediately recomputes the derived fiscal fields from the new balance so the
 * surplus→debt transition is real now (the next sovereign bond issuance reads
 * `debt.principal`). Returns the surplus/debt split of a SPEND (zero split for a
 * credit). The treasury is allowed to go negative — that is national debt.
 */
async function moveTreasury(
  db: Db,
  countryId: string,
  delta: number,
  resyncDerived: boolean
): Promise<FiscalImpact> {
  const budget = await db
    .collection<FederalBudget>("federalBudget")
    .findOne({ countryId: countryId as FederalBudget["countryId"] });
  const before = budget?.treasuryBalance ?? 0;
  const after = Math.round(before + delta);

  const split =
    delta < 0 ? computeFiscalImpact(before, -delta) : { fromSurplus: 0, addedToDebt: 0 };

  const set: Record<string, unknown> = { treasuryBalance: after, updatedAt: new Date() };
  let newDebtPrincipal = Math.max(0, -after);

  if (resyncDerived && budget) {
    const derived = deriveFiscalState({
      treasuryBalance: after,
      gdp: budget.gdp ?? 0,
      gdpSmoothed: budget.gdpSmoothed,
      ceiling: budget.debt?.ceiling ?? 0,
      investorConfidence: budget.investorConfidence,
      imfBailoutActive: budget.imfSovereignBailoutActive,
      sovereignRiskAnchor: budget.sovereignRiskAnchor,
    });
    newDebtPrincipal = derived.principal;
    set["debt.principal"] = derived.principal;
    set["debt.interestRate"] = derived.interestRate;
    set["debtToGdpRatio"] = derived.debtToGdpRatio;
    set["creditRating"] = derived.creditRating;
  }

  await db
    .collection<FederalBudget>("federalBudget")
    .updateOne({ countryId: countryId as FederalBudget["countryId"] }, { $set: set });

  return { ...split, newTreasuryBalance: after, newDebtPrincipal };
}

/** Spend `amountLocal` (≥0) from the treasury: surplus first, remainder = new debt. */
export function spendFromTreasury(
  db: Db,
  countryId: string,
  amountLocal: number,
  opts: { resyncDerived?: boolean } = {}
): Promise<FiscalImpact> {
  return moveTreasury(db, countryId, -Math.max(0, amountLocal), opts.resyncDerived ?? true);
}

/** Credit `amountLocal` (≥0) back to the treasury (inverse of spendFromTreasury). */
export function creditTreasury(
  db: Db,
  countryId: string,
  amountLocal: number,
  opts: { resyncDerived?: boolean } = {}
): Promise<FiscalImpact> {
  return moveTreasury(db, countryId, Math.max(0, amountLocal), opts.resyncDerived ?? true);
}
