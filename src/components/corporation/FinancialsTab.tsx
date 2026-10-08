"use client";

import { useState } from "react";
import Link from "next/link";
import {
  MONEY_PERIODS,
  MONEY_PERIOD_FACTOR,
  MONEY_PERIOD_LABEL,
  MONEY_PERIOD_PER_LABEL,
  scaleMoney,
  type MoneyPeriod,
} from "@/lib/constants/moneyTimescale";
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
import { GroupOverviewCard } from "./GroupOverviewCard";
import {
  buildAllocation,
  cashAfterContracts,
  corpIncomeBasis,
  netMarginPct,
  valuation,
} from "./financials/financialsModel";
import {
  DenseSection,
  KVList,
  KVRow,
  Segmented,
  SmallButton,
  StatementGroup,
  StatementLine,
  StatementTable,
  TableScroll,
  Td,
  Th,
  signTone,
  useCorpMoney,
} from "./dense/DenseKit";

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

type StatementView = "income" | "balance";

const PERIOD_OPTIONS = MONEY_PERIODS.map((p) => ({ value: p, label: MONEY_PERIOD_LABEL[p] }));
const VIEW_OPTIONS = [
  { value: "income" as const, label: "Income statement" },
  { value: "balance" as const, label: "Balance sheet" },
];
const NPV_PAGE_SIZE = 10;

/** Share of revenue as a figure and a thin monochrome bar. */
function MixBar({ pct }: { pct: number }) {
  return (
    <span aria-hidden className="inline-block h-1 w-16 overflow-hidden rounded-sm bg-card-elevated">
      <span
        className="block h-full bg-foreground/60"
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </span>
  );
}

