"use client";

import type { MapTooltipAccessTone } from "../worldMetricHighlight";

interface MapTooltipProps {
  countryLabel: string;
  position: { x: number; y: number };
  access: { label: string; tone: MapTooltipAccessTone; econOnly?: boolean };
  /** When a metric / party / corps / score filter is active */
  filterHighlight?: { label: string; value: string } | null;
  corpsCount?: number;
  showClickHint?: boolean;
}

function toneDotStyle(tone: MapTooltipAccessTone): string {
  if (tone === "active") return "var(--success)";
  if (tone === "beta") return "var(--warning)";
  return "var(--primary)";
}

export default function MapTooltip({
  countryLabel,
  position,
  access,
  filterHighlight,
  corpsCount,
  showClickHint,
}: MapTooltipProps) {
  return (
    <div
      className="absolute pointer-events-none z-20 px-4 py-3 rounded-xl text-xs bg-popover/95 border border-card-border shadow-2xl backdrop-blur-md text-popover-foreground flex flex-col gap-1 min-w-[140px] animate-in fade-in zoom-in-95 duration-150"
      style={{
        left: position.x + 20,
        top: position.y - 20,
        transform: "translateY(-50%)",
      }}
    >
      <div className="flex items-center justify-between gap-4">
        <span className="font-bold text-sm tracking-tight">{countryLabel}</span>
        {access.tone === "active" && (
          <span className="text-[10px] uppercase font-bold text-success tracking-wider">Live</span>
        )}
        {access.econOnly && (
          <span className="text-[10px] uppercase font-bold text-secondary tracking-wider">
            View only
          </span>
        )}
      </div>
      <div className="h-px w-full bg-border/50 my-1" />
      <div className="flex items-center gap-2">
        <span
          className="w-2 h-2 rounded-full shadow-sm"
          style={{ backgroundColor: toneDotStyle(access.tone) }}
        />
        <span className="text-muted-foreground font-medium">{access.label}</span>
      </div>
      {access.econOnly && (
        <div className="text-[10px] text-muted-foreground mt-0.5">
          Browse every page. You cannot act here yet.
        </div>
      )}
      {filterHighlight && (
        <div className="text-muted-foreground mt-0.5">
          <span className="font-medium text-foreground">{filterHighlight.value}</span>
          <span className="text-[10px] block mt-0.5">{filterHighlight.label}</span>
        </div>
      )}
      {corpsCount !== undefined && corpsCount > 0 && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <svg className="w-3 h-3 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
            />
          </svg>
          <span>
            {corpsCount} Corporation{corpsCount !== 1 ? "s" : ""}
          </span>
        </div>
      )}
      {showClickHint && (
        <span className="text-[10px] text-muted-foreground mt-1 italic">Click to enter</span>
      )}
    </div>
  );
}
