"use client";

import { Button } from "@/components/ui/Button";
import type { PoliticalMetricsCountryId } from "@/lib/politicalMetrics/types";
import { statusTextClass } from "./tones";

/** "Georgia is 2 points below the national score of 70." */
function comparisonSentence(name: string, gap: number, label: string, value: number): string {
  if (gap === 0) return `${name} matches the ${label} score of ${value}.`;
  const points = Math.abs(gap) === 1 ? "point" : "points";
  const side = gap > 0 ? "above" : "below";
  return `${name} is ${Math.abs(gap)} ${points} ${side} the ${label} score of ${value}.`;
}

/**
 * Registry page header, shared by the national page and the region tab: the
 * name, one line of context, the compare control, and the headline, which is
 * the overall condition as a large figure with its status word and one line
 * saying what it is. The header is the page's one surface change; every
 * section below it sits on the page background.
 *
 * `countryId`, `registryLabel` and `glyph` are still accepted because the
 * region tab passes them, but the plain header prints no registry line, badge
 * or per-country chrome.
 */
export function Masthead({
  countryDisplayName,
  overall,
  overallStatus,
  year,
  turn,
  onCompare,
  compareLabel = "Compare",
  sealLabel,
  comparison,
}: {
  /** @deprecated Not printed. */
  countryId?: PoliticalMetricsCountryId;
  countryDisplayName: string;
  overall: number;
  overallStatus: string;
  year: number;
  turn: number;
  onCompare: () => void;
  /** Text on the compare button. */
  compareLabel?: string;
  /** @deprecated Not printed. */
  registryLabel?: string;
  /** Region scope: the country and region type, printed ahead of the date line. */
  sealLabel?: string;
  /** @deprecated Not printed. */
  glyph?: string;
  /** Region scope: the country figure the region's own is measured against. */
  comparison?: { label: string; value: number };
}) {
  const shown = Math.round(overall);
  // Differenced from the ROUNDED figures either side of it, not the exact ones.
  // The headline shows 68 and the comparison 70, so a gap of 2.4 taken from
  // 67.6 and 70.0 would put three numbers on the page that do not add up.
  const comparedTo = comparison ? Math.round(comparison.value) : 0;
  return (
    <header className="rounded-lg border border-card-border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="break-words text-display font-bold leading-tight tracking-tight text-foreground sm:text-4xl">
            {countryDisplayName}
          </h1>
          <p className="mt-1 text-body-lg text-muted">
            {sealLabel ? `${sealLabel} · ` : ""}Political metrics · {year} · Turn{" "}
            {turn.toLocaleString("en-US")}
          </p>
        </div>
        <Button variant="secondary" onClick={onCompare} className="shrink-0">
          {compareLabel}
        </Button>
      </div>

      <div className="mt-6 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-5xl font-semibold leading-none tabular-nums text-foreground">
          {shown}
        </span>
        <span className={`text-heading-lg font-semibold ${statusTextClass(overallStatus)}`}>
          {overallStatus}
        </span>
      </div>
      <p className="mt-2 text-body-lg text-muted">
        Overall condition: the mean of the nine category scores, out of 100.
      </p>
      {comparison && (
        <p className="mt-1 text-body-lg text-muted">
          {comparisonSentence(countryDisplayName, shown - comparedTo, comparison.label, comparedTo)}
        </p>
      )}
    </header>
  );
}
