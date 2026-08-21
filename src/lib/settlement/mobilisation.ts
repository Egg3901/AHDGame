/**
 * What it costs to stand at the brink.
 *
 * Levied every turn the ladder is armed, on all four delegations' countries —
 * not just the two that can arm it. Rung 5 mobilises everybody.
 *
 * Runs inside the settlement turn phase rather than as its own phase: it is
 * driven by a field that phase already owns, and splitting it would mean a
 * second read of the same document.
 */
import type { Db } from "mongodb";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { CountryId } from "@/lib/constants/countries";
import {
  MOBILISATION_APPROVAL_HIT,
  MOBILISATION_TREASURY_SHARE,
  SETTLEMENT_SEATS,
} from "@/lib/constants/settlementCrisis";
import { spendFromTreasury } from "@/lib/budget/treasurySpend";
import { applyCountryApprovalDelta } from "@/lib/events/substrate/applyEffects";

export interface MobilisationResult {
  countriesLevied: number;
  totalLocalSpent: number;
}

/**
 * Charge one turn of mobilisation to every seat country.
 *
 * A country already in the red is NOT charged further: the levy is a share of a
 * positive balance, and taking a percentage of a debt would both grow the debt
 * without limit and invert the intent — the point is that armies are expensive
 * to keep in the field, not that a bankrupt state pays most.
 */
export async function levyMobilisation(
  db: Db,
  params: { armed: boolean }
): Promise<MobilisationResult> {
  if (!params.armed) return { countriesLevied: 0, totalLocalSpent: 0 };

  let countriesLevied = 0;
  let totalLocalSpent = 0;

  for (const seat of SETTLEMENT_SEATS) {
    const countryId = seat.countryId as CountryId;
    const budget = await db
      .collection<FederalBudget>("federalBudget")
      .findOne(
        { countryId: countryId as FederalBudget["countryId"] },
        { projection: { treasuryBalance: 1 } }
      );
    const balance = budget?.treasuryBalance ?? 0;

    // Approval is charged regardless — a mobilised country is unpopular whether
    // or not its treasury has anything left to take.
    await applyCountryApprovalDelta(db, countryId, -MOBILISATION_APPROVAL_HIT);
    countriesLevied++;

    if (balance <= 0) continue;
    const amount = Math.round(balance * MOBILISATION_TREASURY_SHARE);
    if (amount <= 0) continue;
    await spendFromTreasury(db, countryId, amount);
    totalLocalSpent += amount;
  }

  return { countriesLevied, totalLocalSpent };
}
