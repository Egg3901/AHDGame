import type { Db } from "mongodb";
import type { FederalBudget } from "@/lib/db/types/budget";
import { computeFiscalImpact } from "@/lib/budget/fiscalImpact";

export interface FiscalImpact {
  fromSurplus: number;
  addedToDebt: number;
  newTreasuryBalance: number;
  newDebtPrincipal: number;
}

/**
 * Canonical treasury mover. `delta` is signed (negative = spend, positive =
 * credit). Moves the SSOT `treasuryBalance` only: `debt.principal` belongs to
 * the bond ledger (see bonds/sovereignPrincipal.ts) and is never re-derived
 * from the balance here (#1975). Returns the surplus/debt split of a SPEND
 * (zero split for a credit) plus the post-move balance and the untouched
 * bond-owned principal. The treasury is allowed to go negative.
 */
async function moveTreasury(
  db: Db,
  countryId: string,
  delta: number,
  _resyncDerived: boolean
): Promise<FiscalImpact> {
  const budget = await db
    .collection<FederalBudget>("federalBudget")
    .findOne({ countryId: countryId as FederalBudget["countryId"] });
  const before = budget?.treasuryBalance ?? 0;
  const after = Math.round(before + delta);

  const split =
    delta < 0 ? computeFiscalImpact(before, -delta) : { fromSurplus: 0, addedToDebt: 0 };

  const set: Record<string, unknown> = { treasuryBalance: after, updatedAt: new Date() };
  const newDebtPrincipal = Math.max(0, budget?.debt?.principal ?? 0);

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
