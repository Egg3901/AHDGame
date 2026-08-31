"use client";

import { useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui";
import type { CommodityHistoryBasisChange, CommodityHistorySeries } from "@/lib/corporations/types";

type ChartMode = "share" | "output" | "stockpile";

const CHART_WIDTH = 640;
const CHART_HEIGHT = 200;
const C_PAD_LEFT = 56;
const C_PAD_RIGHT = 16;
const C_PAD_TOP = 16;
const C_PAD_BOTTOM = 32;
const C_INNER_W = CHART_WIDTH - C_PAD_LEFT - C_PAD_RIGHT;
const C_INNER_H = CHART_HEIGHT - C_PAD_TOP - C_PAD_BOTTOM;

function fmtUnits(n: number): string {
  const abs = Math.abs(n);
  const decimals = abs > 0 && abs < 10 ? 1 : 0;
  return n.toLocaleString("en-US", { maximumFractionDigits: decimals });
}

/**
 * Charts → Market Share: time series of this corporation's share of global
 * commodity output, plus raw output vs global supply and global stockpile.
 */
export function MarketSharePanel({
  corpId,
  brandColor,
  modViewEnabled = false,
}: {
  corpId: string;
  brandColor?: string;
  modViewEnabled?: boolean;
}) {
  const [series, setSeries] = useState<CommodityHistorySeries[]>([]);
  const [basisChange, setBasisChange] = useState<CommodityHistoryBasisChange | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeCommodity, setActiveCommodity] = useState<string | null>(null);
  const [chartMode, setChartMode] = useState<ChartMode>("share");
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const url = modViewEnabled
          ? `/api/corporations/${corpId}/commodity-history?modView=1`
          : `/api/corporations/${corpId}/commodity-history`;
        const res = await fetch(url);
        if (res.ok && !cancelled) {
          const data = (await res.json()) as {
            series?: CommodityHistorySeries[];
            basisChange?: CommodityHistoryBasisChange | null;
          };
          const next = data.series ?? [];
          setSeries(next);
          setBasisChange(data.basisChange ?? null);
          setActiveCommodity((prev) => {
            if (prev && next.some((s) => s.commodity === prev)) return prev;
            return next[0]?.commodity ?? null;
          });
        }
      } catch {
        // render empty state
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [corpId, modViewEnabled]);

  const active = useMemo(
    () => series.find((s) => s.commodity === activeCommodity) ?? null,
    [series, activeCommodity]
  );

  const accent = brandColor || "#06b6d4";
  const secondaryColor = "#94a3b8";

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full max-w-xl rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (series.length === 0) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-8 text-center space-y-2">
        <p className="text-sm font-semibold text-foreground">Commodity output share</p>
        <p className="text-sm text-muted max-w-lg mx-auto">
          No historical output data yet. Your share of global commodity supply will appear here
          after a few turns of activity. Check the Commodities tab for current flows.
        </p>
      </div>
    );
  }

  const points = active?.points ?? [];
  const hasShare = points.some((p) => p.sharePercent != null);
  const hasStock = points.some((p) => p.stockUnits != null);

  const getPrimary = (p: (typeof points)[number]) => {
    if (chartMode === "share") return p.sharePercent ?? 0;
    if (chartMode === "stockpile") return p.stockUnits ?? 0;
    return p.outputUnits;
  };

  const primaryVals = points.map(getPrimary);
  const secondaryVals = chartMode === "output" ? points.map((p) => p.globalSupplyUnits ?? 0) : [];
  const allVals = [...primaryVals, ...secondaryVals];
  const minVal = allVals.length ? Math.min(...allVals) : 0;
  const maxVal = allVals.length ? Math.max(...allVals) : 1;
  const range = maxVal - minVal || 1;
  const yMin = minVal - range * 0.05;
  const yMax = maxVal + range * 0.05;
  const yRange = yMax - yMin || 1;

  const toX = (i: number) => {
    if (points.length <= 1) return C_PAD_LEFT + C_INNER_W / 2;
    return C_PAD_LEFT + (i / (points.length - 1)) * C_INNER_W;
  };
  const toY = (value: number) => C_PAD_TOP + ((yMax - value) / yRange) * C_INNER_H;

  const line1 = primaryVals.map((v, i) => ({ x: toX(i), y: toY(v), value: v }));
  const polyline1 = line1.map((p) => `${p.x},${p.y}`).join(" ");
  const line2 =
    chartMode === "output"
      ? secondaryVals.map((v, i) => ({ x: toX(i), y: toY(v), value: v }))
      : null;
  const polyline2 = line2?.map((p) => `${p.x},${p.y}`).join(" ");

  const yTicks = Array.from({ length: 5 }, (_, i) => yMin + (yRange * i) / 4);

  const formatVal = (v: number) => {
    if (chartMode === "share") return `${v.toFixed(1)}%`;
    return `${fmtUnits(v)}${active ? ` ${active.unit}` : ""}`;
  };

  const modeLabels: Record<ChartMode, string> = {
    share: "Share %",
    output: "Output",
    stockpile: "Stockpile",
  };

  const lastPoint = points[points.length - 1];
  const currentVal = lastPoint ? getPrimary(lastPoint) : 0;
  const basisPointIndex = basisChange
    ? points.findIndex((point) => point.turn >= basisChange.turn)
    : -1;
  const basisX = basisPointIndex > 0 ? toX(basisPointIndex) : null;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        Your corporation&rsquo;s share of global commodity output over time — by physical units
        produced, not industry revenue. Toggle between share %, raw output vs global supply, and
        global stockpile (shadow inventory from the market ledger).
      </p>

      {basisChange && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-foreground">
          <span className="font-semibold">Reporting basis changed at turn {basisChange.turn}.</span>{" "}
          Earlier points estimated output from revenue. From this turn onward, the chart uses
          measured plant output. A step at this marker is a reporting correction, not production
          disappearing.
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {series.map((s) => (
          <button
            key={s.commodity}
            type="button"
            onClick={() => {
              setActiveCommodity(s.commodity);
              setHovered(null);
            }}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              activeCommodity === s.commodity
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-card-border bg-card hover:bg-card-elevated text-foreground"
            }`}
          >
            <span>{s.icon}</span>
            {s.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["share", hasShare],
            ["output", true],
            ["stockpile", hasStock],
          ] as const
        )
          .filter(([, enabled]) => enabled)
          .map(([mode]) => (
            <button
              key={mode}
              type="button"
              onClick={() => {
                setChartMode(mode);
                setHovered(null);
              }}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                chartMode === mode
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-card-border bg-card text-muted hover:text-foreground"
              }`}
            >
              {modeLabels[mode]}
            </button>
          ))}
      </div>

      {active && points.length >= 2 ? (
        <div className="rounded-xl border border-card-border bg-card p-4">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {active.icon} {active.label}
              </h3>
              <p className="mt-0.5 text-xs text-muted">{modeLabels[chartMode]} over time</p>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted">
                Current
              </div>
              <div className="text-2xl font-bold tabular-nums" style={{ color: accent }}>
                {formatVal(currentVal)}
              </div>
            </div>
          </div>

          <div className="relative select-none">
            <svg
              viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
              className="w-full"
              style={{ height: CHART_HEIGHT }}
              onMouseLeave={() => setHovered(null)}
            >
              {yTicks.map((tick, i) => {
                const y = toY(tick);
                return (
                  <g key={i}>
                    <line
                      x1={C_PAD_LEFT}
                      y1={y}
                      x2={CHART_WIDTH - C_PAD_RIGHT}
                      y2={y}
                      stroke="currentColor"
                      strokeWidth={1}
                      className="text-card-border/40"
                      strokeDasharray={i === 0 || i === 4 ? undefined : "3 3"}
                    />
                    <text
                      x={C_PAD_LEFT - 6}
                      y={y + 4}
                      textAnchor="end"
                      fontSize={9}
                      className="fill-muted/70"
                    >
                      {chartMode === "share" ? `${tick.toFixed(0)}%` : fmtUnits(tick)}
                    </text>
                  </g>
                );
              })}

              {basisX != null && (
                <>
                  <line
                    x1={basisX}
                    y1={C_PAD_TOP}
                    x2={basisX}
                    y2={C_PAD_TOP + C_INNER_H}
                    stroke="currentColor"
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    className="text-amber-400"
                  />
                  <text x={basisX + 4} y={C_PAD_TOP + 10} fontSize={9} className="fill-amber-400">
                    Basis changed
                  </text>
                </>
              )}

              <polygon
                points={`${line1[0].x},${C_PAD_TOP + C_INNER_H} ${polyline1} ${line1[line1.length - 1].x},${C_PAD_TOP + C_INNER_H}`}
                fill={accent}
                fillOpacity={0.12}
              />

              {polyline2 && line2 && (
                <>
                  <polygon
                    points={`${line2[0].x},${C_PAD_TOP + C_INNER_H} ${polyline2} ${line2[line2.length - 1].x},${C_PAD_TOP + C_INNER_H}`}
                    fill={secondaryColor}
                    fillOpacity={0.08}
                  />
                  <polyline
                    points={polyline2}
                    fill="none"
                    stroke={secondaryColor}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    opacity={0.8}
                  />
                </>
              )}

              <polyline
                points={polyline1}
                fill="none"
                stroke={accent}
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />

              {line1.map((p, i) => {
                const prevX = i > 0 ? line1[i - 1].x : p.x;
                const nextX = i < line1.length - 1 ? line1[i + 1].x : p.x;
                const hitX = (prevX + p.x) / 2;
                const hitW = (nextX + p.x) / 2 - hitX;
                return (
                  <rect
                    key={i}
                    x={hitX}
                    y={C_PAD_TOP}
                    width={Math.max(hitW, 8)}
                    height={C_INNER_H}
                    fill="transparent"
                    onMouseEnter={() => setHovered(i)}
                  />
                );
              })}

              {hovered !== null && line1[hovered] && (
                <>
                  <line
                    x1={line1[hovered].x}
                    y1={C_PAD_TOP}
                    x2={line1[hovered].x}
                    y2={C_PAD_TOP + C_INNER_H}
                    stroke={accent}
                    strokeWidth={1}
                    strokeDasharray="3 2"
                    opacity={0.6}
                  />
                  <circle cx={line1[hovered].x} cy={line1[hovered].y} r={4} fill={accent} />
                  {line2?.[hovered] && (
                    <circle
                      cx={line2[hovered].x}
                      cy={line2[hovered].y}
                      r={4}
                      fill={secondaryColor}
                    />
                  )}
                </>
              )}

              {points.map((p, i) =>
                i === 0 || i === points.length - 1 || i % Math.ceil(points.length / 5) === 0 ? (
                  <text
                    key={p.turn}
                    x={toX(i)}
                    y={CHART_HEIGHT - 6}
                    textAnchor="middle"
                    fontSize={9}
                    className="fill-muted/70"
                  >
                    T{p.turn}
                  </text>
                ) : null
              )}
            </svg>

            {hovered !== null && points[hovered] && (
              <div className="pointer-events-none absolute top-2 right-3 rounded-lg border border-card-border bg-card px-3 py-2 text-xs shadow-card space-y-1">
                <div className="text-muted">Turn {points[hovered].turn}</div>
                <div className="font-semibold tabular-nums" style={{ color: accent }}>
                  {chartMode === "share" && points[hovered].sharePercent != null
                    ? `Share: ${points[hovered].sharePercent!.toFixed(1)}%`
                    : chartMode === "stockpile"
                      ? `Stock: ${fmtUnits(points[hovered].stockUnits ?? 0)} ${active.unit}`
                      : `Your output: ${fmtUnits(points[hovered].outputUnits)} ${active.unit}`}
                </div>
                {chartMode === "output" && (
                  <div className="font-semibold tabular-nums text-muted">
                    Global supply:{" "}
                    {points[hovered].globalSupplyUnits != null
                      ? `${fmtUnits(points[hovered].globalSupplyUnits!)} ${active.unit}`
                      : "—"}
                  </div>
                )}
                {chartMode === "share" && points[hovered].outputUnits > 0 && (
                  <div className="text-muted tabular-nums">
                    {fmtUnits(points[hovered].outputUnits)} of{" "}
                    {points[hovered].globalSupplyUnits != null
                      ? fmtUnits(points[hovered].globalSupplyUnits!)
                      : "?"}{" "}
                    {active.unit}
                  </div>
                )}
              </div>
            )}
          </div>

          {chartMode === "output" && (
            <div className="flex items-center justify-center gap-6 mt-3 pt-3 border-t border-card-border/50">
              <div className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-4 rounded-full"
                  style={{ backgroundColor: accent }}
                />
                <span className="text-xs text-muted">Your output</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-4 rounded-full"
                  style={{ backgroundColor: secondaryColor }}
                />
                <span className="text-xs text-muted">Global supply</span>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-card-border bg-card p-6 text-center text-sm text-muted">
          Need at least two turns of data for {active?.label ?? "this commodity"}.
        </div>
      )}

      {lastPoint && chartMode === "share" && lastPoint.sharePercent != null && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-card-border bg-card p-4">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted">
              Latest share
            </div>
            <div className="mt-1 text-lg font-bold tabular-nums" style={{ color: accent }}>
              {lastPoint.sharePercent.toFixed(1)}%
            </div>
          </div>
          <div className="rounded-xl border border-card-border bg-card p-4">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted">
              Your output
            </div>
            <div className="mt-1 text-lg font-bold tabular-nums text-foreground">
              {fmtUnits(lastPoint.outputUnits)} {active?.unit}
            </div>
          </div>
          <div className="rounded-xl border border-card-border bg-card p-4 col-span-2 sm:col-span-1">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted">
              Global supply
            </div>
            <div className="mt-1 text-lg font-bold tabular-nums text-foreground">
              {lastPoint.globalSupplyUnits != null
                ? `${fmtUnits(lastPoint.globalSupplyUnits)} ${active?.unit}`
                : "—"}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
