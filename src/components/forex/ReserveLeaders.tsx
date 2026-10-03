"use client";

import type { ReserveLeaderDisplay } from "@/app/country/[code]/forex/types";
import { useCurrency } from "@/contexts/CurrencyContext";
import { formatCurrencyFaceAmount } from "@/lib/currency/formatCurrencyFaceAmount";
import { CountryFlag } from "@/components/CountryFlag";
import { CURRENCY_NAMES, CURRENCY_FLAG_CODE } from "@/components/forex/currencyDisplay";

interface Props {
  leaders: ReserveLeaderDisplay[];
}

/** Format a volatility reduction (0.5 → "−50%"); trims trailing .0 (12.5 stays). */
function formatReductionPct(reduction: number): string {
  const pct = reduction * 100;
  return `−${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`;
}

/**
 * Full reserve-currency league table by FX reserve volume held across every
 * central bank. Shows each currency's value in the viewer's display preference
 * plus the actual units held. The top three earn a rank-based safe-haven buff
 * (#1 −50%, #2 −25%, #3 −12.5% per-turn volatility), surfaced inline on each row.
 */
export function ReserveLeaders({ leaders }: Props) {
  const { formatAmount } = useCurrency();

  if (leaders.length === 0) return null;

  return (
    <div className="rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-card-border">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">Reserve currencies</h2>
          <span className="rounded-full border border-card-border px-2.5 py-0.5 text-[10px] font-medium text-muted">
            Top-3 perk · −50 / −25 / −12.5% volatility
          </span>
        </div>
        <p className="text-xs text-muted mt-1">
          Every currency ranked by FX reserves held across all central banks (a country&apos;s own
          domestic lending reserve doesn&apos;t count). The top three earn{" "}
          <span className="font-medium text-foreground/70">safe-haven status</span>: their rate
          moves less each turn (−50% for the leading exchange currency, −25% for #2, −12.5% for #3),
          so they&apos;re steadier to hold and trade.
        </p>
      </div>

      <ul className="divide-y divide-card-border">
        {leaders.map((leader) => {
          const flagCountry = (
            CURRENCY_FLAG_CODE[leader.currencyCode] ?? leader.currencyCode
          ).toUpperCase();
          const hasBuff = leader.volatilityReduction > 0;
          return (
            <li key={leader.currencyCode} className="flex items-center gap-4 px-5 py-3">
              <span
                className={`w-6 shrink-0 text-center font-mono text-sm font-bold tabular-nums ${
                  hasBuff ? "text-foreground" : "text-muted"
                }`}
              >
                {leader.rank}
              </span>
              <CountryFlag country={flagCountry} size="sm" className="shrink-0 rounded-[2px]" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-semibold text-foreground">
                    {leader.currencyCode}
                  </span>
                  <span className="truncate text-xs text-muted">
                    {CURRENCY_NAMES[leader.currencyCode] ?? leader.currencyCode}
                  </span>
                  {leader.isLeading && (
                    <span className="rounded-full border border-card-border px-2 py-0.5 text-[10px] font-medium text-muted">
                      Leading exchange currency
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                  <span>
                    {formatCurrencyFaceAmount(leader.units, leader.currencyCode)} held in reserve
                  </span>
                  {hasBuff && (
                    <span className="inline-flex items-center gap-1 font-medium text-foreground">
                      <span aria-hidden>▼</span>
                      {formatReductionPct(leader.volatilityReduction)} volatility
                    </span>
                  )}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm font-semibold tabular-nums text-foreground">
                  {formatAmount(leader.internalValue)}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-muted">Reserve value</div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
