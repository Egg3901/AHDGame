"use client";

import type { MapTooltipAccessTone } from "../worldMetricHighlight";

interface WorldMapTooltipProps {
  countryLabel: string;
  position: { x: number; y: number };
  access: { label: string; tone: MapTooltipAccessTone; econOnly?: boolean };
  /** When a metric / party / corps / score filter is active */
  filterHighlight?: { label: string; value: string } | null;
  corpsCount?: number;
  showClickHint?: boolean;
}

/** Availability labels arrive title-cased from the shared resolver; the tooltip reads them in sentence case. */
const SENTENCE_CASE_STATUS: Record<string, string> = {
  "Beta Access": "Beta access",
  "Econ-Only": "Econ-only",
  "Under Development": "Under development",
};

/**
 * The /world globe's hover card: a solid panel with the nation, its status as a
 * word, and the active filter's figure. A plain counterpart of `MapTooltip`,
 * which the landing globe still uses unchanged.
 */
export default function WorldMapTooltip({
  countryLabel,
  position,
  access,
  filterHighlight,
  corpsCount,
  showClickHint,
}: WorldMapTooltipProps) {
  return (
    <div
      className="pointer-events-none absolute z-20 flex min-w-[160px] max-w-[240px] flex-col gap-1 rounded-lg border border-card-border bg-popover px-3 py-2.5 text-body-sm text-popover-foreground shadow-panel"
      style={{
        left: position.x + 20,
        top: position.y - 20,
        transform: "translateY(-50%)",
      }}
    >
      <span className="text-body font-semibold">{countryLabel}</span>
      <span className="text-muted">{SENTENCE_CASE_STATUS[access.label] ?? access.label}</span>
      {access.econOnly && (
        <span className="text-muted">Browse every page. You cannot act here yet.</span>
      )}
      {filterHighlight && (
        <span className="text-muted">
          {filterHighlight.label}:{" "}
          <span className="font-semibold tabular-nums text-foreground">
            {filterHighlight.value}
          </span>
        </span>
      )}
      {corpsCount !== undefined && corpsCount > 0 && (
        <span className="text-muted">
          {corpsCount} {corpsCount === 1 ? "corporation" : "corporations"}
        </span>
      )}
      {showClickHint && <span className="text-muted">Click to enter</span>}
    </div>
  );
}
