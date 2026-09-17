import type { Corporation, CorporateSector } from "@/lib/db/types";
import { MAX_DIVIDEND_RATE, TURNS_PER_DAY } from "@/lib/constants/corporations";
import { getLegalStructureForCorp } from "@/lib/corporations/legalStructure";
import type { IncomeStatementResult } from "./incomeStatement";
import type { SectorFinancialTotals } from "./sectorRows";
import type { PortfolioHoldings } from "./portfolioHoldings";

export interface DividendMirror {
  corpDividendRateClamped: number;
  legalMinDividendPct: number;
  effectiveDividendRate: number;
  dividendDistribution: number;
}

/**
 * Turn-loop dividend payout mirror (sectorCalculations.ts dividend block).
 *
 * Effective rate is max(corp.dividendRate clamped, legalStructure floor x 100,
 * active parent dividend floor), and the pool is capped by income.
 */
export function computeDividendDistribution(
  corporation: Corporation,
  corpLegalStructure: ReturnType<typeof getLegalStructureForCorp>,
  activeFloorPct: number,
  income: number
): DividendMirror {
  const corpDividendRateClamped = Math.min(corporation.dividendRate ?? 0, MAX_DIVIDEND_RATE);
  const legalMinDividendPct = (corpLegalStructure.minimumDividendRate ?? 0) * 100;
  const effectiveDividendRate =
    income > 0 ? Math.max(corpDividendRateClamped, legalMinDividendPct, activeFloorPct) : 0;
  const dividendDistribution =
    effectiveDividendRate > 0 && income > 0
      ? Math.min(income * (effectiveDividendRate / 100), income)
      : 0;
  return {
    corpDividendRateClamped,
    legalMinDividendPct,
    effectiveDividendRate,
    dividendDistribution,
  };
}

export interface FinancialsInputs {
  corporation: Corporation;
  sectors: CorporateSector[];
  income: IncomeStatementResult;
  totals: SectorFinancialTotals;
  portfolio: Pick<
    PortfolioHoldings,
    | "latestCorpIncomeRow"
    | "dividendIncomeReceivedDaily"
    | "supplyAgreementSettlementDaily"
    | "supplyAgreementUnpaidAnchor"
  >;
  activeFloorPct: number;
  realizedGrowthRate: number | null;
}

/**
 * Financials statement assembly for the corporation detail view (#587).
 *
 * Maintenance is shown net of labour (the wage slice is broken out as
 * `laborCosts`). Under plants the residual CAN be negative: derived operating
 * cost already includes labour, and a negative other-opex residual is a real
 * credit that Gross Profit must keep.
 */
