"use client";

import Link from "next/link";
import { useCurrency } from "@/contexts/CurrencyContext";
import { CorporationLogo } from "@/components/corporation/CorporationLogo";
import type { CurrencyCode } from "@/lib/constants/currencies";

export interface Holding {
  corporationId: string;
  corporationName: string;
  sequentialId?: number;
  shares: number;
  sharePrice: number;
  totalValue: number;
  logoUrl?: string;
  brandColor?: string;
  /** Cost-basis fields are only present on the own-portfolio payload; the
   * public per-character endpoint omits them. Hide the columns via
   * `showCostBasis={false}` instead of rendering fabricated values. */
  avgCostPerShare?: number | null;
  unrealizedPnl?: number | null;
  unrealizedPnlPct?: number | null;
  currencyCode?: CurrencyCode;
}

export interface BondHolding {
  bondId: string;
  corporationId: string;
  corporationName: string;
  sequentialId?: number;
  units: number;
  faceValuePerUnit: number;
  couponRate: number;
  maturityLabel: string;
  maturityTurn: number;
  turnsRemaining: number;
  marketPrice: number;
  totalValue: number;
  defaulted: boolean;
  brandColor?: string;
  currencyCode?: CurrencyCode;
}

export function StocksTable({
  holdings,
  showCostBasis = true,
}: {
  holdings: Holding[];
  /** Own-portfolio view shows avg cost + unrealized P&L; the read-only
   * per-character view doesn't have that data, so it hides both columns. */
  showCostBasis?: boolean;
}) {
  const { formatAmount, formatPrice: sp, toInternalFrom } = useCurrency();
  const norm = (value: number, ccy: CurrencyCode | undefined) =>
    ccy ? toInternalFrom(value, ccy) : value;
  const columnCount = showCostBasis ? 6 : 4;
  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-card-elevated border-b border-card-border">
            <tr>
              <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider w-[40%]">
                Corporation
              </th>
              <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right">
                Shares
              </th>
              {showCostBasis && (
                <>
                  <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right hidden sm:table-cell">
                    Avg Cost
                  </th>
                  <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right">
                    Unr. P&amp;L
                  </th>
                </>
              )}
              <th
                className={`px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right ${
                  showCostBasis ? "hidden md:table-cell" : "hidden sm:table-cell"
                }`}
              >
                Price
              </th>
              <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right">
                Value
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-card-border">
            {holdings.length === 0 ? (
              <tr>
                <td colSpan={columnCount} className="px-4 py-8 text-center text-muted">
                  No stock holdings.
                </td>
              </tr>
            ) : (
              holdings.map((h) => (
                <tr
                  key={h.corporationId}
                  className="group hover:bg-card-elevated/50 transition-colors"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/corporation/${h.sequentialId ?? h.corporationId}`}
                      className="flex items-center gap-3"
                    >
                      <div className="h-8 w-8 rounded bg-card-elevated flex items-center justify-center border border-card-border shrink-0 overflow-hidden">
                        <CorporationLogo
                          logoUrl={h.logoUrl}
                          name={h.corporationName}
                          size="h-8 w-8"
                          className="rounded"
                        />
                      </div>
                      <span className="font-bold text-foreground group-hover:text-primary transition-colors truncate">
                        {h.corporationName}
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {h.shares.toLocaleString("en-US")}
                  </td>
                  {showCostBasis && (
                    <>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-muted hidden sm:table-cell">
                        {h.avgCostPerShare != null
                          ? sp(norm(h.avgCostPerShare, h.currencyCode), h.currencyCode)
                          : "—"}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-mono tabular-nums ${
                          h.unrealizedPnl == null
                            ? "text-muted"
                            : h.unrealizedPnl >= 0
                              ? "text-success"
                              : "text-error"
                        }`}
                      >
                        {h.unrealizedPnl != null ? (
                          <>
                            {h.unrealizedPnl >= 0 ? "+" : ""}
                            {formatAmount(norm(h.unrealizedPnl, h.currencyCode), h.currencyCode)}
                            {h.unrealizedPnlPct != null && (
                              <span className="block text-[10px] opacity-75">
                                {h.unrealizedPnlPct >= 0 ? "+" : ""}
                                {h.unrealizedPnlPct}%
                              </span>
                            )}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                    </>
                  )}
                  <td
                    className={`px-4 py-3 text-right font-mono tabular-nums ${
                      showCostBasis ? "hidden md:table-cell" : "hidden sm:table-cell"
                    }`}
                  >
                    {sp(norm(h.sharePrice, h.currencyCode), h.currencyCode)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold tabular-nums">
                    {formatAmount(norm(h.totalValue, h.currencyCode), h.currencyCode)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function BondsTable({
  bondHoldings,
  totalBondIncomePerTurn,
}: {
  bondHoldings: BondHolding[];
  totalBondIncomePerTurn: number;
}) {
  const { formatAmount, toInternalFrom } = useCurrency();
  const norm = (value: number, ccy: CurrencyCode | undefined) =>
    ccy ? toInternalFrom(value, ccy) : value;
  return (
    <>
      {totalBondIncomePerTurn > 0 && (
        <div className="rounded-xl border border-success/20 bg-success/5 px-4 py-3 flex items-center justify-between">
          <span className="text-xs text-muted">Income per turn from bond coupons</span>
          <span className="text-sm font-bold text-success tabular-nums">
            +{formatAmount(totalBondIncomePerTurn)}
          </span>
        </div>
      )}
      <div className="rounded-xl border border-card-border bg-card overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-card-elevated border-b border-card-border">
              <tr>
                <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider w-[30%]">
                  Bond
                </th>
                <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right">
                  Units
                </th>
                <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right hidden sm:table-cell">
                  Coupon
                </th>
                <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right hidden sm:table-cell">
                  Maturity
                </th>
                <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right">
                  Value
                </th>
                <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {bondHoldings.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted">
                    No bond holdings.
                  </td>
                </tr>
              ) : (
                bondHoldings.map((b) => (
                  <tr key={b.bondId} className="group hover:bg-card-elevated/50 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/bond/${b.bondId}`} className="flex items-center gap-3">
                        <span className="font-bold text-foreground group-hover:text-primary transition-colors truncate">
                          {b.corporationName}
                        </span>
                        {b.defaulted && (
                          <span className="text-[9px] bg-error/10 text-error px-1.5 py-0.5 rounded border border-error/20 font-bold uppercase">
                            Defaulted
                          </span>
                        )}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {b.units.toLocaleString("en-US")}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums hidden sm:table-cell">
                      {b.couponRate.toFixed(2)}%
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums hidden sm:table-cell">
                      {b.turnsRemaining} turns
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold tabular-nums">
                      {formatAmount(norm(b.totalValue, b.currencyCode), b.currencyCode)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/bond/${b.bondId}`}
                        className="text-xs font-medium text-primary hover:underline"
                      >
                        Trade
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
