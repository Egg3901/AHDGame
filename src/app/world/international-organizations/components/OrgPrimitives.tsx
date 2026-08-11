"use client";

import Image from "next/image";
import type { OrgIdentity } from "@/lib/constants/orgIdentity";

/**
 * Visual primitives ported from the Claude Design "International Organizations"
 * import, rebuilt on the app's semantic tokens + the per-org `--org` accent var
 * (set by `orgAccentStyle` on an ancestor). Project font stacks only.
 */

/**
 * Organization seal — accent-bordered tile showing the org's emblem image
 * (`identity.logoSrc`, e.g. the real UN/EU/NATO flags), falling back to the
 * accent-tinted glyph when no logo is set.
 */
export function Seal({ identity, size = 64 }: { identity: OrgIdentity; size?: number }) {
  const len = identity.glyph.length;
  const fontSize = len >= 3 ? size * 0.26 : len >= 2 ? size * 0.34 : size * 0.5;
  return (
    <div
      className="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg font-serif font-black leading-none"
      style={{
        width: size,
        height: size,
        fontSize,
        color: "var(--org-soft)",
        background:
          "linear-gradient(160deg, rgb(var(--c-card-elevated)), rgb(var(--c-card-muted)))",
        border: "2px solid var(--org)",
        boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--org-soft) 32%, transparent)",
      }}
      aria-hidden
    >
      {identity.logoSrc ? (
        <Image
          src={identity.logoSrc}
          alt=""
          width={size}
          height={size}
          className="h-full w-full object-contain p-[12%]"
          unoptimized
        />
      ) : (
        identity.glyph
      )}
      <span
        className="pointer-events-none absolute rounded"
        style={{
          inset: 4,
          border: "1px solid color-mix(in srgb, var(--org-soft) 40%, transparent)",
        }}
      />
    </div>
  );
}

function ringHex(v: number): string {
  if (v >= 75) return "#22c55e";
  if (v >= 55) return "var(--org)";
  if (v >= 40) return "#eab308";
  return "#f59e0b";
}

/** Circular progress ring (0–100). */
export function Ring({
  value,
  size = 56,
  stroke = 6,
  label,
}: {
  value: number;
  size?: number;
  stroke?: number;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const col = ringHex(clamped);
  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={label ? `${label}: ${clamped}` : `${clamped}`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgb(var(--c-card-muted))"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={col}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - clamped / 100)}
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="font-bold tabular-nums leading-none"
          style={{ color: col, fontSize: size * 0.3 }}
        >
          {clamped}
        </span>
        {label && (
          <span className="text-muted" style={{ fontSize: size * 0.13 }}>
            {label}
          </span>
        )}
      </div>
    </div>
  );
}

/** Horizontal meter bar (value/max). */
export function Meter({
  value,
  max = 100,
  color,
  height = 8,
}: {
  value: number;
  max?: number;
  color?: string;
  height?: number;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div
      className="overflow-hidden rounded-full border border-card-border bg-card-muted"
      style={{ height }}
    >
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${pct}%`, background: color ?? "var(--org)" }}
      />
    </div>
  );
}

/** Compact metric tile for the masthead strip / flagship aggregates. */
export function MetricTile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="flex min-w-[110px] flex-1 flex-col justify-between gap-1 px-4 py-3.5">
      <span className="whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
        {label}
      </span>
      <div className="flex flex-col">
        <span
          className="text-lg font-bold leading-tight tabular-nums"
          style={accent ? { color: "var(--org-soft)" } : undefined}
        >
          {value}
        </span>
        {sub && <span className="text-[11px] text-muted">{sub}</span>}
      </div>
    </div>
  );
}
