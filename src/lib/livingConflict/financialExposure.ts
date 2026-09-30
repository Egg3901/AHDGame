import type { Db } from "mongodb";
import type { Corporation, Bond, FederalBudget, GameState } from "@/lib/db/types";
import { loadValuationFxRates } from "@/lib/currency/corporationCapital";
import { resolveCountryCurrencyCode } from "@/lib/currency/govBudgetFields";
import { bankEquity, getCashReserves } from "@/lib/banking/rules/balanceSheet";
import {
  financialCrisisParticipants,
  euroFeedbackExposure,
  type FinancialCountryExposure,
} from "./rules/financialExposure";

/** Current enacted euro membership and actual sovereign-bank positions. */
export async function loadFinancialExposure(db: Db, availableCountries: Set<string>) {
  const [gameState, budgets, banks, bonds, rates] = await Promise.all([
    db
      .collection<GameState>("gameState")
      .findOne({ _id: "current" }, { projection: { eurozoneEnabled: 1, euroAdoptedCountries: 1 } }),
    db
      .collection<FederalBudget>("federalBudget")
      .find(
        {},
        {
          projection: {
            countryId: 1,
            currencyCode: 1,
            sovereignCrisisState: 1,
            debt: 1,
            gdp: 1,
            treasuryBalance: 1,
          },
        }
      )
      .toArray(),
    db
      .collection<Corporation>("corporations")
      .find(
        { "bankCharter.status": { $in: ["active", "failed"] } },
        { projection: { countryId: 1, bankCharter: 1 } }
      )
      .toArray(),
    db
      .collection<Bond>("bonds")
      .find(
        { issuerType: "sovereign", defaulted: false },
        { projection: { countryId: 1, holders: 1, faceValue: 1, marketPrice: 1, currencyCode: 1 } }
      )
      .toArray(),
    loadValuationFxRates(db),
  ]);
  const adopted = new Set<string>(gameState?.euroAdoptedCountries ?? []);
  const byCountry = new Map<string, FinancialCountryExposure>();
  for (const countryId of availableCountries) {
    const budget = budgets.find((row) => row.countryId === countryId);
    // Explicit in-game adoption is authoritative. Legacy modern worlds with
    // no adoption array use their actual EUR-denominated budget, never the DM proxy.
    const euroMember =
      gameState?.eurozoneEnabled !== false &&
      (adopted.size > 0 ? adopted.has(countryId) : resolveCountryCurrencyCode(budget) === "EUR");
    const sovereignStress =
      budget?.sovereignCrisisState === "crisisPending" ||
      budget?.sovereignCrisisState === "crisisResolving"
        ? 100
        : Math.max(
            0,
            Math.min(
              100,
              100 * ((budget?.debt?.principal ?? 0) / Math.max(1, budget?.gdp ?? 1) - 0.8)
            )
          );
    byCountry.set(countryId, {
      countryId,
      euroMember,
      sovereignStress,
      bankStress: 0,
      euroSovereignExposure: 0,
      exposedBankAssets: 0,
      treasuryBalance: budget?.treasuryBalance ?? 0,
    });
  }
  for (const bank of banks) {
    const row = byCountry.get(bank.countryId);
    const charter = bank.bankCharter;
    if (!row || !charter || charter.depositorsResolvedTurn !== undefined) continue;
    row.bankStress = Math.max(
      row.bankStress,
      charter.status === "failed" ? 100 : 100 * Math.max(0, 0.8 - (charter.confidence ?? 1))
    );
    let exposure = 0;
    let sovereignAssets = 0;
    for (const bond of bonds) {
      const ledgerUnits = bond.holders
        .filter((holder) => holder.corporationId?.equals(bank._id))
        .reduce((sum, holder) => sum + Math.max(0, holder.units), 0);
      // Only conserved holder-ledger units qualify. Legacy prop-book-only
      // positions have no issued security behind them and cannot trigger contagion.
      const rate = bond.currencyCode ? (rates.get(bond.currencyCode) ?? 1) : 1;
      const value = (ledgerUnits * bond.faceValue * Math.max(0, bond.marketPrice)) / rate;
      sovereignAssets += value;
      if (
        bond.countryId &&
        byCountry.get(bond.countryId)?.euroMember &&
        (byCountry.get(bond.countryId)?.sovereignStress ?? 0) > 0
      )
        exposure += value;
    }
    row.euroSovereignExposure += exposure;
    if (exposure > 0)
      row.exposedBankAssets += Math.max(
        exposure,
        (getCashReserves(charter) + Math.max(0, charter.totalLoans ?? 0)) /
          (rates.get(charter.currency) ?? 1) +
          Math.max(
            sovereignAssets,
            Math.max(0, charter.propBookMarkValue ?? 0) / (rates.get(charter.currency) ?? 1)
          )
      );
    if (bankEquity(charter) < 0) row.bankStress = Math.max(row.bankStress, 80);
  }
  const rows = [...byCountry.values()];
  return {
    rows,
    participants: financialCrisisParticipants(rows),
    euroExposure: euroFeedbackExposure(rows),
  };
}
