"use client";

import type { CSSProperties, ReactNode } from "react";
import type { StatsIdentity } from "@/lib/constants/nationalStatsIdentity";

export type TileTone = "up" | "warning" | "down" | "accent";

export interface MastheadTile {
  label: string;
  value: ReactNode;
  sub?: string;
  tone?: TileTone;
}

interface StatMastheadProps {
  identity: StatsIdentity;
  /** Short scope label shown as a badge ("National rollup" / "Region view"). */
  scopeLabel: string;
  /** Main heading (already includes English-in-parens where applicable). */
  title: string;
  /** Sub-heading line (office name). */
  subtitle: string;
  /** Headline stat tiles. */
  tiles: MastheadTile[];
  /** Optional control(s) (e.g. a region selector) shown in the control bar. */
  regionControl?: ReactNode;
}

function toneClass(tone?: TileTone): string {
  switch (tone) {
    case "up":
      return "text-success";
    case "warning":
      return "text-warning";
    case "down":
      return "text-error";
    case "accent":
      return "";
    default:
      return "";
  }
}

/**
 * Always-dark per-country statistics-office masthead. Accent + gradient are
 * injected as scoped CSS custom properties on this container only, so the themed
 * body is never affected. The stat strip renders the tiles assembled by the
 * caller.
 */
export function StatMasthead({
  identity,
  scopeLabel,
  title,
  subtitle,
  tiles,
  regionControl,
}: StatMastheadProps) {
  const { accent } = identity;
  const isCjk = identity.serif === "cjk";
  const accentVars = {
    "--stat": accent.stat,
    "--stat-soft": accent.statSoft,
    "--g0": accent.g0,
    "--g1": accent.g1,
    "--g2": accent.g2,
  } as CSSProperties;
  const mastheadBg = "linear-gradient(135deg, var(--g0) 0%, var(--g1) 52%, var(--g2) 100%)";

  return (
    <header
      data-testid="stat-masthead"
      className="relative overflow-hidden rounded-2xl border bg-card shadow-lg"
      style={{
        ...accentVars,
        borderColor: "color-mix(in srgb, var(--stat) 25%, transparent)",
      }}
    >
      <div className="relative px-5 pb-4 pt-5 sm:px-7 sm:pt-6" style={{ background: mastheadBg }}>
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
          {/* seal / chop */}
          <div
            aria-hidden
            className={`flex shrink-0 items-center justify-center rounded-lg font-black ${isCjk ? "font-serif" : "font-mono"}`}
            style={{
              width: 76,
              height: 76,
              fontSize: isCjk ? 38 : identity.glyph.length >= 3 ? 20 : 26,
              color: "var(--stat-soft)",
              background:
                "linear-gradient(160deg, color-mix(in srgb, var(--g0) 70%, white 8%), var(--g1))",
              border: "2px solid var(--stat)",
              boxShadow:
                "inset 0 0 0 1px color-mix(in srgb, var(--stat-soft) 32%, transparent), 0 4px 14px rgba(0,0,0,0.5)",
            }}
          >
            {identity.glyph}
          </div>

          <div className="min-w-0 flex-1">
            <div
              className="whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.16em]"
              style={{ color: "color-mix(in srgb, var(--stat-soft) 80%, transparent)" }}
            >
              {identity.registry}
            </div>
            <h1
              className={`mt-1.5 text-2xl font-bold leading-[1.1] tracking-tight text-white sm:text-3xl ${isCjk ? "font-serif" : ""}`}
            >
              {title}
            </h1>
            <div
              className="mt-0.5 flex items-center gap-2 text-sm"
              style={{ color: "color-mix(in srgb, var(--stat-soft) 90%, transparent)" }}
            >
              {subtitle}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span
                className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold text-white"
                style={{
                  borderColor: "color-mix(in srgb, var(--stat) 40%, transparent)",
                  background: "color-mix(in srgb, var(--stat) 25%, transparent)",
                }}
              >
                {scopeLabel}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black px-2.5 py-0.5 text-xs font-medium text-white/80">
                <span className="h-2 w-2 shrink-0 rounded-full bg-success" aria-hidden />
                Live · turn-weighted
              </span>
            </div>
          </div>
        </div>

        {/* control bar */}
        {regionControl && (
          <div className="relative mt-4 flex flex-wrap items-center gap-x-4 gap-y-2.5 border-t border-white/10 pt-3.5">
            {regionControl}
          </div>
        )}
      </div>

      <div aria-hidden className="h-px bg-card-border" />

      {/* headline stat strip */}
      <div className="grid grid-cols-2 divide-x divide-y divide-card-border bg-card-muted/60 sm:grid-cols-3 lg:grid-cols-7 lg:divide-y-0">
        {tiles.map((t, i) => (
          <div
            key={i}
            className="flex min-w-[120px] flex-1 flex-col justify-between gap-1 px-4 py-3.5"
          >
            <span className="whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
              {t.label}
            </span>
            <div className="flex flex-col">
              <span
                className={`text-lg font-bold leading-tight tabular-nums ${t.tone === "accent" ? "" : toneClass(t.tone) || "text-foreground"}`}
                style={t.tone === "accent" ? { color: "var(--stat-soft)" } : undefined}
              >
                {t.value}
              </span>
              {t.sub && <span className="text-[11px] text-muted">{t.sub}</span>}
            </div>
          </div>
        ))}
      </div>
    </header>
  );
}

export default StatMasthead;
