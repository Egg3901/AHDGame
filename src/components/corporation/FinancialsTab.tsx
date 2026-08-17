"use client";

import { useState } from "react";
import Link from "next/link";
import { InfoTooltip } from "@/components/InfoTooltip";

import { useCurrency } from "@/contexts/CurrencyContext";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { FinRowTip } from "./CorporationHelpers";
import type {
  CorporationDetail,
  Financials,
  BalanceSheet,
  BondInfo,
  SectorDetail,
  FinancialFogMeta,
} from "./CorporationPageTypes";
import { TariffRestrictions } from "./TariffRestrictions";
import { SubsidyBenefits } from "./SubsidyBenefits";
import { SubsidiariesOverviewCard } from "./SubsidiariesOverviewCard";
import { GroupOverviewCard } from "./GroupOverviewCard";
import { formatAccountingCost, formatMarketingStrength } from "@/lib/utils/formatters";
import { SummaryBand } from "./financials/SummaryBand";
import { GlanceRail } from "./financials/GlanceRail";
import { Waterfall } from "./financials/FinancialsVisuals";
import { buildAllocation } from "./financials/financialsModel";
import {
  MONEY_PERIOD_FACTOR,
  MONEY_PERIOD_PER_LABEL,
  scaleMoney,
  type MoneyPeriod,
} from "@/lib/constants/moneyTimescale";

interface FinancialsTabProps {
  corporation: CorporationDetail;
  financials: Financials;
  balanceSheet: BalanceSheet | null;
  bondInfo: BondInfo | null;
  corpId: string;
  periodView: MoneyPeriod;
  onPeriodViewChange: (v: MoneyPeriod) => void;
  sectors: SectorDetail[];
  financialFogOfWar?: FinancialFogMeta | null;
}

