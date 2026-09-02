"use client";

import { Button } from "@/components/ui/Button";
import { LiveDot } from "@/components/ui/Badge";
import { COUNTRY_CHROME } from "@/lib/politicalMetrics/names";
import type { PoliticalMetricsCountryId } from "@/lib/politicalMetrics/types";
import { scoreTone } from "./tones";

/**
 * National-registry masthead. No government line, history slider, or alerts
 * in v1 — those return with the dynamics/consumers sub-projects.
 */
export function Masthead({
  countryId,
  countryDisplayName,
  overall,
  overallStatus,
  year,
  turn,
  onCompare,
  registryLabel,
  sealLabel,
  glyph,
  comparison,
}: {
  countryId: PoliticalMetricsCountryId;
  countryDisplayName: string;
  overall: number;
  overallStatus: string;
  year: number;
  turn: number;
  onCompare: () => void;
  /** Region scope overrides the country's registry heading. */
  registryLabel?: string;
  /** Region scope overrides the statistics-office seal line. */
  sealLabel?: string;
  /** Region scope shows the region code in the badge instead of the country glyph. */
  glyph?: string;
  /** Region scope shows the country figure beside the region's own. */
  comparison?: { label: string; value: number };
}) {
  const countryChrome = COUNTRY_CHROME[countryId];
  const chrome = {
    registry: registryLabel ?? countryChrome.registry,
    seal: sealLabel ?? countryChrome.seal,
    glyph: glyph ?? countryChrome.glyph,
  };
  const tone = scoreTone(overall);
  // Differenced from the ROUNDED figures either side of it, not the exact ones.
  // The badge shows 68 and the comparison shows 70, so a delta of -2.4 taken
  // from 67.6 and 70.0 would be three numbers on one line that do not add up.
  const delta = comparison ? Math.round(overall) - Math.round(comparison.value) : 0;
  return (
    <header className="overflow-hidden rounded-lg border border-card-border bg-card shadow-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-card-border px-4 py-2 font-mono text-body-xs uppercase tracking-widest text-muted">
        <span>{chrome.registry}</span>
        <span className="inline-flex items-center gap-2">
          <LiveDot color="success" />
          LIVE · SERIES {year}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-4 p-4">
        <div
          aria-hidden="true"
          className={`flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-md border-2 bg-card-muted font-mono font-bold ${tone.border} ${tone.text} ${countryId === "RU" ? "text-body-sm" : "text-heading-sm"}`}
        >
          {chrome.glyph}
        </div>
        <div className="min-w-[220px] flex-1">
          <h1 className="font-display text-display font-bold leading-tight text-foreground">
            {countryDisplayName}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span
              className={`inline-block rounded border px-2 py-0.5 font-mono text-body-xs font-bold tracking-wider ${tone.border} ${tone.text} bg-card-muted`}
            >
              {overallStatus.toUpperCase()} · {Math.round(overall)}/100
            </span>
            <span className="font-mono text-body-xs text-muted">
              TURN {turn.toLocaleString("en-US")}
            </span>
            {comparison && (
              <span className="font-mono text-body-xs text-muted">
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
        <div className="flex flex-col items-end gap-2">
          <Button variant="secondary" size="sm" onClick={onCompare}>
            ⇄ Compare
          </Button>
          <span className="font-mono text-body-xs uppercase tracking-widest text-muted">
            {chrome.seal}
          </span>
        </div>
      </div>
      <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
    </header>
  );
}
