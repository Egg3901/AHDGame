"use client";
import {
  MONEY_PERIODS,
  MONEY_PERIOD_LABEL,
  scaleMoney,
  type MoneyPeriod,
} from "@/lib/constants/moneyTimescale";

import { EstChip } from "../market/MarketPrimitives";
import { corpIncomeBasis, netMarginPct, valuation } from "./financialsModel";
import type { CorporationDetail, Financials, BalanceSheet } from "../CorporationPageTypes";

type View = "income_statement" | "balance_sheet";
type Period = MoneyPeriod;

const VAL_TONE = { over: "text-warning", under: "text-success", fair: "text-muted" } as const;

function Pills<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-card-border bg-card-elevated p-1">
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            value === o.key ? "bg-primary text-white shadow-sm" : "text-muted hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Tile({
  label,
  children,
  hero,
}: {
  label: string;
  children: React.ReactNode;
  hero?: boolean;
}) {
  return (
    <div className="rounded-lg border border-card-border bg-card px-4 py-3">
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`tabular-nums font-bold text-foreground ${hero ? "text-2xl" : "text-lg"}`}>
        {children}
      </div>
    </div>
  );
}

export function SummaryBand({
  corporation,
  financials,
  balanceSheet,
  view,
  onViewChange,
  periodView,
  onPeriodViewChange,
  fmt,
  formatPrice,
  liquidToInternal,
  fogSourceTurn,
}: {
  corporation: CorporationDetail;
  financials: Financials;
  balanceSheet: BalanceSheet | null;
  view: View;
  onViewChange: (v: View) => void;
  periodView: Period;
  onPeriodViewChange: (v: Period) => void;
  fmt: (v: number) => string;
  formatPrice: (v: number) => string;
  liquidToInternal: (v: number) => number;
  fogSourceTurn: number | null;
}) {
  const period = (v: number) => scaleMoney(v, periodView);
  const margin = netMarginPct(financials);
  const val = valuation(
    balanceSheet?.equity.marketCapitalization ?? corporation.marketCapitalization,
    balanceSheet?.equity.bookValue ?? 0
  );
  // Headline net income is the REALIZED figure the engine booked last turn when
  // available (ground truth — reflects embargo/tariff/clearing effects the
  // projected income statement below can't fully reproduce, ticket #935), and
  // falls back to the projection for brand-new corps with no history. Both
  // bases already fold in bond coupons, bond interest and dividends received
  // (#941), so nothing non-operating may be added on top (ticket #1098).
  const basis = corpIncomeBasis(financials);
  const hasRealized = basis.isRealized;
  const totalIncome = basis.netIncome;
  // Non-operating income already INSIDE the headline: bond coupons and dividends
  // received from holdings. Broken out beneath so a bond-funded corp can see it
  // is enterprise-positive on coupons while operating negative (#943 / #2996).
  // Coupons show at FULL value here — the 0.75x interest-rate-risk discount lives
  // in the share-price economics only, never in the reported P&L.
  const nonOperatingIncome =
    (financials.bondCouponIncome ?? 0) + (financials.dividendIncomeReceived ?? 0);
  const operatingIncome = totalIncome - nonOperatingIncome;
  const couponMaterial = Math.abs(nonOperatingIncome) > Math.max(1, Math.abs(totalIncome) * 0.05);
  // Surface a divergence hint when the projection disagrees with reality by a
  // material amount (or in sign) so the estimate below never reads as the truth.
  const projDiffers =
    hasRealized &&
    (Math.sign(totalIncome) !== Math.sign(financials.income) ||
      Math.abs(totalIncome - financials.income) > Math.max(1, Math.abs(totalIncome) * 0.1));
  const retained = basis.retained;

  return (
    <div className="rounded-xl border border-card-border bg-background/60 p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-bold text-foreground">{corporation.name}</h2>
          {fogSourceTurn !== null && <EstChip turn={fogSourceTurn} />}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pills
            options={[
              { key: "income_statement" as View, label: "Income Statement" },
              { key: "balance_sheet" as View, label: "Balance Sheet" },
            ]}
            value={view}
            onChange={onViewChange}
          />
          {view === "income_statement" && (
            <Pills
              options={MONEY_PERIODS.map((k) => ({
                key: k as Period,
                label: MONEY_PERIOD_LABEL[k],
              }))}
              value={periodView}
              onChange={onPeriodViewChange}
            />
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {view === "income_statement" ? (
          <>
            <Tile label={hasRealized ? "Net income (last turn)" : "Net income"} hero>
              <span className={totalIncome >= 0 ? "text-success" : "text-error"}>
                {fmt(period(totalIncome))}
              </span>
              {couponMaterial ? (
                <div className="text-[11px] font-normal tabular-nums text-muted">
                  operating{" "}
                  <span className={operatingIncome >= 0 ? "text-success" : "text-error"}>
                    {fmt(period(operatingIncome))}
                  </span>
                </div>
              ) : (
                projDiffers && (
                  <div className="text-[11px] font-normal tabular-nums text-muted">
                    est. {fmt(period(financials.income))}
                  </div>
                )
              )}
            </Tile>
            <Tile label="Net margin">{margin.toFixed(1)}%</Tile>
            <Tile label="Price / book">
              <span className={VAL_TONE[val.tone]}>
                {val.ratio > 0 ? `${val.ratio.toFixed(2)}x` : "—"}
              </span>
            </Tile>
            <Tile label="Retained / period">
              <span className={retained >= 0 ? "text-foreground" : "text-error"}>
                {fmt(period(retained))}
              </span>
            </Tile>
          </>
        ) : (
          <>
            <Tile label="Total assets" hero>
              {balanceSheet ? fmt(balanceSheet.assets.totalAssets) : "—"}
            </Tile>
            <Tile label="Book value">
              {balanceSheet ? fmt(balanceSheet.equity.bookValue) : "—"}
            </Tile>
            <Tile label="Price / book">
              <span className={VAL_TONE[val.tone]}>
                {val.ratio > 0 ? `${val.ratio.toFixed(2)}x` : "—"}
              </span>
            </Tile>
            <Tile label="Share price">{formatPrice(liquidToInternal(corporation.sharePrice))}</Tile>
          </>
        )}
      </div>
    </div>
  );
}
