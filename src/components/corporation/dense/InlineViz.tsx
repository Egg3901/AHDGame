"use client";

import type { ReactNode } from "react";

/**
 * Small marks that sit inside dense rows and table cells instead of beside
 * them. The figure stays the primary read; the mark only gives it a shape, so
 * a scan down a column shows proportion and sign without a chart panel.
 */

export type Tone = "success" | "error" | "warning" | "primary" | "muted";

const BAR_TONE: Record<Tone, string> = {
  success: "bg-success/70",
  error: "bg-error/70",
  warning: "bg-warning/70",
  primary: "bg-primary/70",
  muted: "bg-foreground/25",
};

export const TEXT_TONE: Record<Tone, string> = {
  success: "text-success",
  error: "text-error",
  warning: "text-warning",
  primary: "text-primary",
  muted: "text-muted",
};

/** Accent rule and wash for a highlighted row. Literal strings so Tailwind compiles them. */
export const ROW_ACCENT: Record<Tone, string> = {
  success: "border-l-success bg-gradient-to-r from-success/10 to-transparent",
  error: "border-l-error bg-gradient-to-r from-error/10 to-transparent",
  warning: "border-l-warning bg-gradient-to-r from-warning/10 to-transparent",
  primary: "border-l-primary bg-gradient-to-r from-primary/10 to-transparent",
  muted: "border-l-card-border bg-gradient-to-r from-card-border/25 to-transparent",
};

export function toneOfSign(value: number | null | undefined): Tone {
  if (value == null || !Number.isFinite(value) || value === 0) return "muted";
  return value > 0 ? "success" : "error";
}

/** Thin bar scaled to `max`, for a figure's share of the column's largest. */
export function DataBar({
  value,
  max,
  tone = "muted",
  className = "",
}: {
  value: number | null | undefined;
  max: number;
  tone?: Tone;
  className?: string;
}) {
  const pct =
    max > 0 && value != null && Number.isFinite(value)
      ? Math.min(100, (Math.abs(value) / max) * 100)
      : 0;
  return (
    <span
      aria-hidden
      className={`block h-[3px] overflow-hidden rounded-full bg-card-border/40 ${className}`}
    >
      <span
        className={`block h-full rounded-full ${BAR_TONE[tone]}`}
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}

/**
 * A bar that grows right from a centre line when positive and left when
 * negative, for margins. `span` is the value that fills one half.
 */
export function DivergingBar({
  value,
  span = 40,
  className = "w-14",
}: {
  value: number | null | undefined;
  span?: number;
  className?: string;
}) {
  const v = value != null && Number.isFinite(value) ? value : 0;
  const half = Math.min(50, (Math.abs(v) / span) * 50);
  return (
    <span
      aria-hidden
      className={`relative inline-block h-1.5 shrink-0 overflow-hidden rounded-full bg-card-border/40 align-middle ${className}`}
    >
      <span className="absolute inset-y-0 left-1/2 w-px bg-muted/60" />
      <span
        className={`absolute inset-y-0 ${v >= 0 ? "left-1/2 rounded-r-full bg-success/70" : "right-1/2 rounded-l-full bg-error/70"}`}
        style={{ width: `${half}%` }}
      />
    </span>
  );
}

/** A 0..100 gauge. Tone defaults to a red, amber, green read of the value. */
export function Meter({
  pct,
  tone,
  className = "w-14",
}: {
  pct: number | null | undefined;
  tone?: Tone;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, pct != null && Number.isFinite(pct) ? pct : 0));
  const resolved: Tone = tone ?? (clamped >= 66 ? "success" : clamped >= 33 ? "warning" : "error");
  return (
    <span
      aria-hidden
      className={`inline-block h-1.5 shrink-0 overflow-hidden rounded-full bg-card-border/40 align-middle ${className}`}
    >
      <span
        className={`block h-full rounded-full ${BAR_TONE[resolved]}`}
        style={{ width: `${clamped}%` }}
      />
    </span>
  );
}

/** Signed change with a direction glyph: "▲ 2.1%". */
export function Delta({
  value,
  digits = 1,
  suffix = "%",
}: {
  value: number | null | undefined;
  digits?: number;
  suffix?: string;
}): ReactNode {
  if (value == null || !Number.isFinite(value)) return <span className="text-muted">n/a</span>;
  const tone = toneOfSign(value);
  const glyph = value > 0 ? "▲" : value < 0 ? "▼" : null;
  return (
    <span className={TEXT_TONE[tone]}>
      {glyph && (
        <span aria-hidden className="mr-0.5 text-[9px]">
          {glyph}
        </span>
      )}
      {Math.abs(value).toFixed(digits)}
      {suffix}
    </span>
  );
}

/** Credit-style letter grade coloured by band: A green, B amber, C and below red. */
export function gradeTone(rating: string | null | undefined): Tone {
  if (!rating) return "muted";
  const head = rating.trim().charAt(0).toUpperCase();
  if (head === "A") return "success";
  if (head === "B") return "warning";
  return "error";
}