/**
 * The books as statements: income statement or balance sheet, line by line,
 * each figure beside its share of revenue. The page header carries price and
 * market cap, so nothing here repeats them as tiles.
 */
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
  const money = useCorpMoney(corporation.liquidCurrencyCode);
  const [view, setView] = useState<StatementView>("income");
  const [npvPage, setNpvPage] = useState(0);

  const fogged = financialFogOfWar != null;
  const est = (text: string) => (fogged ? `~${text}` : text);
  const scale = (daily: number) => scaleMoney(daily, periodView);
  const fmt = (local: number) => est(money.fmt(local));
  const fmtSigned = (local: number) => est(money.fmtSigned(local));
  /** Costs read as (x), credits as plain figures. */
  const cost = (daily: number) => {
    const v = scale(daily);
    if (v < 0) return fmt(-v);
    return est(`(${money.fmt(v)})`);
  };
  const revenue = financials.totalRevenue;
  const pctOf = (daily: number) =>
    revenue > 0 ? `${((daily / revenue) * 100).toFixed(1)}%` : null;
  const grossProfit =
    revenue -
    financials.maintenanceCosts -
    financials.laborCosts -
    financials.growthCosts -
    (financials.freightCosts ?? 0);
  const basis = corpIncomeBasis(financials);
  const settlement = financials.supplyAgreementSettlementDaily ?? 0;
  const unpaidSettlement = financials.supplyAgreementUnpaidAnchor ?? 0;
  const hasContracts = Math.abs(settlement) > 0 || unpaidSettlement > 0;

  // Cost mix, largest first, from the same reconciling allocation the engine
  // books against (an "Other" row appears if the lines fail to add up).
  // Monochrome bars: the order and the figures carry the information.
  const costMix = [...buildAllocation(financials, periodView).segments].sort(
    (a, b) => b.value - a.value
  );
  const netMargin = netMarginPct(financials);

  const creditRating = corporation.creditRatingSnapshot ?? bondInfo?.creditRating.rating;
  const creditScore = corporation.creditCompositeSnapshot ?? bondInfo?.creditRating.compositeScore;

  const federalByCountry = Object.entries(financials.federalTaxByCountry ?? {})
    .filter(([, amt]) => amt > 0)
    .sort((a, b) => b[1] - a[1]);
  const federalTitle =
    federalByCountry.length > 0
      ? `Federal tax by country (${MONEY_PERIOD_PER_LABEL[periodView]}): ${federalByCountry
          .map(([country, amt]) => `${country} ${money.fmt(amt * MONEY_PERIOD_FACTOR[periodView])}`)
          .join(", ")}. Each sector pays its country's federal rate on its share of income.`
      : "Federal corporate income tax on profitable sectors.";

  const operatingCountries = [...new Set(sectors.map((s) => s.countryId ?? corporation.countryId))];
  const hasForeignOperations = operatingCountries.some((c) => c !== corporation.countryId);

  const npvRows = balanceSheet?.assets.sectorNPVs ?? [];
  const npvPages = Math.max(1, Math.ceil(npvRows.length / NPV_PAGE_SIZE));
  const npvSlice = npvRows.slice(npvPage * NPV_PAGE_SIZE, (npvPage + 1) * NPV_PAGE_SIZE);

  const lastQ = financialFogOfWar?.lastQuarterly;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented ariaLabel="Statement" options={VIEW_OPTIONS} value={view} onChange={setView} />
        <Segmented
          ariaLabel="Money period"
          options={PERIOD_OPTIONS}
          value={periodView}
          onChange={onPeriodViewChange}
        />
      </div>

      {fogged && financialFogOfWar && (
        <DenseSection
          title="Estimates"
          meta={
            financialFogOfWar.fogSourceTurn != null
              ? `from the turn ${financialFogOfWar.fogSourceTurn} report, within ±${Math.round(financialFogOfWar.maxDeviation * 100)}%`
              : "no quarterly report on record yet"
          }
        >
          <p className="py-1 text-xs text-muted">
            You are not an insider, so figures marked ~ are estimates. The CEO and the controlling
            parent see the live books.
          </p>
          {lastQ && (
            <table className="w-full max-w-lg border-collapse">
              <thead>
                <tr>
                  <Th />
                  <Th align="right">Last report</Th>
                  <Th align="right">Estimate now</Th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <Td className="text-muted">Revenue</Td>
                  <Td align="right">
                    {lastQ.revenue != null ? money.fmt(scale(lastQ.revenue)) : "n/a"}
                  </Td>
                  <Td align="right">~{money.fmt(scale(revenue))}</Td>
                </tr>
                <tr>
                  <Td className="text-muted">Total costs</Td>
                  <Td align="right">
                    {lastQ.totalCosts != null ? `(${money.fmt(scale(lastQ.totalCosts))})` : "n/a"}
                  </Td>
                  <Td align="right">~({money.fmt(scale(financials.totalCosts))})</Td>
                </tr>
                <tr>
                  <Td className="text-muted">Net income</Td>
                  <Td align="right" className={signTone(lastQ.income)}>
                    {lastQ.income != null ? money.fmtSigned(scale(lastQ.income)) : "n/a"}
                  </Td>
                  <Td align="right" className={signTone(financials.income)}>
                    ~{money.fmtSigned(scale(financials.income))}
                  </Td>
                </tr>
              </tbody>
            </table>
          )}
        </DenseSection>
      )}

      {view === "income" && (
        <div className="grid gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <DenseSection title="Income statement" meta={MONEY_PERIOD_PER_LABEL[periodView]}>
            <p className="py-2 text-xs text-muted">
              Current estimates use today&apos;s sectors and budgets. Last-turn income is what the
              engine recorded before later changes to capacity, production or spending.
            </p>
            <StatementTable>
              <StatementGroup>Current estimate</StatementGroup>
              <StatementLine
                strong
                label="Gross revenue"
                amount={fmt(scale(revenue))}
                pct={revenue > 0 ? "100%" : null}
                note={`${financials.growthRateIsRealized ? "Grew" : "Growing"} ${(financials.currentGrowthRate ?? 0).toFixed(2)}%${financials.growthRateIsRealized ? " over the past year" : " a turn on average"}`}
                title="Total gross revenue from every owned sector."
              />
              {(financials.freightIncome ?? 0) > 0 && (
                <StatementLine
                  indent
                  label="Freight revenue"
                  amount={fmt(scale(financials.freightIncome ?? 0))}
                  note="Included in gross revenue"
                />
              )}
              <StatementLine
                indent
                label="Sector maintenance"
                amount={cost(financials.maintenanceCosts)}
                amountClass={financials.maintenanceCosts < 0 ? "text-success" : "text-foreground"}
                pct={pctOf(financials.maintenanceCosts)}
                title={
                  financials.maintenanceCosts < 0
                    ? "A credit: wages exceed the derived operating bill. Gross profit already nets it against wages."
                    : "Non-labour running costs: upkeep, inputs, overhead."
                }
              />
              {financials.laborCosts > 0 && (
                <StatementLine
                  indent
                  label="Wages"
                  amount={cost(financials.laborCosts)}
                  pct={pctOf(financials.laborCosts)}
                  title="Pay for workers in every sector. Moves with headcount, local pay and union demands."
                />
              )}
              {(financials.freightCosts ?? 0) > 0 && (
                <StatementLine
                  indent
                  label="Freight charges"
                  amount={cost(financials.freightCosts ?? 0)}
                  pct={pctOf(financials.freightCosts ?? 0)}
                  title="Shipping paid for inbound commodities, recorded separately from plant operating costs."
                />
              )}
              {financials.subsidyBenefit > 0 && (
                <StatementLine
                  indent
                  label="Subsidy benefit"
                  amount={fmt(scale(financials.subsidyBenefit))}
                  amountClass="text-success"
                  pct={pctOf(financials.subsidyBenefit)}
                  title="Margin from active government subsidies, +7.5% each."
                />
              )}
              {financials.growthCosts > 0 && (
                <StatementLine
                  indent
                  label="Growth investment"
                  amount={cost(financials.growthCosts)}
                  pct={pctOf(financials.growthCosts)}
                  title="Cost of growing sector revenue. Scales with revenue and growth rate."
                />
              )}
              <StatementLine
                strong
                label="Gross profit"
                amount={fmtSigned(scale(grossProfit))}
                amountClass={signTone(grossProfit)}
                pct={pctOf(grossProfit)}
              />

              <StatementGroup>Operating expenses</StatementGroup>
              <StatementLine
                indent
                label="Marketing"
                amount={cost(financials.marketingCosts)}
                pct={pctOf(financials.marketingCosts)}
              />
              {financials.logisticsCosts > 0 && (
                <StatementLine
                  indent
                  label="Logistics and operations"
                  amount={cost(financials.logisticsCosts)}
                  pct={pctOf(financials.logisticsCosts)}
                />
              )}
              {financials.rdCosts > 0 && (
                <StatementLine
                  indent
                  label="R&D"
                  amount={cost(financials.rdCosts)}
                  pct={pctOf(financials.rdCosts)}
                />
              )}
              {financials.regulatoryBurden > 0 && (
                <StatementLine
                  indent
                  label="Regulatory compliance"
                  amount={cost(financials.regulatoryBurden)}
                  pct={pctOf(financials.regulatoryBurden)}
                  title="The cost of the rules in force where you operate. Moves when governments change them."
                />
              )}
              {financials.pensionContributionCost > 0 && (
                <StatementLine
                  indent
                  label="Pension contributions"
                  amount={cost(financials.pensionContributionCost)}
                  pct={pctOf(financials.pensionContributionCost)}
                />
              )}
              {financials.pensionTopUpCost > 0 && (
                <StatementLine
                  indent
                  label="Pension deficit top-up"
                  amount={cost(financials.pensionTopUpCost)}
                  pct={pctOf(financials.pensionTopUpCost)}
                  note={`${financials.pensionSchemesInDeficit} scheme${financials.pensionSchemesInDeficit === 1 ? "" : "s"} in deficit`}
                />
              )}
              {financials.ceoSalaryCost > 0 && (
                <StatementLine
                  indent
                  label="CEO salary"
                  amount={cost(financials.ceoSalaryCost)}
                  pct={pctOf(financials.ceoSalaryCost)}
                />
              )}
              <StatementLine
                strong
                label="Operating income"
                amount={fmtSigned(scale(financials.operatingIncome))}
                amountClass={signTone(financials.operatingIncome)}
                pct={pctOf(financials.operatingIncome)}
                title="Earnings before interest and tax."
              />

              {(financials.federalTax > 0 || financials.stateTax > 0) && (
                <>
                  <StatementGroup>Tax</StatementGroup>
                  {financials.federalTax > 0 && (
                    <StatementLine
                      indent
                      label="Federal tax"
                      amount={cost(financials.federalTax)}
                      pct={pctOf(financials.federalTax)}
                      title={federalTitle}
                    />
                  )}
                  {financials.stateTax > 0 && (
                    <StatementLine
                      indent
                      label="State or regional tax"
                      amount={cost(financials.stateTax)}
                      pct={pctOf(financials.stateTax)}
                    />
                  )}
                </>
              )}

              {(financials.bondInterestCost > 0 ||
                financials.governmentBondSubsidy > 0 ||
                financials.bondCouponIncome > 0 ||
                financials.dividendIncomeReceived > 0 ||
                financials.imfFacilityPaymentDaily > 0 ||
                financials.imfFacilityReceiptsDaily > 0 ||
                balanceSheet?.assets.bankEquity != null) && (
                <>
                  <StatementGroup>Interest and investment income</StatementGroup>
                  {financials.bondInterestCost > 0 && (
                    <StatementLine
                      indent
                      label="Bond interest"
                      amount={cost(financials.bondInterestCost)}
                      pct={pctOf(financials.bondInterestCost)}
                    />
                  )}
                  {financials.governmentBondSubsidy > 0 && (
                    <StatementLine
                      indent
                      label="Government bond subsidy"
                      amount={fmt(scale(financials.governmentBondSubsidy))}
                      amountClass="text-success"
                    />
                  )}
                  {financials.bondCouponIncome > 0 && (
                    <StatementLine
                      indent
                      label="Bond coupon income"
                      amount={fmt(scale(financials.bondCouponIncome))}
                      amountClass="text-success"
                    />
                  )}
                  {balanceSheet?.assets.bankEquity != null && (
                    <StatementLine
                      indent
                      label="Banking subsidiary income"
                      amount={fmtSigned(scale(financials.bankingIncome ?? 0))}
                      amountClass={signTone(financials.bankingIncome ?? 0)}
                      title="Realized net income from the ring-fenced bank last turn: loan interest less deposit interest, insurance, defaults and facility interest."
                    />
                  )}
                  {financials.dividendIncomeReceived > 0 && (
                    <StatementLine
                      indent
                      label="Dividend income"
                      amount={fmt(scale(financials.dividendIncomeReceived))}
                      amountClass="text-success"
                      note="half of it is taxed"
                    />
                  )}
                  {financials.imfFacilityPaymentDaily > 0 && (
                    <StatementLine
                      indent
                      label="IMF facility payment"
                      amount={cost(financials.imfFacilityPaymentDaily)}
                    />
                  )}
                  {financials.imfFacilityReceiptsDaily > 0 && (
                    <StatementLine
                      indent
                      label="IMF facility receipts"
                      amount={fmt(scale(financials.imfFacilityReceiptsDaily))}
                      amountClass="text-success"
                    />
                  )}
                </>
              )}

              {basis.isRealized && (
                <>
                  <StatementLine
                    strong
                    label="Net income, current estimate"
                    amount={fmtSigned(scale(financials.income))}
                    amountClass={signTone(financials.income)}
                  />
                  <StatementGroup>
                    {financials.realizedIncomeTurn != null
                      ? `Last turn recorded (turn ${financials.realizedIncomeTurn})`
                      : "Last turn recorded"}
                  </StatementGroup>
                  <StatementLine
                    indent
                    label="Difference from current estimate"
                    amount={fmtSigned(scale(basis.netIncome - financials.income))}
                    amountClass={signTone(basis.netIncome - financials.income)}
                    note="Recorded net income less the current estimate"
                  />
                </>
              )}
              <StatementLine
                strong
                label={basis.isRealized ? "Net income, last turn" : "Net income"}
                amount={fmtSigned(scale(basis.netIncome))}
                amountClass={signTone(basis.netIncome)}
                pct={pctOf(basis.netIncome)}
                title={
                  basis.isRealized
                    ? "What the engine booked last turn. The lines above are the current projection and can differ."
                    : "Operating income after tax, interest and IMF flows, before dividends."
                }
              />
              {basis.dividendPaid > 0 && (
                <StatementLine
                  indent
                  label={`Dividends (${financials.effectiveDividendRate}%)`}
                  amount={est(`(${money.fmt(Math.round(scale(basis.dividendPaid)))})`)}
                  pct={pctOf(basis.dividendPaid)}
                />
              )}
              <StatementLine
                strong
                label="Retained"
                amount={fmtSigned(Math.round(scale(basis.retained)))}
                amountClass={signTone(basis.retained)}
                pct={pctOf(basis.retained)}
              />
              {hasContracts && (
                <>
                  <StatementLine
                    indent
                    label="Supply agreement settlements"
                    amount={fmtSigned(Math.round(scale(settlement)))}
                    amountClass={signTone(settlement)}
                    title="Last turn's contract-for-difference cash on signed supply agreements. A cash transfer on top of operating income."
                  />
                  {unpaidSettlement > 0 && (
                    <StatementLine
                      indent
                      label="Unpaid settlement, last turn"
                      amount={money.fmt(unpaidSettlement)}
                      amountClass="text-warning"
                      note="retried next settlement"
                    />
                  )}
                  <StatementLine
                    strong
                    label="Cash after contracts"
                    amount={fmtSigned(Math.round(scale(cashAfterContracts(financials))))}
                    amountClass={signTone(cashAfterContracts(financials))}
                  />
                </>
              )}
            </StatementTable>
          </DenseSection>

          <aside className="min-w-0 space-y-6">
            <DenseSection title="Cost mix" meta="share of revenue">
              {costMix.length === 0 ? (
                <p className="py-1 text-xs text-muted">No costs this period.</p>
              ) : (
                <table className="w-full border-collapse">
                  <tbody>
                    {costMix.map((c) => (
                      <tr key={c.key}>
                        <Td className="text-muted">{c.label}</Td>
                        <Td align="right">{fmt(c.value)}</Td>
                        <Td align="right" className="w-24 text-muted">
                          <span className="inline-flex items-center gap-2">
                            {c.pct.toFixed(1)}%
                            <MixBar pct={c.pct} />
                          </span>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </DenseSection>

            <DenseSection title="Health">
              <KVList>
                <KVRow
                  label="Net margin"
                  value={<span className={signTone(netMargin)}>{netMargin.toFixed(1)}%</span>}
                  title="Net income over everything taken in, bond coupons and IMF receipts included."
                />
                {creditRating && (
                  <KVRow
                    label="Leverage rating"
                    title="Measures debt load and the ability to service it, not profitability: a company with no debt rates AAA."
                    value={creditRating}
                    hint={creditScore != null ? `${creditScore}/100` : undefined}
                  />
                )}
                <KVRow label="Dividend payout" value={`${financials.effectiveDividendRate}%`} />
              </KVList>
            </DenseSection>
          </aside>
        </div>
      )}

      {view === "balance" && balanceSheet && (
        <div className="grid gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <DenseSection
            title="Balance sheet"
            actions={
              !corporation.countryOwnerId ? (
                <Link
                  href={`/portfolio/corporation/${corpId}`}
                  className="text-xs text-foreground underline decoration-card-border underline-offset-2 hover:decoration-foreground"
                >
                  Investment portfolio
                </Link>
              ) : undefined
            }
          >
            <StatementTable>
              <StatementGroup>Assets</StatementGroup>
              <StatementLine
                indent
                label="Cash"
                amount={fmt(balanceSheet.assets.cashOnHand)}
                note={
                  fogged && lastQ?.liquidCapital != null
                    ? `last report ${money.fmt(lastQ.liquidCapital)}`
                    : undefined
                }
              />
              {(corporation.shareEscrowBalance ?? 0) > 0 && (
                <StatementLine
                  indent
                  label="Share buyback escrow"
                  amount={money.fmt(corporation.shareEscrowBalance ?? 0)}
                  note="funds sell-backs, not spendable"
                />
              )}
              {balanceSheet.assets.bankEquity != null && (
                <>
                  <StatementLine
                    indent
                    label="Bank valuation"
                    amount={fmtSigned(balanceSheet.assets.bankValuation ?? 0)}
                    note="75% of book equity"
                    title="The ring-fenced bank's residual equity at the same 75% haircut the share-price model uses. Deposits belong to the bank."
                  />
                  <StatementLine
                    indent
                    label="Bank book equity"
                    amount={fmtSigned(balanceSheet.assets.bankEquity)}
                  />
                  {(balanceSheet.assets.bankNPV ?? 0) !== 0 && (
                    <StatementLine
                      indent
                      label="Banking NPV"
                      amount={fmt(balanceSheet.assets.bankNPV ?? 0)}
                    />
                  )}
                </>
              )}
              <StatementLine
                indent
                label="Sector NPV"
                amount={fmt(balanceSheet.assets.totalSectorNPV)}
                note={`${npvRows.length} sector${npvRows.length === 1 ? "" : "s"}, discounted at 15% a year`}
              />
              {balanceSheet.assets.stockHoldingsValue > 0 && (
                <StatementLine
                  indent
                  label="Stock holdings"
                  amount={fmt(balanceSheet.assets.stockHoldingsValue)}
                  note="at market price"
                />
              )}
              {balanceSheet.assets.bondHoldingsValue > 0 && (
                <StatementLine
                  indent
                  label="Bond holdings"
                  amount={fmt(balanceSheet.assets.bondHoldingsValue)}
                  note="at market price"
                />
              )}
              {(balanceSheet.assets.imfFacilityReceivablesValue ?? 0) > 0 && (
                <StatementLine
                  indent
                  label="IMF facility loans"
                  amount={fmt(balanceSheet.assets.imfFacilityReceivablesValue)}
                />
              )}
              {balanceSheet.assets.techAssetValue > 0 && (
                <StatementLine
                  indent
                  label="Technology"
                  amount={fmt(balanceSheet.assets.techAssetValue)}
                  note="unlocked tech nodes, older decades discounted"
                />
              )}
              <StatementLine
                strong
                label="Total assets"
                amount={fmt(balanceSheet.assets.totalAssets)}
              />

              <StatementGroup>Liabilities</StatementGroup>
              {balanceSheet.liabilities.totalDebt > 0 ? (
                <>
                  <StatementLine
                    indent
                    label={`Bond debt, ${balanceSheet.liabilities.bondCount} issue${balanceSheet.liabilities.bondCount === 1 ? "" : "s"}`}
                    amount={fmt(balanceSheet.liabilities.totalDebt)}
                    note={`interest ${money.fmt(scaleMoney(balanceSheet.liabilities.dailyInterestCost, "turn"))} a turn`}
                  />
                  <StatementLine
                    strong
                    label="Total liabilities"
                    amount={fmt(balanceSheet.liabilities.totalDebt)}
                  />
                </>
              ) : (
                <StatementLine indent label="No outstanding debt" amount={money.fmt(0)} />
              )}

              <StatementGroup>Equity</StatementGroup>
              <StatementLine
                strong
                label="Book value"
                amount={fmt(balanceSheet.equity.bookValue)}
                title="Assets minus liabilities: the net worth attributable to shareholders."
              />
            </StatementTable>
          </DenseSection>

          <aside className="min-w-0 space-y-6">
            <DenseSection title="Valuation">
              <KVList>
                <KVRow
                  label="Market cap"
                  value={money.fmt(balanceSheet.equity.marketCapitalization)}
                />
                {(() => {
                  const v = valuation(
                    balanceSheet.equity.marketCapitalization,
                    balanceSheet.equity.bookValue
                  );
                  return (
                    <KVRow
                      label="Price to book"
                      value={v.ratio > 0 ? `${v.ratio.toFixed(2)}x` : "N/A"}
                      hint={v.ratio > 0 ? v.label.toLowerCase() : undefined}
                      title="Above 1 the market values the corporation above its book value."
                    />
                  );
                })()}
                {creditRating && bondInfo && bondInfo.totalDebt > 0 && (
                  <KVRow
                    label="Leverage rating"
                    title="Measures debt load and the ability to service it, not profitability: a company with no debt rates AAA."
                    value={creditRating}
                    hint={creditScore != null ? `${creditScore}/100` : undefined}
                  />
                )}
              </KVList>
            </DenseSection>

            {npvRows.length > 0 && (
              <DenseSection
                title="Sector NPV"
                actions={
                  npvPages > 1 ? (
                    <>
                      <SmallButton
                        onClick={() => setNpvPage((p) => Math.max(0, p - 1))}
                        disabled={npvPage === 0}
                      >
                        Prev
                      </SmallButton>
                      <span className="font-mono text-xs text-muted">
                        {npvPage + 1}/{npvPages}
                      </span>
                      <SmallButton
                        onClick={() => setNpvPage((p) => Math.min(npvPages - 1, p + 1))}
                        disabled={npvPage >= npvPages - 1}
                      >
                        Next
                      </SmallButton>
                    </>
                  ) : undefined
                }
              >
                <TableScroll>
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        <Th>Region</Th>
                        <Th
                          align="right"
                          title="Net margin over the full cost bill where plants report it."
                        >
                          Margin
                        </Th>
                        <Th align="right">NPV</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {npvSlice.map((row) => {
                        const margin = row.fillAdjustedMarginPct ?? row.effectiveProfitMargin;
                        return (
                          <tr key={row.sectorId} className="hover:bg-card-elevated/40">
                            <Td className="max-w-[10rem] truncate">
                              <Link
                                href={`/corporation/${corpId}/sector/${row.sectorId}`}
                                className="text-foreground hover:underline"
                              >
                                {row.stateName}
                              </Link>
                            </Td>
                            <Td align="right" className={margin <= 0 ? "text-error" : "text-muted"}>
                              {margin}%
                            </Td>
                            <Td
                              align="right"
                              className={row.npv > 0 ? "text-foreground" : "text-muted"}
                              title={
                                row.npv === 0
                                  ? "Zero because the margin is zero or less."
                                  : undefined
                              }
                            >
                              {fmt(row.npv)}
                            </Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </TableScroll>
              </DenseSection>
            )}
          </aside>
        </div>
      )}

      <GroupOverviewCard corpId={corpId} />

      {(hasForeignOperations || sectors.length > 0) && (
        <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
          {hasForeignOperations && (
            <DenseSection title="Trade restrictions">
              <TariffRestrictions
                corpHqCountryId={corporation.countryId}
                corporationId={corporation._id}
                operatingCountries={operatingCountries}
              />
            </DenseSection>
          )}
          {sectors.length > 0 && (
            <DenseSection title="Active subsidies">
              <SubsidyBenefits
                corpHqState={corporation.headquartersState}
                corpHqCountryId={corporation.countryId}
                sectors={sectors}
              />
            </DenseSection>
          )}
        </div>
      )}
    </div>
  );
}
