"use client";

import { scoreTone } from "./tones";

export interface LeanStripMetric {
  id: string;
  lean: number;
  leanLabel: string;
  displayName: string;
  nationalValue: number;
  status: string;
}

/**
 * The dashboard's signature element: seven mini-bars in lean order (-5 → +5).
 * Bar POSITION = political association; bar HEIGHT + COLOR = objective score.
 * The two are independent by design.
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
  const trackH = size === "lg" ? 34 : 22;
  const barW = size === "lg" ? "w-3" : "w-2";
  return (
    <div className="flex items-end gap-1.5" aria-label="Ideological range, left to right">
      <span className="self-end font-mono text-body-xs leading-relaxed text-muted">L</span>
      {metrics.map((m) => {
        const h = Math.max(2, Math.round((m.nationalValue / 100) * trackH));
        const tone = scoreTone(m.nationalValue);
        return (
          <button
            key={m.id}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenMetric(m.id);
            }}
            title={`${m.displayName} — score ${Math.round(m.nationalValue)} (${m.status}) · lean ${m.leanLabel}`}
            aria-label={`${m.displayName}, score ${Math.round(m.nationalValue)}, ${m.status}, lean ${m.leanLabel}`}
            className="flex cursor-pointer items-end border-0 bg-transparent p-0"
          >
            <span
              className={`flex items-end rounded-[1px] bg-track ${barW}`}
              style={{ height: trackH }}
            >
              <span className={`block w-full rounded-[1px] ${tone.bg}`} style={{ height: h }} />
            </span>
          </button>
        );
      })}
      <span className="self-end font-mono text-body-xs leading-relaxed text-muted">R</span>
    </div>
  );
}
