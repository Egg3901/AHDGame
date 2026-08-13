"use client";

import type { FyHistoryPoint } from "@/lib/publicFinance/queries/federalBudgetDetail";
import type { CreditRating } from "@/lib/db/types/budget";
import { formatFundsCompact1dp } from "@/lib/utils/formatters";
import { Delta, StatTile, type TreasuryTone } from "./primitives";

function pctSign(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function debtTone(ratio: number): TreasuryTone {
  if (ratio > 1.2) return "down";
  if (ratio > 0.8) return "warning";
  return "up";
}

export interface FiscalStatStripProps {
  /** Local currency symbol (e.g. "¥", "$"). */
  sym: string;
  revenue: number;
  spending: number;
  gdp: number;
  /**
   * `economicFactors.gdpGrowth`: the growth rate the budget projects revenue
   * off. It is NOT the live rate. `fiscalYear.ts` copies the pipeline figure
   * into it once per in-game year at rollover and it then holds for the whole
   * fiscal year, so it can sit points away from the live rate on the Economy
   * page. Labelled as an assumption for exactly that reason.
   */
  gdpGrowth: number;
  /** Debt-to-GDP ratio (0–n, not %). */
  debtToGdp: number;
  rating: CreditRating;
  /** Signed national treasury balance (local currency); negative = national debt. */
  treasuryReserve: number;
  /** Compare mode: show vs-prior-FY delta chips. */
  compare?: boolean;
  /** Prior fiscal year point (for compare deltas); null when unavailable. */
  prev?: FyHistoryPoint | null;
  /**
   * Optional era-dollar equivalent of a local-currency amount. When this
   * returns a number, money tiles show `≈ $X` so a US player reading a
   * Soviet (or yen, etc.) budget does not compare ₽565B to $100B as if
   * both were dollars (ticket-1065).
   */
  toUsd?: (localAmount: number) => number | null;
}

/**
 * The fiscal stat strip under the treasury masthead — the prototype's six tiles
 * (Revenue, Spending, Surplus/Deficit, Debt-to-GDP, Credit rating, GDP) plus the
 * live Treasury Balance. Local currency throughout; compare drops vs-prior-FY
 * delta chips. Inherits `ahd-design-system` tokens.
 */
export function FiscalStatStrip({
  sym,
  revenue,
  spending,
  gdp,
  gdpGrowth,
  debtToGdp,
  rating,
  treasuryReserve,
  compare = false,
  prev,
  toUsd,
}: FiscalStatStripProps) {
  const surplus = revenue - spending;
  const prevSurplus = prev ? prev.revenue - prev.spending : null;
  const deficitToGdp = gdp > 0 ? (surplus / gdp) * 100 : 0;
  const money = (n: number) => formatFundsCompact1dp(n, sym);
  const usdNote = (local: number, existing?: string): string | undefined => {
    if (!toUsd) return existing;
    const usd = toUsd(local);
    if (usd == null) return existing;
    const note = `≈ ${formatFundsCompact1dp(usd, "$")}`;
    return existing ? `${existing} · ${note}` : note;
  };

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden bg-card-border sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-7">
      <StatTile
        label="Revenue"
        value={money(revenue)}
        sub={usdNote(revenue)}
        delta={
          compare ? <Delta now={revenue} prev={prev?.revenue} kind="money" sym={sym} /> : undefined
        }
      />
      <StatTile
        label="Spending"
        value={money(spending)}
        sub={usdNote(spending)}
        delta={
          compare ? (
            <Delta now={spending} prev={prev?.spending} kind="money" sym={sym} invert />
          ) : undefined
        }
      />
      <StatTile
        label={surplus >= 0 ? "Surplus" : "Deficit"}
        value={money(Math.abs(surplus))}
        tone={surplus >= 0 ? "up" : "down"}
        sub={usdNote(surplus, `${deficitToGdp.toFixed(1)}% of GDP`)}
        delta={
          compare ? <Delta now={surplus} prev={prevSurplus} kind="money" sym={sym} /> : undefined
        }
      />
      <StatTile
        label="Debt-to-GDP"
        value={`${(debtToGdp * 100).toFixed(1)}%`}
        tone={debtTone(debtToGdp)}
        delta={
          compare ? (
            <Delta
              now={debtToGdp * 100}
              prev={prev ? prev.debtToGdp * 100 : null}
              kind="pct"
              invert
            />
          ) : undefined
        }
      />
      <StatTile label="Credit rating" value={rating} tone="gold" />
      <StatTile
        label="GDP"
        value={money(gdp)}
        sub={
          <span
            title={
              "Growth assumption for this fiscal year, fixed at the last rollover. " +
              "The budget projects revenue off it, so it does not move between rollovers. " +
              "For the current rate, see the Economy page."
            }
          >
            {usdNote(gdp, `${pctSign(gdpGrowth)} FY assumption`)}
          </span>
        }
        delta={compare ? <Delta now={gdp} prev={prev?.gdp} kind="money" sym={sym} /> : undefined}
      />
      <StatTile
        label="Treasury Balance"
        value={money(Math.abs(treasuryReserve))}
        tone={treasuryReserve < 0 ? "down" : "foreground"}
        sub={usdNote(treasuryReserve, treasuryReserve < 0 ? "national debt" : "in surplus")}
      />
    </div>
  );
}
