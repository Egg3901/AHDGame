"use client";

import Link from "next/link";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { economyUrl } from "@/lib/urls";

interface StateMacroHeaderProps {
  countryId: CountryId | string;
  stateName: string;
  /** Pre-formatted gross state product (local currency, e.g. "$1.82T"). */
  gdpDisplay: string;
  /** This state's GDP-growth metric (%/yr), null when metrics are missing. */
  stateGdpGrowth: number | null;
  /** Population-weighted national GDP growth (%/yr), null when unavailable. */
  nationalGdpGrowth: number | null;
  /** Label of the largest sector by market size, null while loading. */
  topSectorLabel: string | null;
}

function signed(value: number, digits = 1): string {
  const fixed = value.toFixed(digits);
  return value > 0 ? `+${fixed}` : fixed;
}

/**
 * Compact macro context row above the sector board: gross state/province
 * product, growth chip, vs-national chip, top sector, and the hop up to the
 * national Economic Outlook. Direction is never color-only — chips pair
 * polarity-aware success/error with ▲▼ glyphs (Metrics trend encoding).
 */
export function StateMacroHeader({
  countryId,
  stateName,
  gdpDisplay,
  stateGdpGrowth,
  nationalGdpGrowth,
  topSectorLabel,
}: StateMacroHeaderProps) {
  const config = COUNTRY_CONFIGS[(countryId as string).toUpperCase() as CountryId];
  const regionLabel = config?.regionLabel ?? "State";
  const vsNational =
    stateGdpGrowth != null && nationalGdpGrowth != null
      ? Math.round((stateGdpGrowth - nationalGdpGrowth) * 100) / 100
      : null;

  return (
    <div className="flex flex-wrap items-center gap-x-7 gap-y-4 rounded-xl border border-card-border bg-card px-5 py-4 shadow-sm">
      <div className="min-w-[160px]">
        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
          {regionLabel} Economy · {stateName}
        </div>
        <div className="mt-0.5 font-mono text-2xl font-bold leading-tight tabular-nums text-foreground">
          {gdpDisplay}
        </div>
        <div className="text-[11px] text-muted">
          Gross {regionLabel.toLowerCase()} product · local currency
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {stateGdpGrowth != null && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-xs font-bold tabular-nums ${
              stateGdpGrowth >= 0
                ? "border-success/30 bg-success/10 text-success"
                : "border-error/30 bg-error/10 text-error"
            }`}
          >
            {signed(stateGdpGrowth)}% {stateGdpGrowth >= 0 ? "▲" : "▼"}
            <span className="font-sans text-[11px] font-medium opacity-75">growth /yr</span>
          </span>
        )}
        {vsNational != null && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-xs font-bold tabular-nums ${
              vsNational >= 0
                ? "border-success/30 bg-success/10 text-success"
                : "border-error/30 bg-error/10 text-error"
            }`}
            title={`This ${regionLabel.toLowerCase()}'s GDP growth vs. the population-weighted national average`}
          >
            {signed(vsNational)}pp {vsNational >= 0 ? "▲" : "▼"}
            <span className="font-sans text-[11px] font-medium opacity-75">vs national</span>
          </span>
        )}
        {topSectorLabel && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-card-border bg-card-muted px-2.5 py-1 text-xs text-muted">
            Top sector <strong className="font-semibold text-foreground">{topSectorLabel}</strong>
          </span>
        )}
      </div>
      <Link
        href={economyUrl(countryId)}
        className="ml-auto whitespace-nowrap text-xs font-semibold text-primary hover:underline"
      >
        National Economic Outlook &rarr;
      </Link>
    </div>
  );
}
