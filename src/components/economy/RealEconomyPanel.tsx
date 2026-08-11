"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { budgetUrl, metricsUrl, policyUrl } from "@/lib/urls";
import { POLITICAL_METRIC_COUNTRY_IDS } from "@/lib/politicalMetrics/types";

interface RealEconomyData {
  wageGrowth: number | null;
  tradeGrowth: number | null;
  unemployment: { value: number | null; trend: number | null };
  medianIncome: { value: number | null; trend: number | null };
  /** Total national population (sum of region populations). */
  population: number | null;
}

interface RealEconomyPanelProps {
  countryId: CountryId | string;
  realEconomy: RealEconomyData;
  /** GDP per capita, base local-currency units (pulse figure). */
  gdpPerCapita: number | null;
  /** Formats a local-currency income value. */
  formatIncome: (value: number) => string;
}

function signed(value: number, digits = 1): string {
  const fixed = value.toFixed(digits);
  return value > 0 ? `+${fixed}` : fixed;
}

/**
 * Delta chip: glyph follows direction, color follows good/bad per the
 * metric's polarity (the Metrics trend encoding) — never color-only.
 */
function DeltaChip({
  delta,
  unit,
  higherIsBetter,
}: {
  delta: number;
  unit: string;
  higherIsBetter: boolean;
}) {
  const good = higherIsBetter ? delta >= 0 : delta <= 0;
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[10.5px] font-bold tabular-nums ${
        good
          ? "border-success/30 bg-success/10 text-success"
          : "border-error/30 bg-error/10 text-error"
      }`}
    >
      {signed(delta)}
      {unit} {delta >= 0 ? "▲" : "▼"}
    </span>
  );
}

function Row({
  label,
  note,
  link,
  value,
  chip,
}: {
  label: string;
  note: string;
  link?: ReactNode;
  value: string;
  chip?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 border-t border-card-border/60 py-2.5 first:border-t-0">
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-semibold text-foreground">{label}</div>
        <div className="mt-0.5 text-[10px] text-muted">
          {note}
          {link ? <> · {link}</> : null}
        </div>
      </div>
      <span className="font-mono text-sm font-bold tabular-nums text-foreground">{value}</span>
      {chip}
    </div>
  );
}

/**
 * Real-economy detail rows: wage growth, trade growth (surfaced for the first
 * time), and the state/province-weighted unemployment + median income — each
 * one hop from its source surface (Budget, National Policy, Metrics rankings).
 */
export function RealEconomyPanel({
  countryId,
  realEconomy,
  gdpPerCapita,
  formatIncome,
}: RealEconomyPanelProps) {
  const upper = (countryId as string).toUpperCase();
  const config = COUNTRY_CONFIGS[upper as CountryId];
  const regionWord = (config?.regionLabel ?? "State").toLowerCase();
  const regionRankings = `${config?.regionLabel ?? "State"} rankings`;

  const linkClass = "font-semibold text-primary hover:underline";
  // SP6: playables' /metrics redirects to the registry — the ranking link
  // would mislead there, so the metric rows drop their link for them.
  const hasLegacyMetricsPage = !(POLITICAL_METRIC_COUNTRY_IDS as readonly string[]).includes(upper);
  const rankingsLink = hasLegacyMetricsPage ? (
    <Link
      href={metricsUrl(countryId)}
      className={linkClass}
      title={`Best/worst ${regionWord}s on the National Metrics page, Economic tab`}
    >
      {regionRankings} &rarr;
    </Link>
  ) : undefined;

  return (
    <div className="rounded-xl border border-card-border bg-card px-5 py-4 shadow-sm">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-bold text-foreground">Real Economy</h3>
        <span className="text-[10px] text-muted">
          budget factors + {regionWord}-weighted metrics
        </span>
      </div>
      <div className="mt-2.5">
        <Row
          label="Wage growth"
          note="budget economic factors · /yr"
          link={
            <Link
              href={budgetUrl(countryId)}
              className={linkClass}
              title="Wage growth feeds the income-tax base — full fiscal context on the Budget page"
            >
              National Budget &rarr;
            </Link>
          }
          value={realEconomy.wageGrowth != null ? `${signed(realEconomy.wageGrowth)}%` : "—"}
          chip={
            realEconomy.wageGrowth != null && (
              <DeltaChip delta={realEconomy.wageGrowth} unit="%" higherIsBetter />
            )
          }
        />
        <Row
          label="Trade growth"
          note="imports + exports · /yr"
          link={
            <Link
              href={policyUrl(countryId)}
              className={linkClass}
              title="Trade growth reflects tariff and FTA policy — see National Policy"
            >
              Tariffs &amp; trade &rarr;
            </Link>
          }
          value={realEconomy.tradeGrowth != null ? `${signed(realEconomy.tradeGrowth)}%` : "—"}
          chip={
            realEconomy.tradeGrowth != null && (
              <DeltaChip delta={realEconomy.tradeGrowth} unit="%" higherIsBetter />
            )
          }
        />
        <Row
          label="Unemployment"
          note={`${regionWord}-weighted national metric`}
          link={rankingsLink}
          value={
            realEconomy.unemployment.value != null
              ? `${realEconomy.unemployment.value.toFixed(1)}%`
              : "—"
          }
          chip={
            realEconomy.unemployment.trend != null && (
              <DeltaChip delta={realEconomy.unemployment.trend} unit="pp" higherIsBetter={false} />
            )
          }
        />
        <Row
          label="Median income"
          note={`${regionWord}-weighted national metric`}
          link={rankingsLink}
          value={
            realEconomy.medianIncome.value != null
              ? formatIncome(realEconomy.medianIncome.value)
              : "—"
          }
          chip={
            realEconomy.medianIncome.trend != null && (
              <DeltaChip delta={realEconomy.medianIncome.trend} unit="%" higherIsBetter />
            )
          }
        />
        <Row
          label="GDP per capita"
          note="nominal · national"
          value={gdpPerCapita != null ? formatIncome(gdpPerCapita) : "—"}
        />
        <Row
          label="Population"
          note={`sum of ${regionWord} populations`}
          value={
            realEconomy.population != null ? `${(realEconomy.population / 1e6).toFixed(1)}M` : "—"
          }
        />
      </div>
    </div>
  );
}

export default RealEconomyPanel;
