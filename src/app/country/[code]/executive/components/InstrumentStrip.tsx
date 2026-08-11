"use client";

import type { ReactNode } from "react";

export interface InstrumentTile {
  label: string;
  /** Headline value (mono). */
  value: ReactNode;
  /** Small mono badge beside the label (e.g. "TERM 1 OF 2"). */
  badge?: string;
  /** 0-100 progress bar under the value (term/plenum clock). */
  progressPct?: number;
  /** Mono footer line. */
  subline?: string;
  /** Sparkline series rendered beside the value (e.g. approval history). */
  spark?: number[];
  /** Tone class for the headline value (semantic text class). */
  valueClass?: string;
}

/**
 * X instrument strip (locked composite): four gauges of the administration
 * itself — Term/Plenum Clock, Mandate, Desk/Directives, Cabinet fill. Tiles
 * are generic; per-country meaning comes from getExecutiveSurface config.
 */
export function InstrumentStrip({ tiles }: { tiles: InstrumentTile[] }) {
  return (
    <div
      className={`grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-card-border bg-card-border ${
        tiles.length === 2 ? "" : tiles.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-4"
      }`}
    >
      {tiles.map((tile) => (
        <div key={tile.label} className="bg-card px-4 py-3.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[9px] font-semibold uppercase tracking-widest text-muted">
              {tile.label}
            </span>
            {tile.badge && (
              <span className="rounded border border-card-border bg-card-muted px-1.5 py-px font-mono text-[8px] font-bold text-muted">
                {tile.badge}
              </span>
            )}
          </div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span
              className={`font-mono text-base font-bold ${tile.valueClass ?? "text-foreground"}`}
            >
              {tile.value}
            </span>
            {tile.spark && tile.spark.length >= 2 && (
              <svg viewBox="0 0 58 18" className="h-4 w-14 overflow-visible text-muted" aria-hidden>
                <polyline
                  points={sparkPoints(tile.spark)}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  opacity="0.7"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            )}
          </div>
          {tile.progressPct !== undefined && (
            <div className="mt-2 h-1 rounded-full bg-track">
              <div
                className="h-1 rounded-full bg-primary"
                style={{ width: `${Math.max(0, Math.min(100, tile.progressPct))}%` }}
              />
            </div>
          )}
          {tile.subline && (
            <div className="mt-1.5 font-mono text-[9px] leading-snug text-muted/70">
              {tile.subline}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function sparkPoints(series: number[]): string {
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  return series
    .map(
      (point, index) => `${(index / (series.length - 1)) * 58},${16 - ((point - min) / range) * 14}`
    )
    .join(" ");
}
