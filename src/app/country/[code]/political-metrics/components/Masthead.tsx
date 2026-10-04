"use client";

import { Button } from "@/components/ui/Button";
import { LiveDot } from "@/components/ui/Badge";
import { COUNTRY_CHROME } from "@/lib/politicalMetrics/names";
import type { PoliticalMetricsCountryId } from "@/lib/politicalMetrics/types";
import { scoreTone } from "./tones";

/**
 * National-registry masthead. The readout strip (registry line, live series)
 * runs across the top; below it the country name is the page title, with the
 * compare control and the statistics-office line beside it, and the overall
 * condition is the headline: a large figure, its outlined status tag, and one
 * line saying what the figure is. No government line, history slider, or
 * alerts in v1; those return with the dynamics and consumers sub-projects.
 */
export function Masthead({
  countryId,
  countryDisplayName,
  overall,
  overallStatus,
  year,
  turn,
  onCompare,
  compareLabel = "⇄ Compare",
  registryLabel,
  sealLabel,
  comparison,
}: {
  countryId: PoliticalMetricsCountryId;
  countryDisplayName: string;
  overall: number;
  overallStatus: string;
  year: number;
  turn: number;
  onCompare: () => void;
  /** Text on the compare button. */
  compareLabel?: string;
  /** Region scope overrides the country's registry heading. */
  registryLabel?: string;
  /** Region scope overrides the statistics-office seal line. */
  sealLabel?: string;
  /**
   * @deprecated Not printed: the header has no glyph badge since the country
   * name became the title. Still accepted because the region tab passes it.
   */
  glyph?: string;
  /** Region scope shows the country figure beside the region's own. */
  comparison?: { label: string; value: number };
}) {
  const countryChrome = COUNTRY_CHROME[countryId];
  const chrome = {
    registry: registryLabel ?? countryChrome.registry,
    seal: sealLabel ?? countryChrome.seal,
  };
  const tone = scoreTone(overall);
  const shown = Math.round(overall);
  // Differenced from the ROUNDED figures either side of it, not the exact ones.
  // The headline shows 68 and the comparison shows 70, so a delta of -2.4 taken
  // from 67.6 and 70.0 would be three numbers in one header that do not add up.
  const delta = comparison ? shown - Math.round(comparison.value) : 0;
  return (
    <header className="overflow-hidden rounded-lg border border-card-border bg-card shadow-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-card-border px-4 py-2 font-mono text-body-sm text-muted sm:px-5">
        <span>{chrome.registry}</span>
        <span className="inline-flex items-center gap-2">
          <LiveDot color="success" />
          LIVE · SERIES {year}
        </span>
      </div>
      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h1 className="break-words text-display font-bold leading-tight tracking-tight text-foreground sm:text-4xl">
              {countryDisplayName}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-mono text-body-sm text-muted">
                TURN {turn.toLocaleString("en-US")}
              </span>
              {comparison && (
                <span className="font-mono text-body-sm text-muted">
                  {comparison.label} {Math.round(comparison.value)}
                  {delta !== 0 && (
                    <span className={delta > 0 ? "text-success" : "text-error"}>
                      {" "}
                      ({delta > 0 ? "+" : ""}
                      {delta})
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <Button variant="secondary" onClick={onCompare}>
              {compareLabel}
            </Button>
            <span className="font-mono text-body-sm text-muted">{chrome.seal}</span>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="flex items-baseline gap-1">
            <span className={`text-5xl font-semibold leading-none tabular-nums ${tone.text}`}>
              {shown}
            </span>
            <span className="text-body-lg text-muted">/100</span>
          </span>
          <span
            className={`inline-block rounded border px-2.5 py-1 font-mono text-body-lg font-bold tracking-wider ${tone.border} ${tone.text} bg-card-muted`}
          >
            {overallStatus.toUpperCase()}
          </span>
        </div>
        <p className="mt-2 text-body-lg text-muted">
          Overall condition: the mean of the nine category scores, out of 100.
        </p>
      </div>
    </header>
  );
}