export function buildFinancials(inputs: FinancialsInputs) {
  const {
    corporation,
    sectors,
    income: inc,
    totals,
    portfolio,
    activeFloorPct,
    realizedGrowthRate,
  } = inputs;
  const { latestCorpIncomeRow } = portfolio;
  const dividend = computeDividendDistribution(
    corporation,
    inc.corpLegalStructure,
    activeFloorPct,
    inc.income
  );

  return {
    totalRevenue: Math.round(totals.totalRevenue),
    // Maintenance shown net of labour; the wage slice is broken out as `laborCosts`.
    // Under plants this residual CAN be negative: derived operating cost already
    // includes labour, and a negative other-opex residual is a real credit that
    // Gross Profit must keep (clamping it double-counts wages; ticket #1122 is
    // a display bug, not a sign error). The Cost of Revenue renderer formats a
    // credit without wrapping a minus inside parentheses.
    maintenanceCosts: Math.round(totals.totalMaintenanceCosts - totals.totalLaborCosts),
    laborCosts: Math.round(totals.totalLaborCosts),
    growthCosts: Math.round(totals.totalGrowthCosts),
    regulatoryBurden: Math.round(totals.totalRegulatoryBurden),
    marketingCosts: corporation.marketingBudget,
    logisticsCosts: inc.logisticsBudget,
    rdCosts: inc.rdBudget,
    ceoSalaryCost: inc.ceoSalary,
    pensionContributionCost: Math.round(inc.pensionContributionCost),
    pensionTopUpCost: Math.round(inc.pensionTopUpCost),
    pensionSchemesInDeficit: inc.pensionSchemesInDeficit,
    operatingCosts: Math.round(inc.operatingCosts),
    operatingIncome: Math.round(inc.operatingIncome),
    federalTax: inc.displayFederalTax,
    stateTax: inc.displayStateTax,
    federalTaxByCountry: inc.federalTaxByCountry,
    bondInterestCost: Math.round(inc.dailyInterestLocal),
    bondCouponIncome: Math.round(inc.dailyCouponIncomeLocal),
    dividendIncomeReceived: portfolio.dividendIncomeReceivedDaily,
    governmentBondSubsidy: Math.round(inc.governmentBondSubsidyLocal),
    imfFacilityPaymentDaily: Math.round(inc.imfFacilityPaymentDailyLocal),
    imfFacilityReceiptsDaily: Math.round(inc.imfFacilityReceiptsDailyLocal),
    supplyAgreementSettlementDaily: portfolio.supplyAgreementSettlementDaily,
    supplyAgreementUnpaidAnchor: portfolio.supplyAgreementUnpaidAnchor,
    totalCosts: Math.round(inc.totalCostsLocal),
    income: Math.round(inc.income),
    // A bank's cash is ring-fenced, so its realized earnings are reported as
    // a separate subsidiary line rather than silently mixed into the holding
    // company's spendable cash income.
    bankingIncome: Math.round(inc.bankIncomeLocalPerDay),
    ...(inc.bankingIncomeTurn != null ? { bankingIncomeTurn: inc.bankingIncomeTurn } : {}),
    economicIncomeIncludingBank: Math.round(inc.income + inc.bankIncomeLocalPerDay),
    // Ground-truth realized net income from the engine's last snapshot, converted
    // from per-turn to the daily display units the projected `income` uses. This
    // is what actually hit liquidCapital last turn — it reflects embargo/tariff/
    // clearing haircuts the projection above can't fully reproduce (ticket #935).
    ...(typeof latestCorpIncomeRow?.income === "number"
      ? {
          // Matches the Financials headline (operating + bond coupons −
          // bond interest + dividends received): history.income is
          // operating-only, so a bond/holding-portfolio corp's masthead went
          // deeply negative while the income statement was positive (#941).
          realizedIncome: Math.round(
            (latestCorpIncomeRow.income +
              (latestCorpIncomeRow.perTurnBondCouponIncome ?? 0) -
              (latestCorpIncomeRow.perTurnBondDragOnNetIncome ?? 0) +
              (latestCorpIncomeRow.dividendIncomeReceived ?? 0)) *
              TURNS_PER_DAY
          ),
          // Dividends the engine ACTUALLY paid out of that same turn's income,
          // in the same daily display units. `realizedIncome` above is already
          // net of this (sectorCalculations.ts: `income = afterTaxOperating −
          // hourlyDividendPayout`), so surfaces must NOT subtract
          // `dividendDistribution` — the projection-derived estimate — from it
          // again. Exposing the realized payout lets them reconstruct the
          // pre-dividend headline instead (ticket #1098).
          realizedDividendPaid: Math.round(
            Math.max(0, latestCorpIncomeRow.dividendPaidPerTurn ?? 0) * TURNS_PER_DAY
          ),
          ...(typeof latestCorpIncomeRow.turn === "number"
            ? { realizedIncomeTurn: latestCorpIncomeRow.turn }
            : {}),
        }
      : {}),
    dividendRate: corporation.dividendRate ?? 0,
    effectiveDividendRate: dividend.effectiveDividendRate,
    dividendDistribution: Math.round(dividend.dividendDistribution),
    // Realized revenue growth under plants; below plants (or with too little
    // history to annualize honestly) the legacy sector average still applies.
    currentGrowthRate:
      realizedGrowthRate ??
      (sectors.length > 0
        ? sectors.reduce((sum, s) => sum + (s.currentGrowthRate ?? s.growthRate ?? 0), 0) /
          sectors.length
        : 0),
    /** True when `currentGrowthRate` is measured realized revenue, not the legacy field. */
    growthRateIsRealized: realizedGrowthRate !== null,
    subsidyBenefit: Math.round(totals.totalSubsidyBenefit),
  };
}

export type FinancialsView = ReturnType<typeof buildFinancials>;
