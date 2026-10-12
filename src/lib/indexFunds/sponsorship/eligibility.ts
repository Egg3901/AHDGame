/** Fund creation eligibility is shared by the command and the bank's action menu. */
import { isIndexFundsEnabled } from "../featureFlag";
import type { Db } from "mongodb";
import type { Corporation, FederalBudget, GameConfig, GameState } from "@/lib/db/types";
import { fundSponsorEligibility } from "./rules/eligibility";
import { FUND_CHARTER_FEE_ANCHOR, FUND_MIN_SEED_CAPITAL_ANCHOR } from "./constants";
import { resolveCountryCurrencyCode } from "@/lib/currency/govBudgetFields";
import {
  getCorpFxRate,
  anchorToCorpLiquidCapital,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";

export async function fundCreationEligibility(
  db: Db,
  sponsor: Corporation,
  options?: { replay?: boolean }
): Promise<string | null> {
  if (sponsor.ceoVacant) return "Appoint a CEO before creating a fund.";
  const [sector, state, config, liveFunds] = await Promise.all([
    db
      .collection("corporateSectors")
      .findOne({ corporationId: sponsor._id, sectorType: "financial" }, { projection: { _id: 1 } }),
    db
      .collection<GameState>("gameState")
      .findOne({ _id: "current" }, { projection: { corporationActionsPaused: 1 } }),
    db
      .collection<GameConfig>("gameConfig")
      .findOne(
        { _id: "default" },
        { projection: { playerFundSponsorshipEnabled: 1, indexFundsMode: 1, indexFundsEnabled: 1 } }
      ),
    db
      .collection("indexFunds")
      .countDocuments({ sponsorCorporationId: sponsor._id, status: { $ne: "delisted" } }),
  ]);
  const reason = fundSponsorEligibility({
    hasFinancialSector: !!sector,
    bankCharter: sponsor.bankCharter,
  });
  if (reason) return reason;
  if (state?.corporationActionsPaused) return "Corporation actions are currently paused.";
  if (!(await isIndexFundsEnabled(config))) return "Investment funds are not enabled.";
  if (!sponsor.bankCharter && !config?.playerFundSponsorshipEnabled)
    return "Player-sponsored index funds are not available yet.";
  if (!options?.replay && sponsor.bankCharter && liveFunds >= 3)
    return "A bank can manage at most three live funds.";
  const rate = await getCorpFxRate(db, sponsor);
  const minimum =
    Math.round(anchorToCorpLiquidCapital(FUND_CHARTER_FEE_ANCHOR, sponsor, rate)) +
    anchorToCorpLiquidCapital(FUND_MIN_SEED_CAPITAL_ANCHOR, sponsor, rate);
  if (!Number.isFinite(rate) || rate <= 0 || (!options?.replay && sponsor.liquidCapital < minimum))
    return "The corporation needs enough cash for the creation fee and seed investment.";
  if (!options?.replay) {
    const budget = sponsor.countryId
      ? await db
          .collection<FederalBudget>("federalBudget")
          .findOne(
            { countryId: sponsor.countryId },
            { projection: { countryId: 1, currencyCode: 1 } }
          )
      : null;
    if (
      !budget ||
      resolveCountryCurrencyCode(budget) !== (resolveCorpLiquidCurrencyCode(sponsor) ?? "USD")
    )
      return "The fund creation fee cannot be settled in this currency.";
  }
  return null;
}
