"use client";

import { PositionLabel } from "@/components/PositionLabel";
import {
  getEconomicAxisTickLabels,
  getSocialAxisTickLabels,
  positionBucketHex,
} from "@/lib/utils/politics";
import { formatLeanValue } from "@/lib/utils/demographics";

const EUROPEAN_COLOUR_COUNTRIES = new Set(["UK", "DE"]);

export interface AxisSpectrumBarProps {
  axis: "economic" | "social";
  /** Equal-weight national average on −5…+5, or null when no law carries the axis. */
  value: number | null;
  countryId: string;
  /** Replayed per-enactment averages for this axis, oldest → newest (drift sparkline). */
  driftSeries?: (number | null)[];
}

const DRIFT_TREND_THRESHOLD = 0.15;

function driftTrendLabel(axis: "economic" | "social", series: number[]): string {
  const delta = series[series.length - 1] - series[0];
  if (Math.abs(delta) < DRIFT_TREND_THRESHOLD) return "— steady";
  const ticks = axis === "economic" ? getEconomicAxisTickLabels() : getSocialAxisTickLabels();
  return `▾ drifting ${(delta < 0 ? ticks.negative : ticks.positive).toLowerCase()}`;
}

/**
 * R1 spectrum bar — the National Ideology renderer locked at design review.
 * Marker dot sits at (value+5)/10 in the bucket colour (bucket hexes are the
 * established chart exception); words come from PositionLabel untouched.
 */
export function AxisSpectrumBar({ axis, value, countryId, driftSeries }: AxisSpectrumBarProps) {
  const ticks = axis === "economic" ? getEconomicAxisTickLabels() : getSocialAxisTickLabels();
  const axisTitle = axis === "economic" ? "Economic Axis" : "Social Axis";
  const european = axis === "economic" && EUROPEAN_COLOUR_COUNTRIES.has(countryId);
  const drift = (driftSeries ?? []).filter((point): point is number => point !== null);

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
          {axisTitle}
        </span>
        {value !== null ? (
          <span className="text-sm font-bold">
            <PositionLabel value={value} axis={axis} countryId={countryId} />{" "}
            <span className="font-mono text-xs font-medium text-muted">
              {formatLeanValue(value)}
            </span>
          </span>
        ) : (
          <span className="text-xs italic text-muted">No positions yet</span>
        )}
      </div>
      <div className="relative h-1.5 rounded-full bg-track">
        <span aria-hidden className="absolute left-1/2 -top-0.5 h-2.5 w-px bg-card-border" />
        {value !== null && (
          <span
            aria-hidden
            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card"
            style={{
              left: `${((value + 5) / 10) * 100}%`,
              // Bucket ramp hex — the established chart-colour exception.
              backgroundColor: positionBucketHex(value, axis, european),
            }}
          />
        )}
      </div>
      <div className="mt-1 flex justify-between text-[9px] uppercase tracking-wider text-muted/70">
        <span>{ticks.negative}</span>
        <span>{ticks.positive}</span>
      </div>
      {drift.length >= 2 && value !== null && (
        <div className="mt-2 border-t border-card-border/50 pt-1.5">
          <svg
            viewBox="0 0 100 24"
            preserveAspectRatio="none"
            className="block h-7 w-full"
            aria-hidden
          >
            <line
              x1="0"
              y1="12"
              x2="100"
              y2="12"
              stroke="var(--card-border)"
              strokeWidth="0.5"
              strokeDasharray="2 3"
            />
            <polyline
              points={drift
                .map(
                  (point, index) => `${(index / (drift.length - 1)) * 100},${12 - (point / 5) * 10}`
                )
                .join(" ")}
              fill="none"
              strokeWidth="1.2"
              vectorEffect="non-scaling-stroke"
              // Bucket ramp hex — chart exception, matches the marker dot.
              stroke={positionBucketHex(value, axis, european)}
              opacity="0.8"
            />
          </svg>
          <div className="mt-0.5 flex justify-between font-mono text-[9px] text-muted/70">
            <span>since first recorded law</span>
            <span>{driftTrendLabel(axis, drift)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
