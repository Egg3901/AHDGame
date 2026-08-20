"use client";
import {
  MONEY_PERIOD_FACTOR,
  MONEY_PERIOD_SUFFIX,
  type MoneyPeriod,
} from "@/lib/constants/moneyTimescale";

import { useCurrency } from "@/contexts/CurrencyContext";
import { CorpEconomicModelBadge } from "@/components/economy/CorpEconomicModelBadge";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { formatEffectiveCouponPct, formatMarketingStrength } from "@/lib/utils/formatters";
import { corpIncomeBasis } from "./financials/financialsModel";
import type {
  CorporationDetail,
  Financials,
  BalanceSheet,
  BondInfo,
  SectorDetail,
  CorpTabId,
  FinancialFogMeta,
} from "./CorporationPageTypes";

interface OverviewTabProps {
  corporation: CorporationDetail;
  financials: Financials;
  balanceSheet: BalanceSheet | null;
  bondInfo: BondInfo | null;
  sectors: SectorDetail[];
  periodView: MoneyPeriod;
  onTabChange: (tab: CorpTabId) => void;
  isNationalCorp: boolean;
  financialFogOfWar?: FinancialFogMeta | null;
}

function TabLink({
  label,
  tab,
  onTabChange,
}: {
  label: string;
  tab: CorpTabId;
  onTabChange: (tab: CorpTabId) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onTabChange(tab)}
      className="text-secondary text-body-sm font-medium hover:underline"
    >
      {label} →
    </button>
  );
}

interface StatRowProps {
  label: string;
  value: React.ReactNode;
  linkTab?: CorpTabId;
  linkLabel?: string;
  onTabChange?: (tab: CorpTabId) => void;
}

function StatRow({ label, value, linkTab, linkLabel, onTabChange }: StatRowProps) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-card-border last:border-0">
      <span className="text-body-sm text-muted">{label}</span>
      <div className="flex items-center gap-2 text-right">
        <span className="text-body-sm font-semibold tabular-nums text-foreground">{value}</span>
        {linkTab && linkLabel && onTabChange && (
          <TabLink label={linkLabel} tab={linkTab} onTabChange={onTabChange} />
        )}
      </div>
    </div>
  );
}

type SectionAccent = "primary" | "success" | "info";

// Per-card accent for the icon tile — mirrors the design prototype's color
// rhythm (Financials reads "up"/green, Credit reads "info"/blue, the rest
// brand/primary). Static class strings so Tailwind keeps them in the build.
const SECTION_ACCENT: Record<SectionAccent, string> = {
  primary: "bg-primary/15 text-primary",
  success: "bg-success/15 text-success",
  info: "bg-info/15 text-info",
};

interface SectionCardProps {
  title: string;
  sub?: string;
  icon: React.ReactNode;
  tab: CorpTabId;
  onTabChange: (tab: CorpTabId) => void;
  children: React.ReactNode;
  fogBadge?: React.ReactNode;
  accent?: SectionAccent;
}

