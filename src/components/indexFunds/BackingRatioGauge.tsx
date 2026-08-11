"use client";

import { INDEX_FUND_AUTO_PAUSE_BACKING_RATIO } from "@/lib/indexFunds/unitAccounting";

/**
 * Semi-circular gauge for the fund's backing ratio.
 *
 * The full sweep represents 0% → 150% backing. The auto-pause tick at 50% is
 * drawn in `--error` so a viewer can read the headroom in one glance. Values
 * above 150% are clamped to the top of the arc.
 */
export function BackingRatioGauge({ ratio }: { ratio: number | null }) {
  const W = 210;
  const H = 118;
  const cx = W / 2;
  const cy = 105;
  const r = 88;
  const sweepDeg = 180;
  const maxScale = 1.5;

  const polar = (deg: number, radius: number) => {
    const a = ((deg - 180) * Math.PI) / 180;
    return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)] as const;
  };

  const arcPath = (a0: number, a1: number) => {
    const [x0, y0] = polar(a0, r);
    const [x1, y1] = polar(a1, r);
    const large = a1 - a0 > 180 ? 1 : 0;
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };

  const startDeg = 0;
  const endDeg = sweepDeg;
  const trackPath = arcPath(startDeg, endDeg);

  const safeRatio = ratio == null || !Number.isFinite(ratio) ? 0 : ratio;
  const frac = Math.max(0, Math.min(1, safeRatio / maxScale));
  const arcEnd = startDeg + frac * sweepDeg;
  const arcFull = arcPath(startDeg, arcEnd);

  const tickDeg = (INDEX_FUND_AUTO_PAUSE_BACKING_RATIO / maxScale) * sweepDeg;
  const [tx1, ty1] = polar(tickDeg, r - 10);
  const [tx2, ty2] = polar(tickDeg, r + 10);

  const hasData = ratio != null && Number.isFinite(ratio);
  const pct = hasData ? (safeRatio * 100).toFixed(1) : "—";
  const tone =
    hasData && safeRatio < INDEX_FUND_AUTO_PAUSE_BACKING_RATIO ? "var(--error)" : "var(--success)";

  return (
    <div className="relative mx-auto" style={{ width: W, height: H }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block" style={{ width: W, height: H }}>
        <path
          d={trackPath}
          fill="none"
          stroke="var(--track)"
          strokeWidth={13}
          strokeLinecap="round"
        />
        {hasData && (
          <path d={arcFull} fill="none" stroke={tone} strokeWidth={13} strokeLinecap="round" />
        )}
        <line
          x1={tx1.toFixed(1)}
          y1={ty1.toFixed(1)}
          x2={tx2.toFixed(1)}
          y2={ty2.toFixed(1)}
          stroke="var(--error)"
          strokeWidth={2}
        />
      </svg>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 text-center">
        <div
          className="font-mono tabular-nums text-[26px] font-bold leading-none"
          style={{ color: tone }}
        >
          {pct}
          {hasData && "%"}
        </div>
        <div className="mt-1 text-[10px] text-muted">of unit liability backed</div>
      </div>
    </div>
  );
}
