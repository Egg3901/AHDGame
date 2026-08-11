"use client";

import type { CurrencyCode } from "@/lib/constants/currencies";

type Slice = {
  key: "equity" | "cash" | "bond";
  label: string;
  color: string; // CSS var or hex
  amountAnchor: number;
};

const TOKEN_COLOR: Record<Slice["key"], string> = {
  equity: "var(--secondary)",
  cash: "var(--success)",
  bond: "var(--gold)",
};

/**
 * Stacked bar + legend summarising how the fund's assets are split between
 * equity, cash, and bond reserves. Inputs are anchor-currency amounts; the
 * caller is responsible for the FX formatting pass.
 */
export function AssetCompositionBar({
  holdingsValueAnchor,
  cashAnchor,
  bondPrincipalAnchor,
  formatAmount,
  ccy,
}: {
  holdingsValueAnchor: number;
  cashAnchor: number;
  bondPrincipalAnchor: number;
  formatAmount: (n: number, c?: CurrencyCode) => string;
  ccy: CurrencyCode;
}) {
  const slices: Slice[] = [
    {
      key: "equity",
      label: "Equity holdings",
      color: TOKEN_COLOR.equity,
      amountAnchor: holdingsValueAnchor,
    },
    { key: "cash", label: "Cash & equivalents", color: TOKEN_COLOR.cash, amountAnchor: cashAnchor },
    {
      key: "bond",
      label: "Bond reserve",
      color: TOKEN_COLOR.bond,
      amountAnchor: bondPrincipalAnchor,
    },
  ];

  const total = slices.reduce((s, x) => s + Math.max(0, x.amountAnchor), 0);
  const safeTotal = total > 0 ? total : 1;

  return (
    <div>
      <div
        className="flex h-3.5 overflow-hidden rounded-full bg-track"
        role="img"
        aria-label="Asset composition"
      >
        {slices.map((s) => {
          const pct = (Math.max(0, s.amountAnchor) / safeTotal) * 100;
          if (pct <= 0) return null;
          return (
            <div
              key={s.key}
              style={{ width: `${pct}%`, background: s.color }}
              title={`${s.label}: ${pct.toFixed(1)}%`}
            />
          );
        })}
      </div>
      <ul className="mt-4 space-y-2.5">
        {slices.map((s) => {
          const pct = (Math.max(0, s.amountAnchor) / safeTotal) * 100;
          return (
            <li key={s.key} className="flex items-center gap-2.5 text-xs">
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-sm"
                style={{ background: s.color }}
                aria-hidden
              />
              <span className="flex-1">{s.label}</span>
              <span className="font-mono tabular-nums text-muted">{pct.toFixed(1)}%</span>
              <span className="w-[80px] text-right font-mono tabular-nums font-semibold">
                {formatAmount(Math.max(0, s.amountAnchor), ccy)}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex items-center justify-between border-t border-card-border pt-3 text-xs">
        <span className="text-muted">Total backing</span>
        <span className="font-mono tabular-nums font-bold">{formatAmount(total, ccy)}</span>
      </div>
    </div>
  );
}
