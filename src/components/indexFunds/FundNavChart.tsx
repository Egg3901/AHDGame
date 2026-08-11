"use client";

import { useMemo, useRef, useState } from "react";
import { useCurrency } from "@/contexts/CurrencyContext";
import { formatFundsCompact } from "@/lib/utils/formatters";

type Point = { turn: number; quotedNav: number };

type Range = "24H" | "7D" | "30D" | "ALL";

function downsample<T>(arr: T[], step: number): T[] {
  if (step <= 1 || arr.length === 0) return arr;
  const result: T[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (i % step === 0 || i === arr.length - 1) result.push(arr[i]);
  }
  return result;
}

/**
 * Inline-SVG area chart of fund NAV over time, with a 4-way range pill toggle
 * (24H / 7D / 30D / ALL). The viewBox is fixed; the SVG scales to width. The
 * hover handler reads mouse-x against the rendered element's rect so the
 * crosshair follows the pointer even after window resize.
 */
export function FundNavChart({ history }: { history: Point[] }) {
  const { resolveDisplayAt } = useCurrency();
  const [range, setRange] = useState<Range>("7D");
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const ordered = useMemo(() => history.slice().sort((a, b) => a.turn - b.turn), [history]);

  const sliced = useMemo(() => {
    if (ordered.length === 0) return [] as Point[];
    let pts: Point[];
    if (range === "ALL") {
      pts = ordered;
    } else {
      const lastTurn = ordered[ordered.length - 1].turn;
      const window = range === "24H" ? 24 : range === "7D" ? 24 * 7 : 24 * 30;
      const cutoff = lastTurn - window;
      pts = ordered.filter((p) => p.turn >= cutoff);
    }
    // Downsample dense ranges so the chart stays responsive
    const step = range === "ALL" ? 5 : range === "30D" ? 3 : 1;
    return downsample(pts, step);
  }, [ordered, range]);

  type Pt = { x: number; y: number; p: Point; display: { value: number; symbol: string } };
  const points = useMemo<Pt[]>(() => {
    if (sliced.length < 2) return [];
    const displays = sliced.map((p) => resolveDisplayAt(p.quotedNav, undefined));
    let minVal = Infinity;
    let maxVal = -Infinity;
    for (const d of displays) {
      if (d.value < minVal) minVal = d.value;
      if (d.value > maxVal) maxVal = d.value;
    }
    const pad = (maxVal - minVal) * 0.06 || 1;
    minVal -= pad;
    maxVal += pad;
    const range = maxVal - minVal || 1;
    const X = (i: number) => 2 + (i / (sliced.length - 1)) * 96;
    const Y = (v: number) => 3 + (1 - (v - minVal) / range) * 92;
    return sliced.map((p, i) => ({ x: X(i), y: Y(displays[i].value), p, display: displays[i] }));
  }, [sliced, resolveDisplayAt]);

  const isUp = sliced.length >= 2 && sliced[sliced.length - 1].quotedNav >= sliced[0].quotedNav;
  const changePct =
    sliced.length >= 2 ? (sliced[sliced.length - 1].quotedNav / sliced[0].quotedNav - 1) * 100 : 0;
  const stroke = isUp ? "var(--success)" : "var(--error)";

  const minVal = points.length ? Math.min(...points.map((p) => p.display.value)) : 0;
  const maxVal = points.length ? Math.max(...points.map((p) => p.display.value)) : 0;
  const symbol = points[points.length - 1]?.display.symbol ?? "₳";
  const fmt = (v: number) => formatFundsCompact(Math.round(v), symbol);

  // Build paths
  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(" ");
  const areaPath =
    points.length > 0
      ? `${linePath} L ${points[points.length - 1].x.toFixed(2)} 97 L ${points[0].x.toFixed(2)} 97 Z`
      : "";

  const onMove = (e: React.MouseEvent) => {
    if (!wrapRef.current || points.length === 0) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHoverIdx(Math.round(frac * (points.length - 1)));
  };

  if (history.length < 2) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted">
        Not enough NAV history yet — check back after the next turn.
      </div>
    );
  }

  const lastPoint = points[points.length - 1];
  const firstPoint = points[0];
  const firstTurn = firstPoint?.p.turn ?? null;
  const lastTurn = lastPoint?.p.turn ?? null;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 px-5 pt-5">
        <div className="flex items-baseline gap-3">
          <h2 className="text-sm font-semibold">Net asset value</h2>
          <span className="font-mono tabular-nums text-xs font-semibold" style={{ color: stroke }}>
            {(changePct >= 0 ? "+" : "") + changePct.toFixed(2)}% · {range}
          </span>
        </div>
        <div className="flex gap-0.5 rounded-lg border border-card-border bg-card-elevated p-0.5">
          {(["24H", "7D", "30D", "ALL"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                setRange(r);
                setHoverIdx(null);
              }}
              className={`rounded-md border px-2.5 py-1 font-mono text-[10px] font-bold transition-all ${
                range === r
                  ? "border-primary/45 bg-primary/14 text-primary"
                  : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="flex px-5 pt-4">
        <div
          ref={wrapRef}
          onMouseMove={onMove}
          onMouseLeave={() => setHoverIdx(null)}
          className="relative h-[250px] min-w-0 flex-1 cursor-crosshair"
        >
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="block h-full w-full"
            aria-label="NAV history"
          >
            {/* gridlines */}
            <line
              x1={0}
              y1={3}
              x2={100}
              y2={3}
              stroke="var(--card-border)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              strokeDasharray="2 5"
            />
            <line
              x1={0}
              y1={50}
              x2={100}
              y2={50}
              stroke="var(--card-border)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              strokeDasharray="2 5"
            />
            <line
              x1={0}
              y1={97}
              x2={100}
              y2={97}
              stroke="var(--card-border)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            {areaPath && (
              <path d={areaPath} fill={`color-mix(in srgb, ${stroke} 10%, transparent)`} />
            )}
            {linePath && (
              <path
                d={linePath}
                fill="none"
                stroke={stroke}
                strokeWidth={1.8}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
              />
            )}
          </svg>

          {hoverIdx != null && points[hoverIdx] && (
            <>
              <div
                className="pointer-events-none absolute top-0 bottom-0 w-px"
                style={{
                  left: `${points[hoverIdx].x}%`,
                  background: "color-mix(in srgb, var(--foreground) 28%, transparent)",
                }}
              />
              <div
                className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-glow-sm"
                style={{
                  left: `${points[hoverIdx].x}%`,
                  top: `${points[hoverIdx].y}%`,
                  background: stroke,
                  borderColor: "var(--card)",
                }}
              />
              <div
                className="pointer-events-none absolute top-2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-card-border bg-card-elevated px-2.5 py-1.5 shadow-panel"
                style={{ left: `${points[hoverIdx].x}%` }}
              >
                <div className="font-mono tabular-nums text-[13px] font-bold">
                  {fmt(points[hoverIdx].display.value)}
                </div>
                <div className="mt-0.5 text-[10px] text-muted">
                  Turn {points[hoverIdx].p.turn.toLocaleString("en-US")}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="ml-3 flex h-[250px] flex-shrink-0 flex-col justify-between py-0 text-right">
          <span className="font-mono tabular-nums text-[10px] text-muted">{fmt(maxVal)}</span>
          <span className="font-mono tabular-nums text-[10px] text-muted">
            {fmt((maxVal + minVal) / 2)}
          </span>
          <span className="font-mono tabular-nums text-[10px] text-muted">{fmt(minVal)}</span>
        </div>
      </div>

      <div className="flex justify-between px-5 pb-3.5 pt-2">
        <span className="font-mono text-[10px] text-muted">
          {firstTurn != null ? `Turn ${firstTurn.toLocaleString("en-US")}` : ""}
        </span>
        <span className="font-mono text-[10px] text-muted">
          {lastTurn != null ? `Turn ${lastTurn.toLocaleString("en-US")} · now` : ""}
        </span>
      </div>
    </div>
  );
}
