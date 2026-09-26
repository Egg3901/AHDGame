import type { Db } from "mongodb";
import type { Corporation, FederalBudget } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { TurnReferenceData } from "@/lib/corporations/turnReferenceData";
import type { GameState } from "@/lib/db/types";
import type { SectorCurrencyRestatement } from "./currencyRestatement";
import type { SectorDetailsResult, SectorDetailRow } from "./sectorRows";
import type { PortfolioHoldings } from "./portfolioHoldings";
import {
  anchorToCorpCapital,
  fxRateForCorpFromMap,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import {
  employerPensionCostForTurn,
  EMPTY_EMPLOYER_PENSION_COST,
} from "@/lib/pensions/employerPensionCosts";
import { anchorPerTurnToFinancialDaily } from "@/lib/imf/imfFacilityFinancials";
import { getLegalStructureForCorp } from "@/lib/corporations/legalStructure";
import { loadBankingPolicy } from "@/lib/banking/policy";
import { savingsReadsAuthoritative } from "@/lib/banking/rules/policy";
import { bankBookEquity, bankNpvFromPerTurnIncome, bankValuation } from "@/lib/banking/valuation";
import { bankNpvBoostMultiplier } from "@/lib/corporations/rules/marketBoost";
import {
  TURNS_PER_DAY,
  MIN_SHARE_PRICE,
  NPV_ANNUAL_DISCOUNT_RATE,
} from "@/lib/constants/corporations";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { getRoundedPublicMarketCap } from "@/lib/corporations/marketQuote";
import { computeTechAssetValueAnchor } from "@/lib/corporations/techAssetValue";
import { calculateCorpStrengthProjection } from "@/lib/corporations/strengthProjection";

export interface SectorTaxLine {
  federalTaxPaid: number;
  stateTaxPaid: number;
  federalTaxRate: number;
  stateTaxRate: number;
}

export interface IncomeStatementInputs {
  db: Db;
  corporation: Corporation;
  currentTurn: number;
  totals: SectorDetailsResult["totals"];
  wageBillAnchorPerTurnBySectorId: Map<string, number>;
  labourWagesEnabled: boolean;
  restatement: SectorCurrencyRestatement;
  fxByCurrency: Map<CurrencyCode, number>;
  federalBudgets: FederalBudget[];
  stateBudgetsForTax: TurnReferenceData["stateBudgetsForTax"];
  sectorDetails: SectorDetailRow[];
  portfolio: PortfolioHoldings;
  bankingPolicyPromise: Promise<Awaited<ReturnType<typeof loadBankingPolicy>> | null>;
  gameState: GameState | null;
}

export interface IncomeStatementResult {
  ceoSalary: number;
  logisticsBudget: number;
  rdBudget: number;
  pensionContributionCost: number;
  pensionTopUpCost: number;
  pensionSchemesInDeficit: number;
  operatingCosts: number;
  operatingIncome: number;
  displayFederalTax: number;
  displayStateTax: number;
  federalTaxByCountry: Record<string, number>;
  perSectorTax: Map<string, SectorTaxLine>;
  corporateTax: number;
  corpTaxMultiplier: number;
  corpLegalStructure: ReturnType<typeof getLegalStructureForCorp>;
  corpCurrency: CurrencyCode | undefined;
  corpFxRate: number;
  bankIncomeLocalPerDay: number;
  bankingIncomeTurn: number | undefined;
  dailyInterestLocal: number;
  dailyCouponIncomeLocal: number;
  totalDebtLocal: number;
  totalCostsLocal: number;
  governmentBondSubsidyLocal: number;
  imfFacilityPaymentDailyLocal: number;
  imfFacilityReceiptsDailyLocal: number;
  income: number;
  currentLogisticsStrength: number;
  currentRdScore: number;
  marketingStrengthGrowth: number;
  logisticsStrengthNetChange: number;
  rdScoreNetChange: number;
  totalShares: number;
  marketCapitalization: number;
  currentSharePrice: number;
  balanceSheet: {
    assets: {
      cashOnHand: number;
      sectorNPVs: {
        sectorId: SectorDetailRow["_id"];
        stateId: string;
        stateName: string;
        sectorType: string;
        dailyProfit: number;
        effectiveProfitMargin: number;
        fillAdjustedMarginPct: number | null;
        npv: number;
      }[];
      totalSectorNPV: number;
      totalOperatingNPV: number;
      bankEquity?: number;
      bankValuation?: number;
      bankNPV?: number;
      bondHoldingsValue: number;
      stockHoldingsValue: number;
      imfFacilityReceivablesValue: number;
      imfFacilityReceivables: {
        borrowerCorporationId: string;
        borrowerName: string;
        sequentialId: number | undefined;
        principalOutstanding: number;
      }[];
      totalPortfolioValue: number;
      heldBonds: PortfolioHoldings["heldBondsSummary"];
      techAssetValue: number;
      totalAssets: number;
    };
    liabilities: {
      dailyCosts: number;
      totalDebt: number;
      dailyInterestCost: number;
      bondCount: number;
    };
    equity: {
      totalEquity: number;
      bookValue: number;
      marketCapitalization: number;
    };
  };
}

/**
 * Income statement, corp taxes, bank charter, and balance sheet (#587).
 *
 * Occupational pensions name the two cash legs the pension pass debits twice
 * a turn: the bargained contribution (a price the CEO agreed) and the deficit
 * top-up (a consequence the CEO did not). Both only ever showed up in the
 * financial transaction log, which no player surface reads.
 */
export async function computeIncomeStatement(
  inputs: IncomeStatementInputs
): Promise<IncomeStatementResult> {
  const {
    db,
    corporation,
    currentTurn,
    totals,
    wageBillAnchorPerTurnBySectorId,
    labourWagesEnabled,
    restatement,
    fxByCurrency,
    federalBudgets,
    stateBudgetsForTax,
    sectorDetails,
    portfolio,
    bankingPolicyPromise,
    gameState,
  } = inputs;
  const { totalRevenue, totalMaintenanceCosts, totalGrowthCosts, totalRegulatoryBurden } = totals;
  const { corpCurrency: pageCorpCcy, corpRate: pageCorpRate } = restatement;
  const {
    outstandingBonds,
    heldBondsSummary,
    totalBondHoldingsValue,
    dailyCouponIncome,
    totalStockHoldingsValue,
    imfReceivableRows,
    imfReceivablesPrincipal,
    dividendIncomeReceivedDaily,
    imfFacilityPaymentDaily,
    imfFacilityReceiptsDaily,
    totalDebtAnchor,
    dailyInterestAnchor,
  } = portfolio;

  const ceoSalary = corporation.ceoSalary ?? 0;
  const logisticsBudget = corporation.logisticsBudget ?? 0;
  const rdBudget = corporation.rdBudget ?? 0;

  // Occupational pensions. The pension pass debits liquidCapital twice a turn
  // under a collective agreement and both legs only ever showed up in the
  // financial transaction log, which no player surface reads, so a CEO watched
  // cash fall with nothing on the statement to name it. Two lines, not one: the
  // bargained contribution is a price the CEO agreed, the deficit top-up is a
  // consequence the CEO did not.
  const pensionCostPerTurn = labourWagesEnabled
    ? await employerPensionCostForTurn(
        db,
        corporation._id,
        currentTurn,
        wageBillAnchorPerTurnBySectorId
      )
    : EMPTY_EMPLOYER_PENSION_COST;
  const pensionContributionCost = anchorToCorpCapital(
    anchorPerTurnToFinancialDaily(pensionCostPerTurn.contributionAnchorPerTurn),
    pageCorpCcy,
    pageCorpRate
  );
  const pensionTopUpCost = anchorToCorpCapital(
    anchorPerTurnToFinancialDaily(pensionCostPerTurn.topUpAnchorPerTurn),
    pageCorpCcy,
    pageCorpRate
  );

  const operatingCosts =
    totalMaintenanceCosts +
    totalGrowthCosts +
    totalRegulatoryBurden +
    corporation.marketingBudget +
    logisticsBudget +
    rdBudget +
    ceoSalary +
    pensionContributionCost +
    pensionTopUpCost;
  const operatingIncome = totalRevenue - operatingCosts;

  const domesticFederalRateByCountry = new Map<string, number>();
  const foreignFederalRateByCountry = new Map<string, number>();
  for (const fb of federalBudgets) {
    if (!fb.countryId) continue;
    const dom = fb.taxRates?.domesticCorporateTax;
    if (typeof dom === "number") domesticFederalRateByCountry.set(fb.countryId, dom);
    const fgn = fb.taxRates?.foreignCorporateTax;
    if (typeof fgn === "number") foreignFederalRateByCountry.set(fb.countryId, fgn);
  }
  const domesticStateRateByStateId = new Map<string, number>();
  const foreignStateRateByStateId = new Map<string, number>();
  for (const sb of stateBudgetsForTax) {
    const dom = sb.taxRates?.domesticCorporateTax;
    if (typeof dom === "number") domesticStateRateByStateId.set(sb._id, dom);
    const fgn = sb.taxRates?.foreignCorporateTax;
    if (typeof fgn === "number") foreignStateRateByStateId.set(sb._id, fgn);
  }

  const sectorOperatingTotal = sectorDetails.reduce((sum, s) => sum + (s.profit ?? 0), 0);
  const corpLevelCosts = sectorOperatingTotal - operatingIncome;
  const sectorRevenueTotal = sectorDetails.reduce(
    (sum, s) => sum + (s.financialRevenue ?? s.revenue ?? 0),
    0
  );
  const corpLegalStructure = getLegalStructureForCorp(corporation);
  const corpTaxMultiplier =
    corpLegalStructure.taxTreatment === "pass_through"
      ? 0
      : corpLegalStructure.taxTreatment === "preferential"
        ? (corpLegalStructure.taxMultiplier ?? 1)
        : 1;

  let displayFederalTax = 0;
  let displayStateTax = 0;
  const federalTaxByCountry: Record<string, number> = {};
  const perSectorTax = new Map<string, SectorTaxLine>();
  for (const sd of sectorDetails) {
    const revenueShare =
      sectorRevenueTotal > 0 ? (sd.financialRevenue ?? sd.revenue ?? 0) / sectorRevenueTotal : 0;
    const sectorNetIncome = (sd.profit ?? 0) - corpLevelCosts * revenueShare;
    const sectorTaxable = Math.max(0, sectorNetIncome);
    const sectorCountry = sd.countryId ?? corporation.countryId;
    const isDomestic = corporation.countryId === sectorCountry;
    const federalRate =
      corpTaxMultiplier *
      (isDomestic
        ? (domesticFederalRateByCountry.get(sectorCountry) ?? 0)
        : (foreignFederalRateByCountry.get(sectorCountry) ?? 0));
    const stateRate =
      corpTaxMultiplier *
      (isDomestic
        ? (domesticStateRateByStateId.get(sd.stateId) ?? 0)
        : (foreignStateRateByStateId.get(sd.stateId) ?? 0));
    const fedTax = Math.round(sectorTaxable * (federalRate / 100));
    const stTax = Math.round(sectorTaxable * (stateRate / 100));
    displayFederalTax += fedTax;
    displayStateTax += stTax;
    federalTaxByCountry[sectorCountry] = (federalTaxByCountry[sectorCountry] ?? 0) + fedTax;
    perSectorTax.set(sd._id.toString(), {
      federalTaxPaid: fedTax,
      stateTaxPaid: stTax,
      federalTaxRate: federalRate,
      stateTaxRate: stateRate,
    });
  }

  const corpCurrency = resolveCorpLiquidCurrencyCode(corporation);
  const corpFxRate = fxRateForCorpFromMap(corporation, fxByCurrency);
  const bankingPolicy = await bankingPolicyPromise;
  const activeBankCharter =
    corporation.bankCharter?.status === "active" ? corporation.bankCharter : null;
  const bankCurrency = activeBankCharter?.currency as CurrencyCode | undefined;
  const bankSheetOptions =
    activeBankCharter && bankingPolicy && bankCurrency
      ? {
          playerDepositsAreLiabilities: savingsReadsAuthoritative(bankingPolicy, bankCurrency),
        }
      : {};
  const bankFxRate = bankCurrency ? (fxByCurrency.get(bankCurrency) ?? 1) : 1;
  const bankBookEquityAnchor = activeBankCharter
    ? bankBookEquity(activeBankCharter, bankSheetOptions) / bankFxRate
    : 0;
  const bankValuationAnchor = activeBankCharter
    ? bankValuation(activeBankCharter, bankSheetOptions) / bankFxRate
    : 0;
  const bankIncomePerTurnAnchor = activeBankCharter
    ? (activeBankCharter.lastBankingIncome ?? 0) / bankFxRate
    : 0;
  const bankIncomeLocalPerDay = anchorToCorpCapital(
    bankIncomePerTurnAnchor * TURNS_PER_DAY,
    corpCurrency,
    corpFxRate
  );
  // Same phased bank-NPV boost as the share-price path so the corp page
  // agrees with the market quote. Below the window the multiplier is 1.
  const bankNpvLocal = anchorToCorpCapital(
    bankNpvFromPerTurnIncome(bankIncomePerTurnAnchor, bankNpvBoostMultiplier(currentTurn)),
    corpCurrency,
    corpFxRate
  );
  const bankBookEquityLocal = anchorToCorpCapital(bankBookEquityAnchor, corpCurrency, corpFxRate);
  const bankValuationLocal = anchorToCorpCapital(bankValuationAnchor, corpCurrency, corpFxRate);
  const dailyInterestLocal = anchorToCorpCapital(dailyInterestAnchor, corpCurrency, corpFxRate);
  const dailyCouponIncomeLocal = anchorToCorpCapital(dailyCouponIncome, corpCurrency, corpFxRate);

  const corpHomeCountryFedRate = domesticFederalRateByCountry.get(corporation.countryId) ?? 0;
  const bondCouponFedTaxLocal = Math.round(
    Math.max(0, dailyCouponIncomeLocal) * corpTaxMultiplier * (corpHomeCountryFedRate / 100)
  );
  if (bondCouponFedTaxLocal > 0) {
    displayFederalTax += bondCouponFedTaxLocal;
    federalTaxByCountry[corporation.countryId] =
      (federalTaxByCountry[corporation.countryId] ?? 0) + bondCouponFedTaxLocal;
  }
  const corporateTax = displayFederalTax + displayStateTax;
  const imfFacilityPaymentDailyLocal = anchorToCorpCapital(
    imfFacilityPaymentDaily,
    corpCurrency,
    corpFxRate
  );
  const imfFacilityReceiptsDailyLocal = anchorToCorpCapital(
    imfFacilityReceiptsDaily,
    corpCurrency,
    corpFxRate
  );
  const totalDebtLocal = anchorToCorpCapital(totalDebtAnchor, corpCurrency, corpFxRate);
  const totalCostsLocal = operatingCosts + dailyInterestLocal;
  const isNatcorp = !!corporation.countryOwnerId;
  const governmentBondSubsidyLocal = isNatcorp ? dailyInterestLocal : 0;
  const income =
    operatingIncome -
    corporateTax +
    dailyCouponIncomeLocal -
    dailyInterestLocal +
    governmentBondSubsidyLocal -
    imfFacilityPaymentDailyLocal +
    imfFacilityReceiptsDailyLocal +
    dividendIncomeReceivedDaily;

  const currentLogisticsStrength = corporation.logisticsStrength ?? 0;
  const currentRdScore = corporation.rdScore ?? 0;
  const { marketingStrengthGrowth, logisticsStrengthNetChange, rdScoreNetChange } =
    calculateCorpStrengthProjection(
      {
        marketingBudget: corporation.marketingBudget,
        marketingStrength: corporation.marketingStrength ?? 0,
        logisticsBudget,
        logisticsStrength: currentLogisticsStrength,
        rdBudget: corporation.rdBudget ?? 0,
        rdScore: currentRdScore,
        liquidCurrencyCode: corpCurrency,
      },
      corpFxRate
    );

  const totalShares = corporation.totalShares ?? 10_000_000;
  const marketCapitalization = getRoundedPublicMarketCap(corporation, totalShares);
  const GAME_DAYS_PER_YEAR = TURNS_PER_YEAR / TURNS_PER_DAY;
  const sectorNPVs = sectorDetails.map((sector) => {
    const yearlyProfit = sector.profit * GAME_DAYS_PER_YEAR;
    const npv = yearlyProfit > 0 ? Math.round(yearlyProfit / NPV_ANNUAL_DISCOUNT_RATE) : 0;
    return {
      sectorId: sector._id,
      stateId: sector.stateId,
      stateName: sector.stateName,
      sectorType: sector.sectorType,
      dailyProfit: sector.profit,
      effectiveProfitMargin: sector.effectiveProfitMargin,
      fillAdjustedMarginPct: sector.fillAdjustedMarginPct ?? null,
      npv,
    };
  });
  const totalSectorNPV = sectorNPVs.reduce((sum, s) => sum + s.npv, 0);
  const totalOperatingNPV = totalSectorNPV + bankNpvLocal;
  const currentSharePrice = Math.round((corporation.sharePrice ?? MIN_SHARE_PRICE) * 100) / 100;
  const totalPortfolioAnchor =
    totalStockHoldingsValue + totalBondHoldingsValue + imfReceivablesPrincipal;
  const totalPortfolioValue = anchorToCorpCapital(totalPortfolioAnchor, corpCurrency, corpFxRate);
  const techAssetValueLocal = anchorToCorpCapital(
    computeTechAssetValueAnchor(corporation, gameState?.currentYear),
    corpCurrency,
    corpFxRate
  );
  const totalAssets =
    corporation.liquidCapital +
    totalOperatingNPV +
    bankValuationLocal +
    totalPortfolioValue +
    techAssetValueLocal;
  const bookValue = totalAssets - totalDebtLocal;
  const bondHoldingsValueLocal = anchorToCorpCapital(
    totalBondHoldingsValue,
    corpCurrency,
    corpFxRate
  );
  const stockHoldingsValueLocal = anchorToCorpCapital(
    totalStockHoldingsValue,
    corpCurrency,
    corpFxRate
  );
  const imfReceivablesPrincipalLocal = anchorToCorpCapital(
    imfReceivablesPrincipal,
    corpCurrency,
    corpFxRate
  );

  const balanceSheet: IncomeStatementResult["balanceSheet"] = {
    assets: {
      cashOnHand: Math.round(corporation.liquidCapital),
      sectorNPVs,
      totalSectorNPV,
      totalOperatingNPV: Math.round(totalOperatingNPV),
      ...(activeBankCharter
        ? {
            bankEquity: Math.round(bankBookEquityLocal),
            bankValuation: Math.round(bankValuationLocal),
            bankNPV: Math.round(bankNpvLocal),
          }
        : {}),
      bondHoldingsValue: Math.round(bondHoldingsValueLocal),
      stockHoldingsValue: Math.round(stockHoldingsValueLocal),
      imfFacilityReceivablesValue: Math.round(imfReceivablesPrincipalLocal),
      imfFacilityReceivables: imfReceivableRows.map((r) => ({
        borrowerCorporationId: r.borrowerCorporationId,
        borrowerName: r.borrowerName,
        sequentialId: r.sequentialId,
        principalOutstanding: Math.round(
          anchorToCorpCapital(r.principalOutstanding, corpCurrency, corpFxRate)
        ),
      })),
      totalPortfolioValue: Math.round(totalPortfolioValue),
      heldBonds: heldBondsSummary,
      techAssetValue: Math.round(techAssetValueLocal),
      totalAssets: Math.round(totalAssets),
    },
    liabilities: {
      dailyCosts: Math.round(operatingCosts),
      totalDebt: Math.round(totalDebtLocal),
      dailyInterestCost: Math.round(dailyInterestLocal),
      bondCount: outstandingBonds.length,
    },
    equity: {
      totalEquity:
        corporation.liquidCapital +
        totalSectorNPV +
        Math.round(totalPortfolioValue) +
        Math.round(techAssetValueLocal) -
        (corporation.countryOwnerId ? 0 : Math.round(totalDebtLocal)),
      bookValue: Math.round(bookValue),
      marketCapitalization: Math.round(marketCapitalization),
    },
  };

  return {
    ceoSalary,
    logisticsBudget,
    rdBudget,
    pensionContributionCost,
    pensionTopUpCost,
    pensionSchemesInDeficit: pensionCostPerTurn.schemesInDeficit,
    operatingCosts,
    operatingIncome,
    displayFederalTax,
    displayStateTax,
    federalTaxByCountry,
    perSectorTax,
    corporateTax,
    corpTaxMultiplier,
    corpLegalStructure,
    corpCurrency,
    corpFxRate,
    bankIncomeLocalPerDay,
    bankingIncomeTurn: activeBankCharter?.lastBankingIncomeTurn ?? undefined,
    dailyInterestLocal,
    dailyCouponIncomeLocal,
    totalDebtLocal,
    totalCostsLocal,
    governmentBondSubsidyLocal,
    imfFacilityPaymentDailyLocal,
    imfFacilityReceiptsDailyLocal,
    income,
    currentLogisticsStrength,
    currentRdScore,
    marketingStrengthGrowth,
    logisticsStrengthNetChange,
    rdScoreNetChange,
    totalShares,
    marketCapitalization,
    currentSharePrice,
    balanceSheet,
  };
}
