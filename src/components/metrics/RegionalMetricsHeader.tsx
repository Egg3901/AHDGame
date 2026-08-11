"use client";

import type { CSSProperties, ReactNode } from "react";
import type { StatsIdentity } from "@/lib/constants/nationalStatsIdentity";

interface RegionalMetricsHeaderProps {
  identity: StatsIdentity;
  /** Region/state display name. */
  regionName: string;
  /** Dossier line prefix, e.g. "United Kingdom · Nation/Region". */
  dossier: string;
  /** Optional right-aligned stat (e.g. current approval readout). */
  stat?: ReactNode;
  /** Optional caption under the stat. */
  statLabel?: string;
}

/** Compact, always-dark regional header carrying the country's stats-office
 *  identity accent. Lighter than the national StatMasthead (no full stat strip). */
export function RegionalMetricsHeader({
  identity,
  regionName,
  dossier,
  stat,
  statLabel,
}: RegionalMetricsHeaderProps) {
  const { accent } = identity;
  const isCjk = identity.serif === "cjk";
  const accentVars = {
    "--stat": accent.stat,
    "--stat-soft": accent.statSoft,
    "--g0": accent.g0,
    "--g1": accent.g1,
    "--g2": accent.g2,
  } as CSSProperties;
  const bg =
    "radial-gradient(120% 150% at 0% 0%, color-mix(in srgb, var(--stat-soft) 16%, transparent) 0%, transparent 44%), linear-gradient(135deg, var(--g0) 0%, var(--g1) 52%, var(--g2) 100%)";

  return (
    <header
      className="relative overflow-hidden rounded-2xl border"
      style={{
        ...accentVars,
        borderColor: "color-mix(in srgb, var(--stat) 25%, transparent)",
      }}
    >
      <div className="flex items-center gap-4 px-5 py-4 sm:px-6" style={{ background: bg }}>
        <div
          aria-hidden
          className={`flex shrink-0 items-center justify-center rounded-lg font-black ${isCjk ? "font-serif" : "font-mono"}`}
          style={{
            width: 52,
            height: 52,
            fontSize: isCjk ? 26 : identity.glyph.length >= 3 ? 15 : 20,
            color: "var(--stat-soft)",
            background:
              "linear-gradient(160deg, color-mix(in srgb, var(--g0) 70%, white 8%), var(--g1))",
            border: "2px solid var(--stat)",
          }}
        >
          {identity.glyph}
        </div>
        <div className="min-w-0 flex-1">
          <div
            className="truncate text-[10px] font-bold uppercase tracking-[0.16em]"
            style={{ color: "color-mix(in srgb, var(--stat-soft) 80%, transparent)" }}
          >
            {dossier}
          </div>
          <h2
            className={`mt-0.5 truncate text-xl font-bold text-white ${isCjk ? "font-serif" : ""}`}
          >
            {regionName}
          </h2>
        </div>
        {stat !== undefined && (
          <div className="shrink-0 text-right">
            <div className="text-lg font-bold tabular-nums text-white">{stat}</div>
            {statLabel && (
              <div
                className="text-[10px] font-bold uppercase tracking-[0.16em]"
                style={{ color: "color-mix(in srgb, var(--stat-soft) 70%, transparent)" }}
              >
                {statLabel}
              </div>
            )}
          </div>
        )}
      </div>
      <div
        style={{
          height: 2,
          opacity: 0.85,
          background:
            "linear-gradient(90deg, transparent, var(--stat) 16%, var(--stat-soft) 50%, var(--stat) 84%, transparent)",
        }}
      />
    </header>
  );
}

export default RegionalMetricsHeader;
