"use client";

import { useMemo, type ReactNode } from "react";
import { formatFundsCompact } from "@/lib/utils/formatters";

/**
 * Shared display primitives for the Treasury / National Budget surface, ported
 * from the design prototype (`bcomponents.jsx`). Themed with `ahd-design-system`
 * tokens (`text-gold`, card tokens); only the sankey/sparkline use raw data-viz
 * colors (the allowed chart exception), passed in by the caller.
 */

export type TreasuryTone = "up" | "down" | "warning" | "gold" | "foreground";

const VALUE_TONE: Record<TreasuryTone, string> = {
  up: "text-success",
  down: "text-error",
  warning: "text-warning",
  gold: "text-gold",
  foreground: "text-foreground",
};

/** A single stat in the fiscal stat strip (label, value, optional sub + delta). */
export function StatTile({
  label,
  value,
  sub,
  tone = "foreground",
  delta,
}: {
  label: string;
  value: string;
  sub?: ReactNode;
  tone?: TreasuryTone;
  delta?: ReactNode;
}) {
  return (
    <div className="flex min-w-[120px] flex-col justify-start gap-1 bg-card px-4 py-3">
      <span className="whitespace-nowrap text-body-xs uppercase tracking-wide text-muted">
        {label}
      </span>
      <div className="flex flex-col">
        <div className="flex items-baseline gap-2">
          <span
            className={`text-heading-sm font-bold leading-tight tabular-nums ${VALUE_TONE[tone]}`}
          >
            {value}
          </span>
          {delta}
        </div>
        {sub && <span className="text-body-xs tabular-nums text-muted">{sub}</span>}
      </div>
    </div>
  );
}

/**
 * Compare delta chip (vs prior fiscal year). `kind` selects the formatting:
 * `money` → compact currency in `sym`, `pct` → percentage-points. `invert`
 * flips the good/bad coloring (e.g. for spending / debt where a rise is bad).
 */
export function Delta({
  now,
  prev,
  kind,
  sym = "$",
  invert = false,
  className = "",
}: {
  now: number;
  prev: number | null | undefined;
  kind: "money" | "pct";
  sym?: string;
  invert?: boolean;
  className?: string;
}) {
  if (prev == null) return null;
  const d = now - prev;
  if (Math.abs(d) < 1e-9) return <span className={`text-body-xs text-muted ${className}`}>—</span>;
  const good = invert ? d < 0 : d > 0;
  const text =
    kind === "pct"
      ? `${d >= 0 ? "+" : ""}${d.toFixed(1)}pp`
      : `${d >= 0 ? "+" : "−"}${formatFundsCompact(Math.abs(d), sym)}`;
  return (
    <span
      className={`tabular-nums text-body-xs font-semibold ${good ? "text-success" : "text-error"} ${className}`}
    >
      {text}
    </span>
  );
}

/** Tiny trend line for a numeric series (debt-to-GDP, etc.). `color` is a raw hex. */
export function Sparkline({
  data,
  w = 132,
  h = 36,
  color = "#c9a24b",
  fill = true,
}: {
  data: number[];
  w?: number;
  h?: number;
  color?: string;
  fill?: boolean;
}) {
  const gradientId = useMemo(
    () => `tspark-${Math.round(data.reduce((s, v, i) => s + v * (i + 1), 0))}-${data.length}`,
    [data]
  );
  if (data.length === 0) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts =
    data.length === 1
      ? [
          [0, h / 2],
          [w, h / 2],
        ]
      : data.map((v, i) => [(i / (data.length - 1)) * w, h - ((v - min) / span) * (h - 4) - 2]);
  const line = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `0,${h} ${line} ${w},${h}`;
  const last = pts[pts.length - 1];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <polygon points={area} fill={`url(#${gradientId})`} />}
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={last[0]} cy={last[1]} r="2.4" fill={color} />
    </svg>
  );
}

export interface StackSegment {
  key: string;
  label: string;
  value: number;
  color: string;
}

/** Horizontal stacked bar; segments below 0.4% are dropped. `formatValue` for titles. */
export function StackBar({
  segments,
  total,
  height = 28,
  formatValue,
  onHover,
}: {
  segments: StackSegment[];
  total: number;
  height?: number;
  formatValue: (n: number) => string;
  onHover?: (seg: StackSegment | null) => void;
}) {
  return (
    <div className="flex w-full overflow-hidden rounded-md" style={{ height }}>
      {segments.map((s) => {
        const pct = total > 0 ? (s.value / total) * 100 : 0;
        if (pct < 0.4) return null;
        return (
          <div
            key={s.key}
            className="flex h-full items-center justify-center overflow-hidden text-[10px] font-semibold text-black/80 transition-opacity hover:opacity-80"
            style={{ width: `${pct}%`, background: s.color }}
            title={`${s.label}: ${formatValue(s.value)} (${pct.toFixed(1)}%)`}
            onMouseEnter={() => onHover?.(s)}
            onMouseLeave={() => onHover?.(null)}
          >
            {pct > 7 ? s.label : ""}
          </div>
        );
      })}
    </div>
  );
}

/** Thin progress meter (grant recipients, ceiling use). `tone` picks the fill. */
export function Meter({
  value,
  max = 100,
  tone = "gold",
  height = 8,
}: {
  value: number;
  max?: number;
  tone?: "gold" | "up" | "down" | "warning";
  height?: number;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const fill =
    tone === "up"
      ? "bg-success"
      : tone === "down"
        ? "bg-error"
        : tone === "warning"
          ? "bg-warning"
          : "bg-gold";
  return (
    <div
      className="overflow-hidden rounded-full border border-card-border bg-card-muted"
      style={{ height }}
    >
      <div
        className={`h-full rounded-full transition-all duration-500 ${fill}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
