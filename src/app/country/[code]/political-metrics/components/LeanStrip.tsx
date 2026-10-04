"use client";

import { sentenceCase } from "./labels";

export interface LeanStripMetric {
  id: string;
  lean: number;
  leanLabel: string;
  displayName: string;
  value: number;
  status: string;
}

/**
 * A category's seven metrics as bars in lean order, left to right. Bar
 * position is political association; bar height is the objective score. The
 * two are independent by design, and every bar is the same neutral colour so
 * the height alone carries the score. Each bar opens its metric.
 */
export function LeanStrip({
  metrics,
  onOpenMetric,
  size = "sm",
}: {
  metrics: LeanStripMetric[];
  onOpenMetric: (metricId: string) => void;
  size?: "sm" | "lg";
}) {
  const trackH = size === "lg" ? 40 : 22;
  const barW = size === "lg" ? "w-4" : "w-2";
  // The large strip spans its column so the first, middle and last bars sit
  // over the "Strong left", "Mixed" and "Strong right" labels beneath it.
  const layout = size === "lg" ? "w-full justify-between" : "gap-1.5";
  return (
    <div className={`flex items-end ${layout}`} aria-label="Ideological range, left to right">
      {metrics.map((m) => {
        const h = Math.max(2, Math.round((Math.max(0, Math.min(100, m.value)) / 100) * trackH));
        const label = `${m.displayName}: score ${Math.round(m.value)}, ${m.status}, lean ${sentenceCase(m.leanLabel)}`;
        return (
          <button
            key={m.id}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenMetric(m.id);
            }}
            title={label}
            aria-label={label}
            className="flex cursor-pointer items-end border-0 bg-transparent p-0"
          >
            <span
              className={`flex items-end rounded-[1px] bg-card-border ${barW}`}
              style={{ height: trackH }}
            >
              <span className="block w-full rounded-[1px] bg-foreground/60" style={{ height: h }} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