function SectionCard({
  title,
  sub,
  icon,
  tab,
  onTabChange,
  children,
  fogBadge,
  accent = "primary",
}: SectionCardProps) {
  return (
    <div className="rounded-xl border bg-card border-card-border p-4 space-y-1">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${SECTION_ACCENT[accent]}`}
          >
            {icon}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-body font-semibold text-foreground truncate">{title}</span>
              {fogBadge}
            </div>
            {sub && <div className="text-[11px] text-muted truncate">{sub}</div>}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onTabChange(tab)}
          className="shrink-0 text-body-sm text-muted hover:text-secondary transition-colors"
        >
          View details →
        </button>
      </div>
      {children}
    </div>
  );
}

export default function OverviewTab({
  corporation,
  financials,
  balanceSheet,
  bondInfo,
  sectors,
  periodView,
  onTabChange,
  isNationalCorp,
  financialFogOfWar,
}: OverviewTabProps) {
  const { formatAmount, formatPrice, toInternalFrom } = useCurrency();

  const liquidCode = (corporation.liquidCurrencyCode as CurrencyCode | undefined) ?? undefined;

  const fmt = (val: number) => {
    const anchor = liquidCode ? toInternalFrom(val, liquidCode) : val;
    return formatAmount(anchor, liquidCode);
  };

  // financials.totalRevenue / income are daily (24 game-hour) values. Match the
  // Conversion + label come from moneyTimescale so this matches every other surface.
  const multiplier = MONEY_PERIOD_FACTOR[periodView];
  const periodLabel = MONEY_PERIOD_SUFFIX[periodView];

  const totalRevenue = financials.totalRevenue * multiplier;
  // Retained income: what actually stays with the corp after the dividend
  // payout. Prefer the realized last-turn figure (ground truth) over the
  // projection, which can't reproduce embargo/tariff/clearing haircuts (ticket
  // #935). The realized figure is already NET of dividends, so the shared basis
  // must do the netting — subtracting the projection-derived
  // `dividendDistribution` from it flipped profitable corps negative (#1098).
  const income = corpIncomeBasis(financials).retained * multiplier;
  const incomeColor = income > 0 ? "text-success" : income < 0 ? "text-error" : "text-foreground";

  const stateCount = new Set(sectors.map((s) => s.stateId)).size;

  // Realized-preferring basis (financialRevenue ?? revenue), matching the
  // headline Total Revenue card above so the two don't disagree.
  const sectorRevenue = (s: SectorDetail) => s.financialRevenue ?? s.revenue;
  const topSectors = [...sectors].sort((a, b) => sectorRevenue(b) - sectorRevenue(a)).slice(0, 3);

  return (
    <div className="space-y-4">
      {/* §6.2 (P7b): how the country's economic model treats this corp's sector. */}
      <CorpEconomicModelBadge countryId={corporation.countryId} sectorType={corporation.type} />

      {/* Thesis banner — mirror of the SOE charter banner, flipped to shareholders. */}
      {!isNationalCorp && (
        <div className="rounded-xl border border-primary/25 bg-primary/[0.06] p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <svg
              className="mt-0.5 h-5 w-5 shrink-0 text-primary"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
              />
            </svg>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-primary/80">
                Shareholder instrument
              </div>
              <p className="mt-1 max-w-3xl text-body-sm leading-relaxed text-foreground/90">
                {corporation.name} is a{" "}
                <span className="font-semibold text-primary">
                  {corporation.isPrivate ? "privately held" : "publicly traded"} instrument of its
                  shareholders
                </span>
                . It is judged on what it gives them back: share price, dividends, and the total
                value of the company. The CEO runs it to grow that value
                {corporation.isPrivate ? "." : "; the market prices it in real time."}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Financial fog of war — only present for non-CEO viewers of a public corp. */}
      {financialFogOfWar && (
        <div className="flex items-start gap-2.5 rounded-xl border border-warning/30 bg-warning/[0.06] px-4 py-3">
          <svg
            className="mt-0.5 h-4 w-4 shrink-0 text-warning"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM9 9a1 1 0 011-1h.01a1 1 0 011 1v3a1 1 0 11-2 0V9zm1-4a1 1 0 100 2 1 1 0 000-2z"
              clipRule="evenodd"
            />
          </svg>
          <div className="text-[12px] leading-snug text-foreground/85">
            <span className="font-semibold text-warning">Financial fog of war.</span> You are not
            the CEO, so the income, cash, and books below are{" "}
            <span className="font-semibold">estimates</span>
            {financialFogOfWar.fogSourceTurn != null
              ? ` from the last quarterly report (turn ${financialFogOfWar.fogSourceTurn})`
              : " from the last quarterly report"}
            . Share price and market cap remain live public market figures.
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {/* Market & valuation card — leads the page; hidden for national corps */}
        {!isNationalCorp && (
          <SectionCard
            title="Market & valuation"
            sub="What the market pays for it"
            tab="shares"
            onTabChange={onTabChange}
            icon={
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                />
              </svg>
            }
          >
            <StatRow
              label="Share price"
              value={formatPrice(
                liquidCode
                  ? toInternalFrom(corporation.sharePrice, liquidCode)
                  : corporation.sharePrice
              )}
              linkTab="shares"
              linkLabel="Trade"
              onTabChange={onTabChange}
            />
            <StatRow label="Market cap" value={fmt(corporation.marketCapitalization)} />
            {financials.growthCosts > 0 && (
              <p
                className="pt-1 text-[11px] leading-snug text-muted"
                title={`Book value ${balanceSheet ? fmt(balanceSheet.equity.bookValue) : "n/a"} · growth rate ${financials.currentGrowthRate.toFixed(2)}%/turn`}
              >
                Growth spend of {fmt(financials.growthCosts * multiplier)}
                {periodLabel} ({financials.currentGrowthRate.toFixed(2)}%/turn growth) lowers book
                value short term, so market cap can dip even while revenue rises.
              </p>
            )}
            <StatRow
              label="Total shares"
              value={corporation.totalShares.toLocaleString("en-US")}
              linkTab="shares"
              linkLabel="Shareholders"
              onTabChange={onTabChange}
            />
            <StatRow
              label="Public float (shares anyone can buy)"
              value={`${((corporation.publicFloat / Math.max(1, corporation.totalShares)) * 100).toFixed(1)}%`}
            />
            <StatRow
              label="Dividend rate"
              value={
                financials.effectiveDividendRate > 0 ? (
                  <>
                    {`${financials.effectiveDividendRate}%`}
                    {financials.effectiveDividendRate > (corporation.dividendRate ?? 0) && (
                      <span className="ml-2 text-[10px] uppercase tracking-wider text-warning">
                        Legal floor
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-muted">None</span>
                )
              }
            />
          </SectionCard>
        )}

        {/* Financials card */}
        <SectionCard
          title="Financials"
          sub={financialFogOfWar ? "Estimated from the last report" : "Live earnings & cash"}
          tab="financials"
          onTabChange={onTabChange}
          accent="success"
          fogBadge={
            financialFogOfWar ? (
              <span
                className="rounded-full border border-yellow-500/40 bg-yellow-500/10 px-1.5 py-0.5 text-[10px] font-medium text-yellow-400"
                title={
                  financialFogOfWar.fogSourceTurn != null
                    ? `Estimated from Q${financialFogOfWar.fogSourceTurn} report`
                    : "Estimated, with no report on record"
                }
              >
                Est.
              </span>
            ) : undefined
          }
          icon={
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 7h6m0 10v-3m-3 3v-6m-3 6v-1m9-9h.01M3 5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5z"
              />
            </svg>
          }
        >
          <StatRow label={`Revenue${periodLabel}`} value={fmt(totalRevenue)} />
          <StatRow
            label={`Net income${periodLabel}`}
            value={<span className={incomeColor}>{fmt(income)}</span>}
          />
          <StatRow
            label="Liquid capital"
            value={fmt(corporation.liquidCapital)}
            linkTab="financials"
            linkLabel="Balance sheet"
            onTabChange={onTabChange}
          />
          {(corporation.shareEscrowBalance ?? 0) > 0 && (
            <StatRow
              label="Share-buyback escrow"
              value={fmt(corporation.shareEscrowBalance ?? 0)}
            />
          )}
          {(corporation.shareEscrowBalance ?? 0) > 0 && (
            <p className="pt-1 text-[11px] leading-snug text-muted">
              Held in share-buyback escrow; funds sell-backs, not spendable as liquid capital.
            </p>
          )}
          {balanceSheet && (
            <StatRow label="Total assets" value={fmt(balanceSheet.assets.totalAssets)} />
          )}
        </SectionCard>

        {/* Sectors card */}
        <SectionCard
          title="Sectors"
          sub={`${sectors.length} sectors · ${stateCount} ${stateCount === 1 ? "region" : "regions"}`}
          tab="sectors"
          onTabChange={onTabChange}
          icon={
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
              />
            </svg>
          }
        >
          <StatRow
            label="Active sectors"
            value={`${sectors.length}`}
            linkTab="sectors"
            linkLabel="View all"
            onTabChange={onTabChange}
          />
          <StatRow label="States / regions" value={`${stateCount}`} />
          {topSectors.length > 0 && (
            <div className="pt-1 space-y-1">
              <p className="text-[10px] uppercase tracking-widest text-muted font-medium">
                Top sectors by revenue
              </p>
              {topSectors.map((s) => (
                <div key={s._id} className="flex items-center justify-between">
                  <span className="text-body-sm text-muted truncate max-w-[140px]">
                    {s.displayName ?? s.sectorLabel}{" "}
                    <span className="text-muted/60 text-[11px]">({s.stateName})</span>
                  </span>
                  <span className="text-body-sm tabular-nums text-foreground">
                    {fmt(sectorRevenue(s) * multiplier)}
                    {periodLabel}
                  </span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* Operations card */}
        <SectionCard
          title="Operations"
          sub="Growth levers"
          tab="sectors"
          onTabChange={onTabChange}
          icon={
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
          }
        >
          <StatRow
            label="Marketing strength"
            value={
              <span>
                {formatMarketingStrength(corporation.marketingStrength)}
                {corporation.marketingStrengthGrowth !== 0 && (
                  <span
                    className={`ml-1 text-[11px] ${corporation.marketingStrengthGrowth > 0 ? "text-success" : "text-error"}`}
                  >
                    {corporation.marketingStrengthGrowth > 0 ? "+" : ""}
                    {corporation.marketingStrengthGrowth.toFixed(1)}/turn
                  </span>
                )}
              </span>
            }
          />
          <StatRow
            label="Logistics & Operations efficiency"
            value={
              <span>
                {formatMarketingStrength(corporation.logisticsStrength)}
                {corporation.logisticsStrengthNetChange !== 0 && (
                  <span
                    className={`ml-1 text-[11px] ${corporation.logisticsStrengthNetChange > 0 ? "text-success" : "text-error"}`}
                  >
                    {corporation.logisticsStrengthNetChange > 0 ? "+" : ""}
                    {corporation.logisticsStrengthNetChange.toFixed(1)}/turn
                  </span>
                )}
              </span>
            }
          />
          <StatRow
            label="R&D score"
            value={
              <span>
                {formatMarketingStrength(corporation.rdScore)}
                {corporation.rdScoreNetChange !== 0 && (
                  <span
                    className={`ml-1 text-[11px] ${corporation.rdScoreNetChange > 0 ? "text-success" : "text-error"}`}
                  >
                    {corporation.rdScoreNetChange > 0 ? "+" : ""}
                    {corporation.rdScoreNetChange.toFixed(1)}/turn
                  </span>
                )}
              </span>
            }
          />
          <StatRow label="Growth rate" value={`${financials.currentGrowthRate.toFixed(2)}%/turn`} />
        </SectionCard>

        {/* Credit & Debt card — hidden for national corps */}
        {!isNationalCorp && (
          <SectionCard
            title="Credit & Debt"
            sub="Borrowing capacity"
            tab="credit"
            onTabChange={onTabChange}
            accent="info"
            icon={
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                />
              </svg>
            }
          >
            {bondInfo ? (
              <>
                <StatRow
                  label="Credit rating"
                  value={
                    <span className="font-bold text-body-lg">{bondInfo.creditRating.rating}</span>
                  }
                  linkTab="credit"
                  linkLabel="Details"
                  onTabChange={onTabChange}
                />
                <StatRow
                  label="Total debt"
                  value={fmt(bondInfo.totalDebt)}
                  linkTab="credit"
                  linkLabel="Bonds"
                  onTabChange={onTabChange}
                />
                <StatRow
                  label="Active bonds"
                  value={`${bondInfo.bonds.filter((b) => !b.defaulted && !b.matured).length}`}
                  linkTab="credit"
                  linkLabel="View"
                  onTabChange={onTabChange}
                />
                <StatRow
                  label="Effective coupon"
                  value={formatEffectiveCouponPct(bondInfo.creditRating.effectiveCouponRate)}
                />
              </>
            ) : (
              <p className="text-body-sm text-muted py-2">Loading credit data…</p>
            )}
          </SectionCard>
        )}

        {/* Governance card */}
        <SectionCard
          title="Governance"
          sub="Ownership & control"
          tab={isNationalCorp ? "financials" : "shares"}
          onTabChange={onTabChange}
          icon={
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
              />
            </svg>
          }
        >
          <StatRow
            label="CEO"
            value={
              corporation.ceoVacant ? (
                <span className="text-warning">Vacant</span>
              ) : (
                <span>Appointed</span>
              )
            }
          />
          <StatRow label="Structure" value={corporation.legalStructureLabel ?? "—"} />
          {corporation.parentCorporation && (
            <StatRow
              label="Parent corp"
              value={
                <span className="truncate max-w-[160px] inline-block">
                  {corporation.parentCorporation.name}{" "}
                  <span className="text-muted text-[11px]">
                    ({corporation.parentCorporation.ownershipPct.toFixed(1)}%)
                  </span>
                </span>
              }
            />
          )}
          {corporation.subsidiaries && corporation.subsidiaries.length > 0 && (
            <StatRow
              label="Subsidiaries"
              value={`${corporation.subsidiaries.length}`}
              linkTab="financials"
              linkLabel="View"
              onTabChange={onTabChange}
            />
          )}
          <StatRow label="Sector" value={corporation.typeLabel} />
          <StatRow label="HQ" value={corporation.headquartersStateName} />
        </SectionCard>
      </div>
    </div>
  );
}
