"use client";

import Link from "next/link";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { formatGDP, formatCurrencyCompactChip } from "@/lib/utils/formatters";
import { getCurrencyPrefix } from "@/lib/utils/budgetCalculations";
import { budgetUrl } from "@/lib/urls";
import { Sparkline } from "@/components/metrics/Sparkline";

interface HistoryPoint {
  turn: number;
  rate: number;
}

export interface PulseData {
  gdpMillions: number;
  gdpPerCapita: number;
  gdpGrowth: { value: number | null; history: HistoryPoint[] };
  inflation: { value: number | null; target: number; history: HistoryPoint[] };
  primeRate: {
    value: number | null;
    heldTurns: number | null;
    neutral: number;
    history: HistoryPoint[];
  };
  credit: { rating: string | null; debtToGdpRatio: number | null };
}

interface PulseStripProps {
  countryId: CountryId | string;
  pulse: PulseData;
}

function signed(value: number, digits = 1): string {
  const fixed = value.toFixed(digits);
  return value > 0 ? `+${fixed}` : fixed;
}

/** Direction glyph from the last two history points; null when flat/unknown. */
function historyDirection(history: HistoryPoint[]): "up" | "down" | null {
  if (history.length < 2) return null;
  const last = history[history.length - 1].rate;
  const prev = history[history.length - 2].rate;
  if (last > prev) return "up";
  if (last < prev) return "down";
  return null;
}

function Cell({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1 px-4 py-3.5 ${className}`}>
      <span className="whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * The five-cell pulse strip — GDP, GDP growth (central-bank hero figure),
 * inflation vs target, prime rate, credit standing — with the existing-history
 * sparklines. Direction is never color-only: polarity-aware success/error
 * always pairs with ▲▼ glyphs. Lives inside the EconomyMasthead, in the same
 * position as Budget's fiscal stat strip and Metrics' headline tiles.
 */
export function PulseStrip({ countryId, pulse }: PulseStripProps) {
  const config = COUNTRY_CONFIGS[(countryId as string).toUpperCase() as CountryId];
  const prefix = getCurrencyPrefix(countryId as CountryId);
  const regionWord = (config?.regionLabel ?? "State").toLowerCase();

  const growth = pulse.gdpGrowth.value;
  const inflation = pulse.inflation.value;
  const inflationDir = historyDirection(pulse.inflation.history);
  // Polarity: inflation reads healthy within ±1pp of target, bad outside it.
  const inflationGood = inflation != null && Math.abs(inflation - pulse.inflation.target) <= 1;
  const prime = pulse.primeRate.value;
  const primeDir = historyDirection(pulse.primeRate.history);

  return (
    <div className="grid grid-cols-2 divide-x divide-card-border bg-card-muted/60 lg:grid-cols-5">
      <Cell label="Gross Domestic Product" className="col-span-2 lg:col-span-1">
        <span className="font-mono text-lg font-bold leading-tight tabular-nums text-foreground">
          {pulse.gdpMillions > 0 ? formatGDP(pulse.gdpMillions, prefix) : "—"}
        </span>
        <span className="text-[11px] text-muted">
          per capita{" "}
          <span className="font-mono font-semibold text-foreground">
            {pulse.gdpPerCapita > 0 ? formatCurrencyCompactChip(pulse.gdpPerCapita, prefix) : "—"}
          </span>{" "}
          · {regionWord}-aggregated
        </span>
      </Cell>

      <Cell label="GDP Growth">
        <span
          className={`font-mono text-lg font-bold leading-tight tabular-nums ${
            growth == null ? "text-muted" : growth >= 0 ? "text-success" : "text-error"
          }`}
        >
          {growth != null ? (
            <>
              {signed(growth)}% {growth >= 0 ? "▲" : "▼"}
            </>
          ) : (
            "—"
          )}
        </span>
        <span className="text-[11px] text-muted">central bank · /yr</span>
        {pulse.gdpGrowth.history.length > 1 && (
          <Sparkline data={pulse.gdpGrowth.history.map((p) => p.rate)} w={116} h={26} />
        )}
      </Cell>

      <Cell label="Inflation">
        <span
          className={`font-mono text-lg font-bold leading-tight tabular-nums ${
            inflation == null ? "text-muted" : inflationGood ? "text-success" : "text-error"
          }`}
        >
          {inflation != null ? (
            <>
              {inflation.toFixed(1)}%{inflationDir && ` ${inflationDir === "up" ? "▲" : "▼"}`}
            </>
          ) : (
            "—"
          )}
        </span>
        <span className="text-[11px] text-muted">target {pulse.inflation.target.toFixed(1)}%</span>
        {pulse.inflation.history.length > 1 && (
          <Sparkline data={pulse.inflation.history.map((p) => p.rate)} w={116} h={26} />
        )}
      </Cell>

      <Cell label="Prime Rate">
        <span className="font-mono text-lg font-bold leading-tight tabular-nums text-foreground">
          {prime != null ? (
            <>
              {prime.toFixed(2)}%{" "}
              <span className="text-[11px] font-bold text-muted">
                {primeDir ? (primeDir === "up" ? "▲" : "▼") : "──"}
              </span>
            </>
          ) : (
            "—"
          )}
        </span>
        <span className="text-[11px] text-muted">
          neutral ≈ {pulse.primeRate.neutral.toFixed(0)}%
          {pulse.primeRate.heldTurns != null && <> · held {pulse.primeRate.heldTurns}t</>}
        </span>
        {pulse.primeRate.history.length > 1 && (
          <Sparkline data={pulse.primeRate.history.map((p) => p.rate)} w={116} h={26} />
        )}
      </Cell>

      <Cell label="Credit Standing">
        <span className="font-mono text-lg font-bold leading-tight">
          <span style={{ color: "var(--stat, var(--primary))" }}>{pulse.credit.rating ?? "—"}</span>{" "}
          {pulse.credit.debtToGdpRatio != null && (
            <span className="text-[11px] font-bold text-muted">
              {Math.round(pulse.credit.debtToGdpRatio)}% debt-to-GDP
            </span>
          )}
        </span>
        <Link
          href={budgetUrl(countryId)}
          className="mt-auto text-[11px] font-semibold text-primary hover:underline"
        >
          National Budget &rarr;
        </Link>
      </Cell>
    </div>
  );
}

export default PulseStrip;
