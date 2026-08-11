"use client";

import type { CurrencyCode } from "@/lib/constants/currencies";
import { legacyAdjustedDisplayUnits } from "@/lib/indexFunds/unitAccounting";

/**
 * Compact "your position" card shown above the trade panel. P&L is derived
 * from the player's units × current NAV minus their recorded cost basis
 * (units × avg NAV). When the player holds no units, the card shows the
 * empty state instead of zero-filled numbers so the message reads as "you
 * have no position" rather than "your P&L is exactly zero".
 *
 * #857 grandfather: legacy units redeem rate-free, so every ₳ figure here uses
 * `legacyAdjustedDisplayUnits` in place of raw `units`. Without it the currency
 * layer's × rate step over-states a legacy holder's value ~100×, showing money
 * they can never redeem (the recurring source of ticket #857 confusion).
 */
export function YourPositionCard({
  units,
  legacyUnits,
  avgNavAnchor,
  navAnchor,
  fundFxRate,
  forexEnabled,
  formatAmount,
  formatPrice,
  ccy,
}: {
  units: number;
  legacyUnits: number;
  avgNavAnchor: number | null;
  navAnchor: number;
  fundFxRate: number;
  forexEnabled: boolean;
  formatAmount: (n: number, c?: CurrencyCode) => string;
  formatPrice: (n: number, c?: CurrencyCode) => string;
  ccy: CurrencyCode;
}) {
  const displayUnits = legacyAdjustedDisplayUnits({
    units,
    legacyUnits,
    fundFxRate,
    forexEnabled,
  });
  const value = displayUnits * navAnchor;
  const costBasis = displayUnits * (avgNavAnchor ?? 0);
  const avgNavDisplay = units > 0 ? (avgNavAnchor ?? 0) * (displayUnits / units) : 0;
  const plAbs = value - costBasis;
  const plUp = plAbs >= 0;
  const plPct = costBasis > 0 ? (plAbs / costBasis) * 100 : 0;

  if (units <= 0) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-4 shadow-sm">
        <h2 className="text-[13px] font-semibold">Your position</h2>
        <p className="mt-2 text-xs text-muted">
          You don&apos;t hold any units yet. Use the panel below to subscribe.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-card-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-semibold">Your position</h2>
        <span
          className="inline-flex items-center rounded-full px-2 py-0.5 font-mono tabular-nums text-[11px] font-bold"
          style={{
            color: plUp ? "var(--success)" : "var(--error)",
            background: `color-mix(in srgb, ${plUp ? "var(--success)" : "var(--error)"} 10%, transparent)`,
          }}
        >
          {plUp ? "+" : ""}
          {plPct.toFixed(1)}%
        </span>
      </div>
      <div className="mt-2.5 flex items-baseline gap-2">
        <span className="font-mono tabular-nums text-[26px] font-bold leading-none">
          {formatAmount(value, ccy)}
        </span>
        <span
          className="font-mono tabular-nums text-xs font-semibold"
          style={{ color: plUp ? "var(--success)" : "var(--error)" }}
        >
          {plUp ? "+" : ""}
          {formatAmount(plAbs, ccy)}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-6 border-t border-card-border pt-3">
        <div>
          <div className="text-[9.5px] font-semibold uppercase tracking-wider text-muted">
            Units
          </div>
          <div className="mt-0.5 font-mono tabular-nums text-[13px] font-semibold">
            {units.toLocaleString("en-US")}
          </div>
        </div>
        <div>
          <div className="text-[9.5px] font-semibold uppercase tracking-wider text-muted">
            Avg NAV paid
          </div>
          <div className="mt-0.5 font-mono tabular-nums text-[13px] font-semibold">
            {formatPrice(avgNavDisplay, ccy)}
          </div>
        </div>
        <div>
          <div className="text-[9.5px] font-semibold uppercase tracking-wider text-muted">
            Cost basis
          </div>
          <div className="mt-0.5 font-mono tabular-nums text-[13px] font-semibold">
            {formatAmount(costBasis, ccy)}
          </div>
        </div>
      </div>
    </div>
  );
}
