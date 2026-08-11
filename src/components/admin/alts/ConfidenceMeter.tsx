"use client";

// A prominent, at-a-glance confidence % gauge (plan §4.8: "each card showing
// a prominent confidence %"). Radial arc so the number reads instantly in the
// ranked list and dominates the cluster detail header. Color-coded by
// confidence band (very-high → low) with the % figure + band word carrying
// the same information, so color is never the only channel. Pure/presentational.

import { clamp01, confidenceHex, confidenceLabel, confidenceTextClass } from "./altTypes";

type MeterSize = "sm" | "md" | "lg";

const DIMS: Record<MeterSize, { box: number; stroke: number; font: string; sub: string }> = {
  sm: { box: 68, stroke: 5, font: "text-base", sub: "text-[8px]" },
  md: { box: 96, stroke: 7, font: "text-2xl", sub: "text-[10px]" },
  lg: { box: 136, stroke: 9, font: "text-4xl", sub: "text-[11px]" },
};

interface ConfidenceMeterProps {
  value: number;
  size?: MeterSize;
  /** Optional caption under the % (e.g. "confidence"). */
  caption?: string;
  /** Show the band word (Very high / High / …) instead of a caption. */
  showBand?: boolean;
}

export function ConfidenceMeter({
  value,
  size = "md",
  caption,
  showBand = false,
}: ConfidenceMeterProps) {
  const v = clamp01(value);
  const { box, stroke, font, sub } = DIMS[size];
  const r = (box - stroke) / 2;
  const cx = box / 2;
  const circumference = 2 * Math.PI * r;
  const dash = circumference * v;
  const color = confidenceHex(v);
  const pct = Math.round(v * 100);

  return (
    <div
      className="relative flex flex-shrink-0 items-center justify-center"
      style={{ width: box, height: box }}
      role="meter"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Confidence ${pct} percent, ${confidenceLabel(v)}`}
      title={`${pct}% confidence — ${confidenceLabel(v)}`}
    >
      <svg width={box} height={box} className="-rotate-90">
        {/* Tinted inner disc: gives the gauge a filled presence without noise. */}
        <circle cx={cx} cy={cx} r={Math.max(0, r - stroke * 1.5)} fill={color} opacity={0.06} />
        {/* Track */}
        <circle
          cx={cx}
          cy={cx}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="text-track"
        />
        {/* Value arc — rounded caps + a whisper of glow at the arc color. */}
        <circle
          cx={cx}
          cy={cx}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          className="transition-[stroke-dasharray] duration-300 ease-out motion-reduce:transition-none"
          style={{ filter: `drop-shadow(0 0 ${Math.max(3, stroke)}px ${color}40)` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className={`font-bold tabular-nums tracking-tight ${font} ${confidenceTextClass(v)}`}>
          {pct}%
        </span>
        {showBand ? (
          <span className={`mt-1 font-medium uppercase tracking-[0.14em] text-muted ${sub}`}>
            {confidenceLabel(v)}
          </span>
        ) : caption ? (
          <span className={`mt-1 font-medium uppercase tracking-[0.14em] text-muted ${sub}`}>
            {caption}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Slim inline bar variant, for tables / pair rows where a ring is too big. */
export function ConfidenceBar({
  value,
  widthClass = "w-24",
}: {
  value: number;
  widthClass?: string;
}) {
  const v = clamp01(value);
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`relative h-1.5 overflow-hidden rounded-full bg-track ${widthClass}`}>
        <span
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${v * 100}%`, backgroundColor: confidenceHex(v) }}
        />
      </span>
      <span
        className={`min-w-[2.25rem] text-right text-xs font-semibold tabular-nums ${confidenceTextClass(v)}`}
      >
        {Math.round(v * 100)}%
      </span>
    </span>
  );
}
