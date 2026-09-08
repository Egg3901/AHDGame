/** Projected per-turn observations for a sector investment balance experiment. */
import type { Db } from "mongodb";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Completed turns clear live telemetry; validate the durable turn log instead. */
export function assertInvestmentTurnComplete(
  turn: number,
  stateTurn: number | undefined,
  log: { turn: number; phaseStatuses?: Record<string, { status: string }> } | null
): void {
  const phases = Object.entries(log?.phaseStatuses ?? {});
  const failed = phases.filter(([, phase]) => !["completed", "skipped"].includes(phase.status));
  if (stateTurn !== turn || log?.turn !== turn || phases.length === 0 || failed.length > 0) {
    throw new Error(
      `Invalid balance turn ${turn}: ${failed.map(([name]) => name).join(", ") || "missing completed-turn evidence"}`
    );
  }
}

export async function snapshotSectorInvestment(db: Db, directory: string, turn: number) {
  const fields: Record<string, string> = {
    corporateSectors:
      "_id corporationId countryId stateId sectorType strategyId transitionFromStrategyId transitionStartTurn transitionCooldownUntilTurn retoolRescaleApplied otherOpexPerUnitAnchor otherOpexAnchorMarginBasis plantsStartTurn capitalStock operatingCapacityUnits operatingCapacityTurn capacityBookAnchor constructionInProgressAnchor buildQueue plantsPnl producedUnits soldUnits soldFraction throughputFactor deliveryLimitedFraction workers workersDesired labourStaffingFactor mothballed activeCapacityPercent revenue realizedRevenue plantsUpkeepMarginBasisAnchor",
    corporations:
      "_id countryId type ceoId ceoType ceoVacant countryOwnerId isNationalized liquidCapital liquidCurrencyCode marketingBudget logisticsBudget rdBudget ceoSalary",
    corporationHistory:
      "_id corporationId turn currencyCode fxRateAtWrite revenue totalCosts income incomePreDividends corporateTaxPaid perTurnBondCouponIncome perTurnBondInterestExpense perTurnBondDragOnNetIncome dividendPaidPerTurn dividendIncomeReceived federalTaxPaid stateTaxPaid taxPaidByCountry taxPaidByState marketCap liquidCapital shareEscrowBalance",
    exchangeRates: "_id countryId currencyCode rate",
    macroMetrics: "_id countryId economic population governance economicModel",
    federalBudget:
      "_id countryId currencyCode fiscalYear revenue spending debt treasuryBalance surplus gdp gdpSmoothed debtToGdpRatio creditRating taxRates taxBases economicFactors",
    bonds:
      "_id countryId corporationId issuerType defaulted matured faceValue couponRate maturityTurn totalIssued publicFloat marketPrice currencyCode",
    commodityPrices:
      "_id commodity turn basePrice globalPrice globalSupply globalDemand demandTruncatedUnits latentShortageMultiple scarcityMult nationalPrices nationalSupply nationalDemand",
    economicVitalSigns: "_id turn goods trade production firms competition securities",
  };
  const entries = await Promise.all(
    Object.entries(fields).map(async ([collection, keys]) => {
      const projection = Object.fromEntries(keys.split(" ").map((key) => [key, 1]));
      const filter =
        collection === "corporationHistory" || collection === "economicVitalSigns" ? { turn } : {};
      return [
        collection,
        await db.collection(collection).find(filter, { projection }).toArray(),
      ] as const;
    })
  );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(
    join(directory, `${turn}.json`),
    JSON.stringify({ turn, ...Object.fromEntries(entries) }),
    { mode: 0o600 }
  );
}
