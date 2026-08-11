"use client";

import Link from "next/link";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { centralBankUrl } from "@/lib/urls";

export interface LocSnapshot {
  outstandingInternal: number;
  availableBorrowInternal: number;
  dtiLimitInternal: number;
  netWorthLimitInternal: number;
  perPlayerLimitInternal: number;
  perPlayerAvailableInternal: number;
  effectiveRatePercent: number;
  homePrimePercent: number;
  spreadPercentPoints: number;
  composite: number;
  incomePerTurnFace: number;
  drawFrozen: boolean;
  balances: Partial<Record<CurrencyCode, number>>;
  arrears: Partial<Record<CurrencyCode, number>>;
  accountsOpened: Partial<Record<CurrencyCode, boolean>>;
  garnishedPerTurnInternal?: number;
  paymentMode?: Partial<Record<CurrencyCode, "pi" | "io">>;
}

export function LoansPane({
  snapshot,
  countryId,
  homeCurrency,
}: {
  snapshot: LocSnapshot;
  countryId: string;
  homeCurrency: CurrencyCode | null;
}) {
  const { formatAmount } = useCurrency();
  const s = snapshot;
  const hasOutstanding = s.outstandingInternal > 0;
  const noIncome = s.incomePerTurnFace <= 0;
  const managePath = `${centralBankUrl(countryId)}?tab=loc`;
  const spreadSign = s.spreadPercentPoints >= 0 ? "+" : "";

  if (!hasOutstanding && !Object.values(s.accountsOpened).some(Boolean)) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6 text-center space-y-3 shadow-sm">
        <p className="text-sm font-semibold text-foreground">No active loan</p>
        <p className="text-xs text-muted">
          Open a line of credit at your home central bank. Requires bond income, a CEO salary, or
          dividends to qualify.
        </p>
        {homeCurrency && (
          <Link
            href={managePath}
            className="inline-block rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90"
          >
            Open at {countryId.toUpperCase()} central bank →
          </Link>
        )}
      </div>
    );
  }

  const usedPct =
    s.perPlayerLimitInternal > 0
      ? Math.min(1, s.outstandingInternal / s.perPlayerLimitInternal)
      : 0;

  return (
    <div className="space-y-4">
      {/* Summary card */}
      <div className="rounded-xl border border-card-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted font-semibold mb-1">
              Your Rate
            </p>
            <p className="text-2xl font-bold text-foreground tabular-nums">
              {s.effectiveRatePercent.toFixed(2)}% p.a.
            </p>
            <p className="text-xs text-muted mt-0.5">
              policy {s.homePrimePercent.toFixed(2)}% {spreadSign}
              {s.spreadPercentPoints.toFixed(2)}% spread
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-widest text-muted font-semibold mb-1">
              Outstanding
            </p>
            <p className="text-2xl font-bold text-error tabular-nums">
              {formatAmount(s.outstandingInternal)}
            </p>
            {s.drawFrozen && (
              <p className="text-xs font-semibold text-warning mt-0.5">Draws frozen</p>
            )}
          </div>
        </div>

        {/* DTI usage bar */}
        {!noIncome && (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-muted mb-1.5">
              <span>Credit used ({(usedPct * 100).toFixed(0)}%)</span>
              <span>
                Limit {formatAmount(s.perPlayerLimitInternal)} · available{" "}
                <span className="font-semibold text-foreground">
                  {formatAmount(s.perPlayerAvailableInternal)}
                </span>
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-card-elevated overflow-hidden">
              <div
                className={`h-full rounded-full ${usedPct >= 0.9 ? "bg-error" : usedPct >= 0.7 ? "bg-warning" : "bg-primary"}`}
                style={{ width: `${(usedPct * 100).toFixed(1)}%` }}
              />
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 text-[10px] text-muted tabular-nums">
              <span>
                Income cap:{" "}
                <span
                  className={
                    s.dtiLimitInternal <= s.netWorthLimitInternal
                      ? "font-medium text-foreground"
                      : ""
                  }
                >
                  {formatAmount(s.dtiLimitInternal)}
                </span>
              </span>
              <span>
                Equity cap:{" "}
                <span
                  className={
                    s.netWorthLimitInternal < s.dtiLimitInternal
                      ? "font-medium text-foreground"
                      : ""
                  }
                >
                  {formatAmount(s.netWorthLimitInternal)}
                </span>
              </span>
            </div>
          </div>
        )}

        {noIncome && (
          <div className="mt-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
            No qualifying income — bond coupons, CEO salary, or dividends required to borrow.
          </div>
        )}

        {(s.garnishedPerTurnInternal ?? 0) > 0 && (
          <div className="mt-3 rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-xs">
            <span className="font-semibold text-error">Garnishment active</span>
            <span className="ml-1.5 text-muted">
              Your account is in distress. ~{formatAmount(s.garnishedPerTurnInternal!)}/turn of bond
              coupon income is captured automatically to service this debt before reaching your
              wallet.
            </span>
          </div>
        )}
      </div>

      {/* Per-currency balances */}
      {hasOutstanding && (
        <div className="rounded-xl border border-card-border bg-card overflow-hidden shadow-sm">
          <div className="bg-card-elevated px-4 py-3 border-b border-card-border">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted">Balances</p>
          </div>
          <div className="divide-y divide-card-border">
            {Object.entries(s.balances)
              .filter(([, v]) => (v ?? 0) > 0)
              .map(([ccy, bal]) => {
                const arr = s.arrears[ccy as CurrencyCode] ?? 0;
                return (
                  <div
                    key={ccy}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="font-semibold text-foreground">{ccy}</span>
                      {s.paymentMode?.[ccy as CurrencyCode] === "io" && (
                        <span
                          className="rounded border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-warning"
                          title="Interest-only — principal stays flat until switched back to P/I"
                        >
                          I/O
                        </span>
                      )}
                    </span>
                    <div className="flex gap-4 tabular-nums">
                      <span>
                        Principal{" "}
                        <span className="font-medium text-error">
                          {(bal ?? 0).toLocaleString("en-US")}
                        </span>
                      </span>
                      {arr > 0 && (
                        <span>
                          Arrears{" "}
                          <span className="font-medium text-warning">
                            {arr.toLocaleString("en-US")}
                          </span>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      <Link
        href={managePath}
        className="inline-flex items-center gap-1 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/10"
      >
        Manage loan →
      </Link>
    </div>
  );
}
