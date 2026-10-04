"use client";

import { useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui";
import type { CommodityHistoryBasisChange, CommodityHistorySeries } from "@/lib/corporations/types";
import { DenseSection, Segmented, TableScroll, Td, Th } from "./dense/DenseKit";
import { DenseLineChart, type LineSeries } from "./dense/DenseLineChart";

type ChartMode = "share" | "output" | "stockpile";

const MODE_LABELS: Record<ChartMode, string> = {
  share: "Share %",
  output: "Output",
  stockpile: "Stockpile",
};

function fmtUnits(n: number): string {
  const abs = Math.abs(n);
  const decimals = abs > 0 && abs < 10 ? 1 : 0;
  return n.toLocaleString("en-US", { maximumFractionDigits: decimals });
}

/**
 * Charts > Market share: time series of this corporation's share of global
 * commodity output, plus raw output vs global supply and global stockpile.
 */
export function MarketSharePanel({
  corpId,
  modViewEnabled = false,
}: {
  corpId: string;
  modViewEnabled?: boolean;
}) {
  const [series, setSeries] = useState<CommodityHistorySeries[]>([]);
  const [basisChange, setBasisChange] = useState<CommodityHistoryBasisChange | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeCommodity, setActiveCommodity] = useState<string | null>(null);
  const [chartMode, setChartMode] = useState<ChartMode>("share");

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

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  if (series.length === 0) {
    return (
      <DenseSection title="Market share">
        <p className="py-2 text-xs text-muted">
          No historical output data yet. Your share of global commodity supply will appear here
          after a few turns of activity. Check the Commodities tab for current flows.
        </p>
      </DenseSection>
    );
  }

  const points = active?.points ?? [];
  const hasShare = points.some((p) => p.sharePercent != null);
  const hasStock = points.some((p) => p.stockUnits != null);
  const modes = (
    [
      ["share", hasShare],
      ["output", true],
      ["stockpile", hasStock],
    ] as const
  )
    .filter(([, enabled]) => enabled)
    .map(([mode]) => ({ value: mode as ChartMode, label: MODE_LABELS[mode] }));
  // A commodity without share or stock data falls back to output.
  const mode: ChartMode = modes.some((m) => m.value === chartMode) ? chartMode : "output";

  const getPrimary = (p: (typeof points)[number]) => {
    if (mode === "share") return p.sharePercent ?? 0;
    if (mode === "stockpile") return p.stockUnits ?? 0;
    return p.outputUnits;
  };
  const unit = active ? ` ${active.unit}` : "";
  const formatVal = (v: number) =>
    mode === "share" ? `${v.toFixed(1)}%` : `${fmtUnits(v)}${unit}`;

  const lines: LineSeries[] = [
    {
      label:
        mode === "share" ? "Your share" : mode === "stockpile" ? "Global stockpile" : "Your output",
      values: points.map(getPrimary),
      tone: "text-foreground",
    },
  ];
  if (mode === "output") {
    lines.push({
      label: "Global supply",
      values: points.map((p) => p.globalSupplyUnits ?? 0),
      tone: "text-muted",
      dashed: true,
    });
  }

  // Shares are often fractions of a percent; whole-percent ticks would repeat.
  const shareSpan = Math.max(...lines[0].values, 0) - Math.min(...lines[0].values, 0);
  const shareTickDecimals = shareSpan < 1 ? 2 : shareSpan < 10 ? 1 : 0;

  const basisPointIndex = basisChange
    ? points.findIndex((point) => point.turn >= basisChange.turn)
    : -1;

  return (
    <DenseSection
      title="Market share"
      meta={active ? `${active.label}, by physical units` : undefined}
      actions={
        <Segmented
          ariaLabel="Market share measure"
          options={modes}
          value={mode}
          onChange={setChartMode}
        />
      }
    >
      <p className="py-1 text-xs text-muted">
        Your corporation&rsquo;s share of global commodity output over time, by physical units
        produced, not industry revenue. Output compares your production with global supply;
        stockpile is the global shadow inventory from the market ledger.
      </p>

      {basisChange && (
        <p className="py-1 text-xs text-foreground">
          <span className="font-semibold text-warning">
            Reporting basis changed at turn {basisChange.turn}.
          </span>{" "}
          Earlier points estimated output from revenue. From this turn onward, the chart uses
          measured plant output. A step at this marker is a reporting correction, not production
          disappearing.
        </p>
      )}

      <div className="pb-3 pt-1">
        {active && points.length >= 2 ? (
          <DenseLineChart
            turns={points.map((p) => p.turn)}
            series={lines}
            formatTick={(v) =>
              mode === "share" ? `${v.toFixed(shareTickDecimals)}%` : fmtUnits(v)
            }
            marker={basisPointIndex > 0 ? { index: basisPointIndex, label: "Basis changed" } : null}
            ariaLabel={`${active.label} ${MODE_LABELS[mode]} by turn`}
            tooltip={(i) => {
              const p = points[i];
              return (
                <table className="border-collapse">
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.label}>
                        <td className={`pr-3 ${l.tone}`}>{l.label}</td>
                        <td className="text-right font-mono tabular-nums text-foreground">
                          {formatVal(l.values[i])}
                        </td>
                      </tr>
                    ))}
                    {mode === "share" && p.outputUnits > 0 && (
                      <tr className="text-muted">
                        <td className="pr-3">Output</td>
                        <td className="text-right font-mono tabular-nums">
                          {fmtUnits(p.outputUnits)} of{" "}
                          {p.globalSupplyUnits != null ? fmtUnits(p.globalSupplyUnits) : "?"}
                          {unit}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              );
            }}
          />
        ) : (
          <p className="py-2 text-xs text-muted">
            Need at least two turns of data for {active?.label ?? "this commodity"}.
          </p>
        )}
      </div>
      <TableScroll>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <Th>Commodity</Th>
              <Th align="right">Share</Th>
              <Th align="right">Your output</Th>
              <Th align="right">Global supply</Th>
            </tr>
          </thead>
          <tbody>
            {series.map((s) => {
              const selected = s.commodity === activeCommodity;
              const last = s.points[s.points.length - 1];
              return (
                <tr key={s.commodity} className={selected ? "bg-card-elevated" : undefined}>
                  <Td numeric={false}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setActiveCommodity(s.commodity)}
                      className={`text-left text-foreground hover:underline ${selected ? "font-semibold" : ""}`}
                    >
                      {s.label}
                    </button>
                  </Td>
                  <Td align="right">
                    {last?.sharePercent != null ? `${last.sharePercent.toFixed(1)}%` : ""}
                  </Td>
                  <Td align="right">{last ? `${fmtUnits(last.outputUnits)} ${s.unit}` : ""}</Td>
                  <Td align="right">
                    {last?.globalSupplyUnits != null
                      ? `${fmtUnits(last.globalSupplyUnits)} ${s.unit}`
                      : ""}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroll>
    </DenseSection>
  );
}
