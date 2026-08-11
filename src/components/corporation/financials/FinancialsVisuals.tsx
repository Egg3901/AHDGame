"use client";

import { Meter } from "../market/MarketPrimitives";
import type { AllocSegment, AllocTone } from "./financialsModel";

// Static class strings so Tailwind keeps them; tokens only.
const SEG_BG: Record<AllocTone, string> = {
  maintenance: "bg-error/70",
  growth: "bg-warning/80",
  marketing: "bg-info/70",
  logistics: "bg-accent/70",
  rd: "bg-secondary/70",
  salary: "bg-info/40",
  tax: "bg-muted/60",
  interest: "bg-primary/70",
};
const SEG_DOT: Record<AllocTone, string> = {
  maintenance: "bg-error/70",
  growth: "bg-warning/80",
  marketing: "bg-info/70",
  logistics: "bg-accent/70",
  rd: "bg-secondary/70",
  salary: "bg-info/40",
  tax: "bg-muted/60",
  interest: "bg-primary/70",
};

/** Horizontal 100%-of-gross-revenue bar: cost segments + remaining net income. */
export function AllocationBar({
  revenue,
  segments,
  netPct,
  netIsLoss,
}: {
  revenue: number;
  segments: AllocSegment[];
  netPct: number;
  netIsLoss: boolean;
}) {
  if (revenue <= 0) {
    return <p className="text-xs text-muted">No revenue to allocate.</p>;
  }
  const netWidth = Math.max(0, Math.min(100, netPct));
  return (
    <div className="space-y-2">
      <div className="flex h-3 w-full overflow-hidden rounded-full border border-card-border bg-card-muted">
        {segments.map((s) => (
          <div
            key={s.key}
            className={SEG_BG[s.tone]}
            style={{ width: `${Math.max(0, Math.min(100, s.pct))}%` }}
            title={`${s.label}: ${s.pct.toFixed(1)}% of revenue`}
          />
        ))}
        {!netIsLoss && (
          <div
            className="bg-success/80"
            style={{ width: `${netWidth}%` }}
            title={`Net income: ${netPct.toFixed(1)}% of revenue`}
          />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {segments.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1 text-[10px] text-muted">
            <span className={`h-2 w-2 rounded-sm ${SEG_DOT[s.tone]}`} />
            {s.label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1 text-[10px] text-muted">
          <span className="h-2 w-2 rounded-sm bg-success/80" />
          {netIsLoss ? "Net loss" : "Net income"}
        </span>
      </div>
    </div>
  );
}

/** Vertical waterfall: gross revenue on top, each cost as a red drain row, net income last. */
export function Waterfall({
  revenue,
  segments,
  netIncome,
  netPct,
  format,
}: {
  revenue: number;
  segments: AllocSegment[];
  netIncome: number;
  netPct: number;
  format: (v: number) => string;
}) {
  if (revenue <= 0) {
    return <p className="text-xs text-muted">No revenue to allocate.</p>;
  }
  const netIsLoss = netIncome < 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-foreground">Gross Revenue</span>
        <span className="tabular-nums font-semibold text-foreground">{format(revenue)}</span>
      </div>
      {segments.map((s) => (
        <div key={s.key} className="flex items-center justify-between text-xs">
          <span className="pl-3 text-muted">{s.label}</span>
          <span className="tabular-nums text-error">
            - {format(s.value)}
            <span className="ml-1.5 text-[10px] text-muted">{s.pct.toFixed(1)}%</span>
          </span>
        </div>
      ))}
      <div className="flex items-center justify-between border-t border-card-border pt-1.5 text-xs">
        <span className="font-bold text-foreground">{netIsLoss ? "Net Loss" : "Net Income"}</span>
        <span className={`tabular-nums font-bold ${netIsLoss ? "text-error" : "text-success"}`}>
          {format(netIncome)}
          <span className="ml-1.5 text-[10px] font-normal text-muted">{netPct.toFixed(1)}%</span>
        </span>
      </div>
    </div>
  );
}

/** Detailed readout of the same segments: label, % of revenue, value, mini meter. */
export function CostMixList({
  segments,
  format,
}: {
  segments: AllocSegment[];
  format: (v: number) => string;
}) {
  if (segments.length === 0) {
    return <p className="text-xs text-muted">No operating costs this period.</p>;
  }
  const maxPct = Math.max(...segments.map((s) => s.pct), 1);
  return (
    <div className="space-y-2.5">
      {segments.map((s) => (
        <div key={s.key} className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted">{s.label}</span>
            <span className="tabular-nums text-foreground">
              {format(s.value)}
              <span className="ml-1.5 text-[10px] text-muted">{s.pct.toFixed(1)}%</span>
            </span>
          </div>
          <Meter value={s.pct} max={maxPct} tone="down" height={4} />
        </div>
      ))}
    </div>
  );
}

/** Single labelled gauge (net margin, etc). */
export function MarginGauge({
  label,
  pct,
  tone,
}: {
  label: string;
  pct: number;
  tone: "up" | "down" | "warning" | "brand";
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="tabular-nums font-semibold text-foreground">{pct.toFixed(1)}%</span>
      </div>
      <Meter value={Math.max(0, pct)} max={100} tone={tone} height={6} />
    </div>
  );
}