export default function FinancialsTab({
  corporation,
  financials,
  balanceSheet,
  bondInfo,
  corpId,
  periodView,
  onPeriodViewChange,
  sectors,
  financialFogOfWar,
}: FinancialsTabProps) {
  const { formatAmount, formatPrice, formatFull, toInternalFrom } = useCurrency();
  // Post-v0.2.6: financials.* + balanceSheet.* fields (revenue, costs, NPVs,
  // portfolio values, bond principals) are stored in the corp's liquidCurrencyCode.
  // Normalize to ₳ and pass the code so wallet-preference display ("internal" ↔
  // "local" ↔ pinned) still governs. Pre-forex corps fall through unchanged.
  const liquidCode = (corporation.liquidCurrencyCode as CurrencyCode | undefined) ?? undefined;
  const fmt = (val: number) => {
    const anchor = liquidCode ? toInternalFrom(val, liquidCode) : val;
    return formatAmount(anchor, liquidCode);
  };
  const fmtCorpCash = (val: number) => {
    const code = (corporation.liquidCurrencyCode ?? "USD") as CurrencyCode;
    return formatFull(toInternalFrom(val, code), code);
  };
  // Accounting-style negatives: losses render as ($X) rather than -$X for
  // consistency with cost rows. Used for the income-statement subtotals.
  const fmtSigned = (val: number) => (val < 0 ? `(${fmt(Math.abs(val))})` : fmt(val));
  const fmtCost = (val: number) => formatAccountingCost(val, fmt);

  const [financialView, setFinancialView] = useState<"income_statement" | "balance_sheet">(
    "income_statement"
  );
  const alloc = buildAllocation(financials, periodView);
  const [sectorNpvExpanded, setSectorNpvExpanded] = useState(true);
  const [sectorNpvPage, setSectorNpvPage] = useState(0);
  const SECTORS_PER_PAGE = 10;

  const qLabel =
    financialFogOfWar?.fogSourceTurn != null
      ? `Last Q${financialFogOfWar.fogSourceTurn}`
      : "Last Report";

  const fogSummaryPanel = financialFogOfWar ? (
    <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-yellow-500/20">
        <div className="flex items-center gap-2">
          <span className="text-yellow-400">&#9888;</span>
          <span className="text-xs font-semibold text-yellow-300">
            {financialFogOfWar.fogSourceTurn != null
              ? `Based on the Q${financialFogOfWar.fogSourceTurn} report. Current figures are estimates, accurate to within ${Math.round((financialFogOfWar.maxDeviation ?? 0.1) * 100)}%`
              : "No quarterly report on record, so these figures are estimates"}
          </span>
        </div>
        <span className="text-[10px] text-yellow-200/60">
          CEO and parent-corp officers see live data
        </span>
      </div>
      <div className="px-4 py-3">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] text-muted uppercase tracking-wider">
              <th className="text-left font-medium pb-2 w-1/3" />
              <th className="text-right font-medium pb-2">{qLabel}</th>
              <th className="text-right font-medium pb-2 text-yellow-300">Est. Current</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-yellow-500/10">
              <td className="text-muted py-1.5">Revenue</td>
              <td className="text-right text-foreground tabular-nums py-1.5">
                {financialFogOfWar.lastQuarterly.revenue != null
                  ? fmt(scaleMoney(financialFogOfWar.lastQuarterly.revenue, periodView))
                  : "—"}
              </td>
              <td className="text-right text-yellow-200 tabular-nums py-1.5">
                ~{fmt(scaleMoney(financials.totalRevenue, periodView))}
              </td>
            </tr>
            <tr className="border-t border-yellow-500/10">
              <td className="text-muted py-1.5">Total Costs</td>
              <td className="text-right text-foreground tabular-nums py-1.5">
                {financialFogOfWar.lastQuarterly.totalCosts != null
                  ? `(${fmt(scaleMoney(financialFogOfWar.lastQuarterly.totalCosts, periodView))})`
                  : "—"}
              </td>
              <td className="text-right text-yellow-200 tabular-nums py-1.5">
                (~
                {fmt(scaleMoney(financials.totalCosts, periodView))})
              </td>
            </tr>
            <tr className="border-t border-yellow-500/10">
              <td className="text-muted py-1.5 font-semibold">Net Income</td>
              <td
                className={`text-right tabular-nums py-1.5 font-semibold ${
                  financialFogOfWar.lastQuarterly.income != null
                    ? financialFogOfWar.lastQuarterly.income >= 0
                      ? "text-success"
                      : "text-error"
                    : "text-muted"
                }`}
              >
                {financialFogOfWar.lastQuarterly.income != null
                  ? fmt(scaleMoney(financialFogOfWar.lastQuarterly.income, periodView))
                  : "—"}
              </td>
              <td className="text-right text-yellow-200 tabular-nums py-1.5 font-semibold">
                ~{fmt(scaleMoney(financials.income, periodView))}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  ) : null;

  return (
    <div className="space-y-4">
      {fogSummaryPanel}
      {corporation.subsidiaries && corporation.subsidiaries.length > 0 && (
        <SubsidiariesOverviewCard subsidiaries={corporation.subsidiaries} />
      )}
      <GroupOverviewCard corpId={corpId} />
      <SummaryBand
        corporation={corporation}
        financials={financials}
        balanceSheet={balanceSheet}
        view={financialView}
        onViewChange={setFinancialView}
        periodView={periodView}
        onPeriodViewChange={onPeriodViewChange}
        fmt={fmt}
        formatPrice={(v) => formatPrice(v, liquidCode)}
        liquidToInternal={(v) => (liquidCode ? toInternalFrom(v, liquidCode) : v)}
        fogSourceTurn={financialFogOfWar?.fogSourceTurn ?? null}
      />

      {financialView === "income_statement" && (
        <div className="rounded-xl border border-card-border bg-card p-4">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted">
            Income waterfall
          </div>
          <Waterfall
            revenue={alloc.revenue}
            segments={alloc.segments}
            netIncome={alloc.netIncome}
            netPct={alloc.netPct}
            format={fmt}
          />
        </div>
      )}

      {financialView === "income_statement" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="rounded-xl border border-card-border bg-card overflow-hidden">
            <div className="px-6 py-4 space-y-1">
              {/* Revenue Section */}
              <div className="text-[11px] font-semibold text-muted uppercase tracking-wider pt-1 pb-2">
                Revenue
              </div>
              <FinRowTip
                label="Gross Revenue"
                value={fmt(scaleMoney(financials.totalRevenue, periodView))}
                valueClass="text-foreground"
                tooltip="Total gross revenue from all owned sectors. Per-turn view shows one turn of income; annual view projects 48 turns (1 game year)."
              />
              <FinRowTip
                label="Average Growth Rate"
                value={`${(financials.currentGrowthRate ?? 0).toFixed(2)}%`}
                valueClass="text-muted"
                indent
                tooltip="Average growth rate across all sectors. Higher growth means revenue increases faster each turn, but costs more to maintain."
              />

              {/* Cost of Revenue */}
              <div className="border-t border-card-border mt-3" />
              <div className="text-[11px] font-semibold text-muted uppercase tracking-wider pt-3 pb-2">
                Cost of Revenue
              </div>
              <FinRowTip
                label="Sector Maintenance"
                value={fmtCost(scaleMoney(financials.maintenanceCosts, periodView))}
                valueClass={financials.maintenanceCosts < 0 ? "text-success" : "text-error"}
                indent
                tooltip={
                  financials.maintenanceCosts < 0
                    ? "A credit: wages currently exceed the derived operating bill (inputs, residual upkeep). Gross Profit already nets this against Wages so the two lines together match the engine."
                    : financials.laborCosts > 0
                      ? "Non-labour operating costs to keep sectors running (upkeep, inputs, overhead). Labour is broken out as Wages below."
                      : "Operating costs to keep sectors running. Equals revenue × (1 - profit margin). Lower profit margins mean higher maintenance."
                }
              />
              {financials.laborCosts > 0 && (
                <FinRowTip
                  label="Wages"
                  value={fmtCost(scaleMoney(financials.laborCosts, periodView))}
                  valueClass="text-error"
                  indent
                  tooltip="What you pay workers across all sectors. It moves with how many people you employ, local pay levels, and union pay demands. It is split out of Sector Maintenance, and the two together are your total running cost."
                />
              )}
              {financials.subsidyBenefit > 0 && (
                <FinRowTip
                  label="Subsidy Benefit"
                  value={fmt(scaleMoney(financials.subsidyBenefit, periodView))}
                  valueClass="text-success"
                  indent
                  tooltip="Margin bonus from active government subsidies. Each qualifying subsidy adds +7.5% profit margin, reducing effective maintenance costs."
                />
              )}
              <FinRowTip
                label="Growth Investment"
                value={fmtCost(scaleMoney(financials.growthCosts, periodView))}
                valueClass="text-error"
                indent
                tooltip="Cost of growing sector revenue. Scales with both revenue size and growth rate. Set to 0% growth to eliminate this cost."
              />

              {/* Gross Profit */}
              <div className="border-t border-card-border mt-3 pt-2">
                <FinRowTip
                  label="Gross Profit"
                  value={fmtSigned(
                    scaleMoney(
                      financials.totalRevenue -
                        financials.maintenanceCosts -
                        financials.laborCosts -
                        financials.growthCosts,
                      periodView
                    )
                  )}
                  valueClass={
                    financials.totalRevenue -
                      financials.maintenanceCosts -
                      financials.laborCosts -
                      financials.growthCosts >=
                    0
                      ? "text-foreground"
                      : "text-error"
                  }
                  bold
                  tooltip="Revenue minus sector maintenance, wages, and growth costs. Represents profit from core operations before overhead."
                />
              </div>

              {/* Operating Expenses */}
              <div className="border-t border-card-border mt-3" />
              <div className="text-[11px] font-semibold text-muted uppercase tracking-wider pt-3 pb-2">
                Operating Expenses
              </div>
              <FinRowTip
                label="Marketing"
                value={`(${fmt(scaleMoney(financials.marketingCosts, periodView))})`}
                valueClass="text-error"
                indent
                tooltip="Marketing spend. Builds marketing strength over time, used when taking capacity off rival plants."
              />
              {financials.logisticsCosts > 0 && (
                <FinRowTip
                  label="Logistics & Operations Investment"
                  value={`(${fmt(scaleMoney(financials.logisticsCosts, periodView))})`}
                  valueClass="text-error"
                  indent
                  tooltip="Investment in logistics infrastructure. Reduces the margin penalty from operational sprawl when managing many sectors."
                />
              )}
              {financials.regulatoryBurden > 0 && (
                <FinRowTip
                  label="Regulatory Compliance"
                  value={`(${fmt(scaleMoney(financials.regulatoryBurden, periodView))})`}
                  valueClass="text-error"
                  indent
                  tooltip="Cost of meeting the regulations in force where this company operates. It is charged against income every turn, and moves when governments change the rules for your sectors."
                />
              )}
              {financials.pensionContributionCost > 0 && (
                <FinRowTip
                  label="Pension Contributions"
                  value={`(${fmt(scaleMoney(financials.pensionContributionCost, periodView))})`}
                  valueClass="text-error"
                  indent
                  tooltip="Employer contributions to the union pension schemes covering this company's workers, at the rate set in the collective agreement. Charged on the covered wage bill every turn."
                />
              )}
              {financials.pensionTopUpCost > 0 && (
                <FinRowTip
                  label="Pension Deficit Top-Up"
                  value={`(${fmt(scaleMoney(financials.pensionTopUpCost, periodView))})`}
                  valueClass="text-error"
                  indent
                  tooltip={`Charged on top of the agreed contribution because ${
                    financials.pensionSchemesInDeficit === 1
                      ? "a covered scheme holds"
                      : `${financials.pensionSchemesInDeficit} covered schemes hold`
                  } less than promised. It is a share of the shortfall, so it falls as the scheme recovers and rises if the scheme's investments fall. Bargaining the contribution rate up is what closes it.`}
                />
              )}
              {financials.ceoSalaryCost > 0 && (
                <FinRowTip
                  label="CEO Compensation"
                  value={`(${fmt(scaleMoney(financials.ceoSalaryCost, periodView))})`}
                  valueClass="text-error"
                  indent
                  tooltip="Salary paid from corporate capital to the CEO's personal cash on hand. Set from the CEO Office tab."
                />
              )}

              {/* Operating Income (EBIT) */}
              <div className="border-t border-card-border mt-3 pt-2">
                <FinRowTip
                  label="Operating Income (EBIT)"
                  value={fmtSigned(scaleMoney(financials.operatingIncome, periodView))}
                  valueClass={financials.operatingIncome >= 0 ? "text-foreground" : "text-error"}
                  bold
                  tooltip="Earnings Before Interest and Tax. Revenue minus all operating costs (maintenance, growth, marketing, logistics, pensions, CEO salary)."
                />
              </div>

              {/* Corporate Tax — territorial, split by federal and state/regional */}
              {(financials.federalTax > 0 || financials.stateTax > 0) && (
                <>
                  <div className="border-t border-card-border mt-3" />
                  <div className="text-[11px] font-semibold text-muted uppercase tracking-wider pt-3 pb-2">
                    Taxes
                  </div>
                  {financials.federalTax > 0 && (
                    <FinRowTip
                      label="Federal Tax"
                      value={`(${fmt(scaleMoney(financials.federalTax, periodView))})`}
                      valueClass="text-error"
                      indent
                      tooltip={(() => {
                        const entries = Object.entries(financials.federalTaxByCountry ?? {}).filter(
                          ([, amt]) => amt > 0
                        );
                        if (entries.length === 0) {
                          return "Federal corporate income tax on this corporation's profitable sectors.";
                        }
                        // federalTaxByCountry values are in the same daily unit as financials.federalTax.
                        // Scale to match the currently selected period so the tooltip agrees with the row value.
                        const scale = MONEY_PERIOD_FACTOR[periodView];
                        const periodLabel = MONEY_PERIOD_PER_LABEL[periodView];
                        const lines = entries
                          .sort((a, b) => b[1] - a[1])
                          .map(([country, amt]) => `${country}: ${fmt(amt * scale)}`)
                          .join(" • ");
                        return `Federal tax by country (${periodLabel}): ${lines}. Each sector is taxed at its country's federal rate on its revenue-weighted share of corporate income.`;
                      })()}
                    />
                  )}
                  {financials.stateTax > 0 && (
                    <FinRowTip
                      label="State / Regional Tax"
                      value={`(${fmt(scaleMoney(financials.stateTax, periodView))})`}
                      valueClass="text-error"
                      indent
                      tooltip="State- or region-level corporate tax on sectors operating in that state. Per-sector detail appears on each sector's detail page."
                    />
                  )}
                </>
              )}

              {/* Interest Expense / Income */}
              {(financials.bondInterestCost > 0 ||
                financials.bondCouponIncome > 0 ||
                financials.dividendIncomeReceived > 0 ||
                financials.imfFacilityPaymentDaily > 0 ||
                financials.imfFacilityReceiptsDaily > 0) && (
                <>
                  <div className="border-t border-card-border mt-3" />
                  <div className="text-[11px] font-semibold text-muted uppercase tracking-wider pt-3 pb-2">
                    Interest
                  </div>
                  {financials.bondInterestCost > 0 && (
                    <FinRowTip
                      label="Bond Interest Expense"
                      value={`(${fmt(scaleMoney(financials.bondInterestCost, periodView))})`}
                      valueClass="text-error"
                      indent
                      tooltip="Cost of coupon payments on all outstanding bonds."
                    />
                  )}
                  {financials.governmentBondSubsidy > 0 && (
                    <FinRowTip
                      label="Government Bond Subsidy"
                      value={fmt(scaleMoney(financials.governmentBondSubsidy, periodView))}
                      valueClass="text-success"
                      indent
                      tooltip="Government contribution covering bond interest costs for state-owned enterprises."
                    />
                  )}
                  {financials.bondCouponIncome > 0 && (
                    <FinRowTip
                      label="Bond Coupon Income"
                      value={fmt(scaleMoney(financials.bondCouponIncome, periodView))}
                      valueClass="text-success"
                      indent
                      tooltip="Coupon income from bonds held in the corporate portfolio."
                    />
                  )}
                  {financials.dividendIncomeReceived > 0 && (
                    <FinRowTip
                      label="Dividend Income (holdings)"
                      value={fmt(scaleMoney(financials.dividendIncomeReceived, periodView))}
                      valueClass="text-success"
                      indent
                      tooltip="Dividends this company received from shares it owns in other companies. Only half of it is taxed."
                    />
                  )}
                  {financials.imfFacilityPaymentDaily > 0 && (
                    <FinRowTip
                      label="IMF Facility Payment"
                      value={`(${fmt(scaleMoney(financials.imfFacilityPaymentDaily, periodView))})`}
                      valueClass="text-error"
                      indent
                      tooltip="Scheduled principal and interest on the active IMF restructuring facility (cash settles in the hourly turn after operating results)."
                    />
                  )}
                  {financials.imfFacilityReceiptsDaily > 0 && (
                    <FinRowTip
                      label="IMF Facility Receipts"
                      value={fmt(scaleMoney(financials.imfFacilityReceiptsDaily, periodView))}
                      valueClass="text-success"
                      indent
                      tooltip="Cash received from IMF facility loans you hold as lender (same schedule as borrower payments)."
                    />
                  )}
                </>
              )}

              {/* Net Income */}
              <div className="border-t-2 border-foreground/20 mt-3 pt-2">
                <FinRowTip
                  label="Net Income"
                  value={fmtSigned(scaleMoney(financials.income, periodView))}
                  valueClass={financials.income >= 0 ? "text-success" : "text-error"}
                  bold
                  tooltip="Operating income after taxes, bond interest or coupon income, and IMF facility cash flows where applicable, before dividend distributions."
                />
              </div>

              {/* Dividend Distribution */}
              {financials.effectiveDividendRate > 0 && (
                <>
                  <div className="border-t border-card-border mt-3" />
                  <div className="text-[11px] font-semibold text-muted uppercase tracking-wider pt-3 pb-2">
                    Distributions
                  </div>
                  {(() => {
                    const netBeforeDividends = financials.income;
                    const dailyDividend = financials.dividendDistribution;
                    const dailyRetained = netBeforeDividends - dailyDividend;
                    return (
                      <>
                        <FinRowTip
                          label={`Dividends (${financials.effectiveDividendRate}%)`}
                          value={`(${fmt(Math.round(scaleMoney(dailyDividend, periodView)))})`}
                          valueClass="text-warning"
                          indent
                          tooltip={`${financials.effectiveDividendRate}% of net income (after tax and bond interest or coupon income) paid to shareholders each turn.`}
                        />
                        <div className="border-t border-card-border mt-2 pt-2">
                          <FinRowTip
                            label="Retained Earnings"
                            value={fmtSigned(Math.round(scaleMoney(dailyRetained, periodView)))}
                            valueClass={dailyRetained >= 0 ? "text-foreground" : "text-error"}
                            bold
                            tooltip="Net income minus dividends. Bond coupon and interest cash flows are applied in the bond processing phase."
                          />
                        </div>
                      </>
                    );
                  })()}
                </>
              )}
            </div>

            {/* Key Metrics footer */}
            <div className="border-t border-card-border bg-background/40 px-6 py-4">
              <div className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-3">
                Key Metrics
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                <div>
                  <div className="text-[11px] text-muted mb-0.5">Share Price</div>
                  <div className="text-sm font-semibold text-foreground tabular-nums">
                    {formatPrice(
                      liquidCode
                        ? toInternalFrom(corporation.sharePrice, liquidCode)
                        : corporation.sharePrice,
                      liquidCode
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-muted mb-0.5">Market Cap</div>
                  <div className="text-sm font-semibold text-foreground tabular-nums">
                    {fmt(corporation.marketCapitalization)}
                  </div>
                </div>
                <InfoTooltip
                  trigger={
                    <div className="cursor-help">
                      <div className="text-[11px] text-muted mb-0.5 border-b border-dotted border-muted/40 w-fit">
                        Marketing strength
                      </div>
                      <div className="text-sm font-semibold text-foreground tabular-nums">
                        {formatMarketingStrength(corporation.marketingStrength)}
                        <span className="text-xs font-normal text-muted ml-1">
                          (+{corporation.marketingStrengthGrowth.toFixed(3)}/turn)
                        </span>
                      </div>
                    </div>
                  }
                  width={280}
                >
                  <p className="font-semibold text-foreground mb-1">Marketing strength</p>
                  <p className="text-muted">
                    Accumulated marketing power. Higher MS strengthens takeovers of rival plants.
                  </p>
                </InfoTooltip>
                <InfoTooltip
                  trigger={
                    <div className="cursor-help">
                      <div className="text-[11px] text-muted mb-0.5 border-b border-dotted border-muted/40 w-fit">
                        Logistics & Operations efficiency
                      </div>
                      <div className="text-sm font-semibold text-foreground tabular-nums">
                        {Math.round(corporation.logisticsStrength)}
                        <span className="text-xs font-normal text-muted ml-1">
                          ({corporation.logisticsStrengthNetChange >= 0 ? "+" : ""}
                          {corporation.logisticsStrengthNetChange.toFixed(3)}/turn)
                        </span>
                      </div>
                    </div>
                  }
                  width={280}
                >
                  <p className="font-semibold text-foreground mb-1">
                    Logistics & Operations efficiency
                  </p>
                  <p className="text-muted">
                    Accumulated logistics investment. Higher values reduce the margin penalty when
                    you operate many sectors (sprawl), up to a cap at LS 200.
                  </p>
                </InfoTooltip>
                <div>
                  <div className="text-[11px] text-muted mb-0.5">Dividend Rate</div>
                  <div className="text-sm font-semibold text-foreground tabular-nums">
                    {financials.effectiveDividendRate}%
                    {financials.effectiveDividendRate > (corporation.dividendRate ?? 0) && (
                      <span className="ml-2 text-[10px] uppercase tracking-wider text-warning">
                        Legal floor
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <GlanceRail
            financials={financials}
            bondInfo={bondInfo}
            periodView={periodView}
            fmt={fmt}
            creditRatingLabel={corporation.creditRatingSnapshot}
            creditScore={corporation.creditCompositeSnapshot}
          />
        </div>
      )}

      {financialView === "balance_sheet" && balanceSheet && (
        <div className="rounded-xl border border-card-border bg-card overflow-hidden">
          <div className="px-6 py-4 space-y-1">
            {/* ASSETS */}
            <div className="text-[11px] font-semibold text-muted uppercase tracking-wider pt-1 pb-2">
              Assets
            </div>

            <div className="text-xs font-medium text-muted mb-1 pl-4">Current Assets</div>
            {financialFogOfWar && financialFogOfWar.lastQuarterly.liquidCapital != null ? (
              <div className="flex items-start justify-between pl-4">
                <span className="text-sm text-muted border-b border-dotted border-muted/40">
                  + Cash &amp; Equivalents
                </span>
                <div className="flex flex-col items-end gap-0.5">
                  <span className="text-[10px] text-muted tabular-nums">
                    {qLabel}: {fmtCorpCash(financialFogOfWar.lastQuarterly.liquidCapital)}
                  </span>
                  <span className="text-sm font-medium text-yellow-200 tabular-nums">
                    ~{fmtCorpCash(balanceSheet.assets.cashOnHand)}
                  </span>
                </div>
              </div>
            ) : (
              <FinRowTip
                label="Cash &amp; Equivalents"
                value={fmtCorpCash(balanceSheet.assets.cashOnHand)}
                valueClass="text-foreground"
                indent
                tooltip="Liquid capital available for operations, expansion, and investment. This is the corporation's cash reserves."
              />
            )}
            {!corporation.countryOwnerId && (
              <div className="pl-4 pt-2">
                <Link
                  href={`/portfolio/corporation/${corpId}`}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Open investment portfolio
                </Link>
              </div>
            )}
            {(corporation.shareEscrowBalance ?? 0) > 0 && (
              <FinRowTip
                label="Share-Buyback Escrow"
                value={fmtCorpCash(corporation.shareEscrowBalance ?? 0)}
                valueClass="text-foreground"
                indent
                tooltip="Held in share-buyback escrow; funds sell-backs, not spendable as liquid capital."
              />
            )}

            <div className="border-t border-card-border mt-3" />
            <div className="flex items-center justify-between pl-4 mt-3">
              <div className="text-xs font-medium text-muted uppercase tracking-wider">
                Long-Term Assets (Sector NPV)
              </div>
              {balanceSheet.assets.sectorNPVs.length > 0 && (
                <button
                  onClick={() => {
                    setSectorNpvExpanded((e) => !e);
                    setSectorNpvPage(0);
                  }}
                  className="text-[10px] text-muted hover:text-foreground transition-colors flex items-center gap-1"
                >
                  {sectorNpvExpanded ? "Collapse" : "Expand"}
                  <svg
                    className={`w-3 h-3 transition-transform ${sectorNpvExpanded ? "rotate-180" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>
              )}
            </div>
            <p className="text-[10px] text-muted pl-4 mb-2">
              Net present value of future cash flows, discounted at 15% annually
            </p>
            {balanceSheet.assets.sectorNPVs.length === 0 ? (
              <p className="text-sm text-muted pl-4">No sectors yet.</p>
            ) : sectorNpvExpanded ? (
              <>
                <div className="space-y-1 pl-4">
                  {balanceSheet.assets.sectorNPVs
                    .slice(sectorNpvPage * SECTORS_PER_PAGE, (sectorNpvPage + 1) * SECTORS_PER_PAGE)
                    .map((sector) => (
                      <Link
                        key={sector.sectorId}
                        href={`/corporation/${corpId}/sector/${sector.sectorId}`}
                        className="flex items-center justify-between text-sm py-0.5 hover:bg-card-elevated/50 -mx-2 px-2 rounded transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-muted text-xs">{sector.stateName}</span>
                          <span
                            className={`text-[10px] tabular-nums ${sector.effectiveProfitMargin <= 0 ? "text-error" : "text-muted/60"}`}
                            title={`Effective margin: ${sector.effectiveProfitMargin}%`}
                          >
                            {sector.effectiveProfitMargin}% margin
                          </span>
                        </div>
                        <span
                          className={`font-medium tabular-nums text-sm ${
                            sector.npv > 0 ? "text-foreground" : "text-muted"
                          }`}
                          title={
                            sector.npv === 0
                              ? "NPV is zero because effective margin ≤ 0%"
                              : undefined
                          }
                        >
                          {fmt(sector.npv)}
                        </span>
                      </Link>
                    ))}
                </div>
                {balanceSheet.assets.sectorNPVs.length > SECTORS_PER_PAGE && (
                  <div className="flex items-center justify-between pl-4 mt-2">
                    <button
                      onClick={() => setSectorNpvPage((p) => Math.max(0, p - 1))}
                      disabled={sectorNpvPage === 0}
                      className="text-xs text-muted hover:text-foreground disabled:opacity-30 disabled:hover:text-muted transition-colors"
                    >
                      ← Previous
                    </button>
                    <span className="text-[10px] text-muted">
                      Page {sectorNpvPage + 1} of{" "}
                      {Math.ceil(balanceSheet.assets.sectorNPVs.length / SECTORS_PER_PAGE)}
                    </span>
                    <button
                      onClick={() =>
                        setSectorNpvPage((p) =>
                          Math.min(
                            Math.ceil(balanceSheet.assets.sectorNPVs.length / SECTORS_PER_PAGE) - 1,
                            p + 1
                          )
                        )
                      }
                      disabled={
                        (sectorNpvPage + 1) * SECTORS_PER_PAGE >=
                        balanceSheet.assets.sectorNPVs.length
                      }
                      className="text-xs text-muted hover:text-foreground disabled:opacity-30 disabled:hover:text-muted transition-colors"
                    >
                      Next →
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="pl-4">
                <div className="flex items-center justify-between text-sm py-1">
                  <span className="text-muted text-xs">
                    {balanceSheet.assets.sectorNPVs.length} sector
                    {balanceSheet.assets.sectorNPVs.length !== 1 ? "s" : ""}
                  </span>
                  <span className="text-sm font-medium text-foreground tabular-nums">
                    {fmt(balanceSheet.assets.totalSectorNPV)}
                  </span>
                </div>
              </div>
            )}
            <div className="border-t border-card-border mt-2 pt-1 pl-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted">Total Sector NPV</span>
                <span className="text-sm font-medium text-foreground tabular-nums">
                  {fmt(balanceSheet.assets.totalSectorNPV)}
                </span>
              </div>
            </div>

            {/* Portfolio Investments */}
            {(balanceSheet.assets.stockHoldingsValue > 0 ||
              balanceSheet.assets.bondHoldingsValue > 0 ||
              (balanceSheet.assets.imfFacilityReceivablesValue ?? 0) > 0) && (
              <>
                <div className="border-t border-card-border mt-3" />
                <div className="text-xs font-medium text-muted mb-1 mt-3 pl-4">
                  Portfolio Investments
                </div>
                {balanceSheet.assets.stockHoldingsValue > 0 && (
                  <FinRowTip
                    label="Stock Holdings"
                    value={fmt(balanceSheet.assets.stockHoldingsValue)}
                    valueClass="text-success"
                    indent
                    tooltip="Equity investments in other corporations. Value based on current market share price."
                  />
                )}
                {balanceSheet.assets.bondHoldingsValue > 0 && (
                  <FinRowTip
                    label="Bond Holdings"
                    value={fmt(balanceSheet.assets.bondHoldingsValue)}
                    valueClass="text-success"
                    indent
                    tooltip="Corporate and sovereign bonds held in the portfolio. Value based on current market price."
                  />
                )}
                {(balanceSheet.assets.imfFacilityReceivablesValue ?? 0) > 0 && (
                  <FinRowTip
                    label="IMF Facility Loans"
                    value={fmt(balanceSheet.assets.imfFacilityReceivablesValue)}
                    valueClass="text-success"
                    indent
                    tooltip="Principal outstanding on IMF restructuring loans owed to this corporation. Not tradable bonds."
                  />
                )}
                <div className="border-t border-card-border mt-2 pt-1 pl-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted">Total Portfolio</span>
                    <span className="text-sm font-medium text-success tabular-nums">
                      {fmt(balanceSheet.assets.totalPortfolioValue)}
                    </span>
                  </div>
                </div>
              </>
            )}

            {/* Intangible Assets — Tech */}
            {balanceSheet.assets.techAssetValue > 0 && (
              <>
                <div className="border-t border-card-border mt-3" />
                <div className="text-xs font-medium text-muted mb-1 mt-3 pl-4">
                  Intangible Assets
                </div>
                <FinRowTip
                  label="Tech Tree Value"
                  value={fmt(balanceSheet.assets.techAssetValue)}
                  valueClass="text-success"
                  indent
                  tooltip="Estimated value of unlocked tech-tree nodes, weighted by decade (most recent = 100%, each prior decade halved). Included in tangible book value."
                />
                <div className="border-t border-card-border mt-2 pt-1 pl-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted">Total Intangibles</span>
                    <span className="text-sm font-medium text-success tabular-nums">
                      {fmt(balanceSheet.assets.techAssetValue)}
                    </span>
                  </div>
                </div>
              </>
            )}

            {/* Total Assets */}
            <div className="border-t-2 border-foreground/20 mt-3 pt-2">
              <FinRowTip
                label="Total Assets"
                value={fmt(balanceSheet.assets.totalAssets)}
                valueClass="text-foreground"
                bold
                tooltip="Cash on hand plus the total NPV of all sectors. Represents the total estimated value of the corporation's assets."
              />
            </div>

            {/* LIABILITIES */}
            <div className="border-t border-card-border mt-4" />
            <div className="text-[11px] font-semibold text-muted uppercase tracking-wider pt-3 pb-2">
              Liabilities
            </div>

            {balanceSheet.liabilities.totalDebt > 0 ? (
              <>
                <FinRowTip
                  label={`Bond Debt (${balanceSheet.liabilities.bondCount} issue${balanceSheet.liabilities.bondCount !== 1 ? "s" : ""})`}
                  value={fmt(balanceSheet.liabilities.totalDebt)}
                  valueClass="text-error"
                  indent
                  tooltip="Total face value of all outstanding bonds. This principal must be repaid at maturity."
                />
                <FinRowTip
                  label="Interest Cost"
                  value={`(${fmt(balanceSheet.liabilities.dailyInterestCost / 24)})`}
                  daily={`(${fmt(balanceSheet.liabilities.dailyInterestCost)})`}
                  valueClass="text-error"
                  indent
                  tooltip="Coupon payments owed to bondholders, deducted from liquid capital each turn."
                />
                <div className="border-t border-card-border mt-2 pt-2">
                  <FinRowTip
                    label="Total Liabilities"
                    value={fmt(balanceSheet.liabilities.totalDebt)}
                    valueClass="text-error"
                    bold
                    tooltip="Total outstanding bond principal. Represents obligations to bondholders."
                  />
                </div>
              </>
            ) : (
              <p className="text-sm text-muted pl-4 py-1">No outstanding liabilities</p>
            )}

            {/* EQUITY */}
            <div className="border-t border-card-border mt-4" />
            <div className="text-[11px] font-semibold text-muted uppercase tracking-wider pt-3 pb-2">
              Shareholders&apos; Equity
            </div>

            <FinRowTip
              label="Total Assets"
              value={fmt(balanceSheet.assets.totalAssets)}
              valueClass="text-foreground"
              indent
              tooltip="Sum of all assets: cash and sector NPVs."
            />
            {balanceSheet.liabilities.totalDebt > 0 && (
              <FinRowTip
                label="Less: Total Liabilities"
                value={`(${fmt(balanceSheet.liabilities.totalDebt)})`}
                valueClass="text-error"
                indent
                tooltip="Outstanding bond principal subtracted from assets."
              />
            )}
            <div className="border-t-2 border-foreground/20 mt-2 pt-2">
              <FinRowTip
                label="Book Value (Net Equity)"
                value={fmt(balanceSheet.equity.bookValue)}
                valueClass="text-foreground"
                bold
                tooltip="Assets minus liabilities. Represents the net worth of the corporation attributable to shareholders."
              />
            </div>
          </div>

          {/* Valuation footer */}
          <div className="border-t border-card-border bg-background/40 px-6 py-4">
            <div className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-3">
              Market Valuation
            </div>
            <div className="space-y-2">
              <FinRowTip
                label="Market Capitalization"
                value={fmt(balanceSheet.equity.marketCapitalization)}
                valueClass="text-foreground"
                tooltip="Listed quote × shares outstanding (same basis as the stock exchange). May differ from the blended fair-value model and from trade-clearing prices."
              />
              {(() => {
                const bookValue = balanceSheet.equity.bookValue;
                const marketCap = balanceSheet.equity.marketCapitalization;
                const ratio = bookValue > 0 ? marketCap / bookValue : 0;
                const label =
                  ratio > 1.1
                    ? "Overvalued by market"
                    : ratio < 0.9
                      ? "Undervalued by market"
                      : "Fairly valued";
                const color =
                  ratio > 1.1 ? "text-warning" : ratio < 0.9 ? "text-success" : "text-muted";
                return (
                  <FinRowTip
                    label="Price-to-Book Ratio"
                    value={ratio > 0 ? `${ratio.toFixed(2)}x` : "N/A"}
                    valueClass={color}
                    tooltip={`${label}. A P/B ratio above 1 means the market values the corporation above its book value. Below 1 indicates market undervaluation.`}
                  />
                );
              })()}
              {bondInfo &&
                bondInfo.totalDebt > 0 &&
                (() => {
                  // Prefer the persisted, announced snapshot so the displayed rating
                  // matches the credit-rating-change notification. The live /bonds
                  // recompute double-smooths and can diverge; fall back to it only for
                  // legacy corps missing a snapshot.
                  const displayRating =
                    corporation.creditRatingSnapshot ?? bondInfo.creditRating.rating;
                  const displayScore =
                    corporation.creditCompositeSnapshot ?? bondInfo.creditRating.compositeScore;
                  return (
                    <FinRowTip
                      label="Credit Rating"
                      value={displayRating}
                      valueClass={
                        displayScore >= 70
                          ? "text-success"
                          : displayScore >= 40
                            ? "text-warning"
                            : "text-error"
                      }
                      tooltip={`Credit score: ${displayScore}/100. Higher ratings mean lower borrowing costs.`}
                    />
                  );
                })()}
            </div>
          </div>
        </div>
      )}

      {/* Trade Restrictions + Active Subsidies — compact side-by-side; each
          component renders its own tidy empty state, so a single missing one
          no longer dominates the page with a giant empty box. */}
      {(() => {
        const corpHqCountryId = corporation.countryId;
        const operatingCountries: string[] = [
          ...new Set(sectors.map((s) => s.countryId ?? corpHqCountryId)),
        ];
        const hasForeignOperations = operatingCountries.some((c) => c !== corpHqCountryId);
        const hasSectors = sectors.length > 0;
        if (!hasForeignOperations && !hasSectors) return null;
        return (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {hasForeignOperations && (
              <section className="rounded-xl border border-card-border bg-card p-4 space-y-3">
                <h3 className="text-sm font-bold text-foreground">Trade Restrictions</h3>
                <TariffRestrictions
                  corpHqCountryId={corpHqCountryId}
                  corporationId={corporation._id}
                  operatingCountries={operatingCountries}
                />
              </section>
            )}
            {hasSectors && (
              <section className="rounded-xl border border-card-border bg-card p-4 space-y-3">
                <h3 className="text-sm font-bold text-foreground">Active Subsidies</h3>
                <SubsidyBenefits
                  corpHqState={corporation.headquartersState}
                  corpHqCountryId={corporation.countryId}
                  sectors={sectors}
                />
              </section>
            )}
          </div>
        );
      })()}
    </div>
  );
}
