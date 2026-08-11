"use client";

/**
 * Market-identity primitives for the player-corporation surface.
 *
 * Ported from the approved design prototype
 * (docs/superpowers/specs/2026-05-31-player-corp-prototype/src/pcomponents.jsx),
 * translated to project semantic tokens so all themes keep working:
 *  - prototype `up`/`down`   → `success`/`error`
 *  - prototype `brand-*`     → the scoped `--brand` CSS var (set from the corp's
 *                              brandColor by the masthead) for accents
 *  - SVG strokes use `currentColor` driven by a text-color class (theme-safe)
 */

import { useId } from "react";

/* Ticker tile — market analogue of the national "chop"/seal. */
export function TickerTile({
  text,
  size = 64,
  radius,
  className = "",
}: {
  text: string;
  size?: number;
  radius?: number;
  className?: string;
}) {
  const len = (text || "").length;
  const fontSize = len >= 3 ? size * 0.3 : len === 2 ? size * 0.4 : size * 0.5;
  return (
    <div
      className={`flex shrink-0 items-center justify-center font-mono font-semibold text-white ${className}`}
      style={{
        width: size,
        height: size,
        fontSize,
        borderRadius: radius ?? 12,
        letterSpacing: "0.02em",
        background:
          "linear-gradient(155deg, color-mix(in srgb, var(--brand, #3b82f6) 88%, white), var(--brand, #3b82f6))",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.35), 0 6px 18px -6px color-mix(in srgb, var(--brand, #3b82f6) 70%, transparent)",
      }}
      aria-hidden
    >
      {text}
    </div>
  );
}

/* Live market badge — analogue of the authorization seal/stamp. */
export function LiveBadge({
  exchange,
  label = "LIVE",
  open = true,
}: {
  exchange: string;
  label?: string;
  open?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/30 px-2.5 py-1 text-[11px] font-semibold text-white/90">
      <span className="relative inline-flex h-2 w-2">
        <span
          className={`relative inline-flex h-2 w-2 rounded-full ${open ? "bg-success" : "bg-muted"}`}
        />
        {open && (
          <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-success opacity-75" />
        )}
      </span>
      {exchange} · {label}
    </span>
  );
}

/* Inline share-price sparkline (theme-safe via currentColor). */
export function Sparkline({
  data,
  w = 132,
  h = 36,
  up = true,
}: {
  data: number[];
  w?: number;
  h?: number;
  up?: boolean;
}) {
  const gradId = useId();
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / span) * (h - 4) - 2;
    return [x, y] as const;
  });
  const line = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `0,${h} ` + line + ` ${w},${h}`;
  const last = pts[pts.length - 1];
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className={`overflow-visible ${up ? "text-success" : "text-error"}`}
      aria-hidden
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gradId})`} />
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={last[0]} cy={last[1]} r="2.4" fill="currentColor" />
    </svg>
  );
}

/* Up/down percentage-change chip with arrow. */
export function Change({ pct, className = "" }: { pct: number; className?: string }) {
  const up = pct >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[13px] font-semibold tabular-nums ${up ? "text-success" : "text-error"} ${className}`}
    >
      <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
        {up ? <path d="M10 5l5 6H5l5-6z" /> : <path d="M10 15l-5-6h10l-5 6z" />}
      </svg>
      {up ? "+" : ""}
      {pct.toFixed(2)}%
    </span>
  );
}

/* Progress / composite meter. */
export function Meter({
  value,
  max = 100,
  tone = "brand",
  height = 8,
}: {
  value: number;
  max?: number;
  tone?: "brand" | "up" | "down" | "warning";
  height?: number;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const toneClass =
    tone === "up"
      ? "bg-success"
      : tone === "down"
        ? "bg-error"
        : tone === "warning"
          ? "bg-warning"
          : "";
  return (
    <div
      className="overflow-hidden rounded-full border border-card-border bg-card-muted"
      style={{ height }}
    >
      <div
        className={`h-full rounded-full transition-all duration-500 ${toneClass}`}
        style={{
          width: pct + "%",
          ...(tone === "brand"
            ? {
                background:
                  "linear-gradient(90deg, color-mix(in srgb, var(--brand, #3b82f6) 65%, black), var(--brand, #3b82f6))",
              }
            : {}),
        }}
      />
    </div>
  );
}

/* Estimated / fog-of-war chip, sourced from the last quarterly snapshot turn. */
export function EstChip({ turn }: { turn: number | null }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-warning"
      title={
        turn != null
          ? `Estimated from the last quarterly report (turn ${turn})`
          : "Estimated from the last quarterly report"
      }
    >
      <svg className="h-2.5 w-2.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zM9 9a1 1 0 011-1h.01a1 1 0 011 1v3a1 1 0 11-2 0V9zm1-4a1 1 0 100 2 1 1 0 000-2z"
          clipRule="evenodd"
        />
      </svg>
      Est.
    </span>
  );
}
