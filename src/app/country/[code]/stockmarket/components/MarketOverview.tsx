"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Skeleton } from "@/components/ui";
import {
  ALL_EXCHANGES,
  getExchangeApiKey,
  getExchangeLabel,
} from "@/lib/constants/exchangeRegistry";
import { CORPORATION_TYPE_LABELS, type CorporationType } from "@/lib/constants/corporations";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { ExchangeFilter } from "../types";
import type { ExchangeMetaEntry } from "../stockMarketRouting";
import type {
  CandlestickData,
  HistogramData,
  IChartApi,
  ISeriesApi,
  LineData,
  Time,
  UTCTimestamp,
} from "lightweight-charts";

/* ------------------------------------------------------------------ */
/* Range model: turns on the wire, labels in the UI.                   */
/* ------------------------------------------------------------------ */

const RANGES = [
  { key: "24H", label: "24H", turns: 24 },
  { key: "7D", label: "7D", turns: 168 },
  { key: "1M", label: "1M", turns: 720 },
  { key: "1Y", label: "1Y", turns: 8760 },
  { key: "ALL", label: "ALL", turns: 0 },
] as const;

type RangeKey = (typeof RANGES)[number]["key"];

interface CandleDto {
  turn: number;
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  intraday: boolean;
}

interface CandlesResponse {
  exchange: string;
  turns: number;
  bucketed: boolean;
  bucketTurns: number;
  points: CandleDto[];
  intradayTurns: number;
  totalTurns: number;
}

type CompareKey = { kind: "venue"; api: string } | { kind: "sector"; sector: CorporationType };

function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function ma(values: number[], window: number): (number | null)[] {
  return values.map((_, i) => {
    if (i + 1 < window) return null;
    let sum = 0;
    for (let j = i - window + 1; j <= i; j++) sum += values[j];
    return sum / window;
  });
}

export function MarketOverview({
  exchangeFilter,
  exchangeMeta,
}: {
  exchangeFilter: ExchangeFilter;
  exchangeMeta?: Record<string, ExchangeMetaEntry>;
}) {
  const { formatAmount } = useCurrency();
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const ma20Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ma50Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const compareRef = useRef<ISeriesApi<"Line"> | null>(null);

  const [range, setRange] = useState<RangeKey>("7D");
  const [showMa20, setShowMa20] = useState(false);
  const [showMa50, setShowMa50] = useState(false);
  const [compare, setCompare] = useState<CompareKey | null>(null);
  const [compareError, setCompareError] = useState(false);
  const [candles, setCandles] = useState<CandleDto[]>([]);
  const [bucketed, setBucketed] = useState(false);
  const [intradayTurns, setIntradayTurns] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [chartReady, setChartReady] = useState(false);

  const exchangeApi =
    exchangeFilter === "global" ? "global" : (getExchangeApiKey(exchangeFilter) ?? "global");
  const exchangeLabel = exchangeFilter === "global" ? "Global" : getExchangeLabel(exchangeFilter);

  const turns = RANGES.find((r) => r.key === range)?.turns ?? 168;
  const candlesRef = useRef<CandleDto[]>([]);

  const fmt = (n: number | undefined): string =>
    n === undefined ? "—" : formatAmount(Math.round(n));

  /* ---------------- chart lifecycle (mount once) ---------------- */
  useEffect(() => {
    let disposed = false;
    let chart: IChartApi | null = null;
    let observer: ResizeObserver | null = null;
    (async () => {
      const container = containerRef.current;
      // The container renders unconditionally (fixed heights with overlays),
      // so it is present on mount. A missing container means a render
      // contract break: fail visibly instead of a permanently blank chart.
      if (!container) {
        setFailed(true);
        return;
      }
      const { createChart, CandlestickSeries, HistogramSeries, CrosshairMode } =
        await import("lightweight-charts");
      if (disposed) return;

      const up = cssVar("--success", "#22c55e");
      const down = cssVar("--error", "#ef4444");
      const muted = cssVar("--muted", "#8f8f9d");
      const border = cssVar("--card-border", "#2a2a3d");
      const turnLabel = (time: number): string => {
        const candle = candlesRef.current.find((row) => row.time === time);
        return candle ? `T${candle.turn}` : "";
      };

      chart = createChart(container, {
        width: container.clientWidth,
        height: container.clientHeight,
        layout: {
          background: { color: "transparent" },
          textColor: muted,
          fontFamily: "inherit",
          fontSize: 11,
        },
        grid: { vertLines: { color: border }, horzLines: { color: border } },
        localization: { timeFormatter: (time: Time) => turnLabel(Number(time)) },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: { color: muted, style: 2, labelBackgroundColor: muted },
          horzLine: { color: muted, style: 2, labelBackgroundColor: muted },
        },
        rightPriceScale: { borderColor: border },
        timeScale: {
          borderColor: border,
          timeVisible: true,
          secondsVisible: false,
          tickMarkFormatter: (time: Time) => turnLabel(Number(time)),
        },
      });
      chartRef.current = chart;

      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: up,
        downColor: down,
        wickUpColor: up,
        wickDownColor: down,
        borderVisible: false,
        priceFormat: { type: "custom", formatter: (price: number) => fmt(price), minMove: 0.01 },
      });
      candleRef.current = candleSeries;

      const volumeSeries = chart.addSeries(
        HistogramSeries,
        { priceScaleId: "", priceFormat: { type: "volume" } },
        1
      );
      volumeRef.current = volumeSeries;
      chart.priceScale("").applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
      setChartReady(true);

      chart.subscribeCrosshairMove((param) => {
        const tip = tooltipRef.current;
        if (!tip || !param.point || !param.time) {
          if (tip) tip.style.display = "none";
          return;
        }
        const data = param.seriesData.get(candleSeries) as CandlestickData | undefined;
        if (!data || data.open === undefined) {
          tip.style.display = "none";
          return;
        }
        const rows = candlesRef.current;
        const idx = rows.findIndex((c) => c.time === (param.time as number));
        const prev = idx > 0 ? rows[idx - 1] : null;
        const chg = prev ? data.close - prev.close : 0;
        const chgPct = prev && prev.close !== 0 ? (chg / prev.close) * 100 : 0;
        const vol = idx >= 0 ? rows[idx].volume : 0;
        const flatNote = idx >= 0 && !rows[idx].intraday ? " · turn closes" : "";
        tip.innerHTML =
          `<div class="font-mono font-bold text-foreground">T${idx >= 0 ? rows[idx].turn : ""}</div>` +
          `<div class="font-mono tabular-nums">O ${fmt(data.open)} H ${fmt(data.high)}<br/>` +
          `L ${fmt(data.low)} C ${fmt(data.close)}</div>` +
          `<div class="font-mono tabular-nums ${chg >= 0 ? "text-success" : "text-error"}">` +
          `${chg >= 0 ? "+" : ""}${fmt(chg)} (${chg >= 0 ? "+" : ""}${chgPct.toFixed(2)}%)</div>` +
          `<div class="font-mono tabular-nums text-muted">Vol ${fmt(vol)}${flatNote}</div>`;
        const box = container.getBoundingClientRect();
        tip.style.display = "block";
        tip.style.left = `${Math.min(Math.max(param.point.x + 12, 8), Math.max(box.width - 170, 8))}px`;
        tip.style.top = `${Math.min(Math.max(param.point.y - 10, 8), Math.max(box.height - 120, 8))}px`;
      });

      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(() => {
          if (!container || !chart) return;
          chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
        });
        observer.observe(container);
      }
    })().catch(() => {
      if (!disposed) setFailed(true);
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      chart?.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      ma20Ref.current = null;
      ma50Ref.current = null;
      compareRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- data: candles + volume per range ---------------- */
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-state reset on range/exchange change
    setLoading(true);
    setFailed(false);
    fetch(`/api/stock-exchange/candles?exchange=${exchangeApi}&turns=${turns}`, {
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("candles failed"))))
      .then((json: CandlesResponse) => {
        if (cancelled) return;
        setCandles(json.points ?? []);
        setBucketed(json.bucketed);
        setIntradayTurns(json.intradayTurns ?? 0);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [exchangeApi, turns]);

  /* ---------------- push candles + volume into the chart ---------------- */
  useEffect(() => {
    candlesRef.current = candles;
    const candleSeries = candleRef.current;
    const volumeSeries = volumeRef.current;
    const chart = chartRef.current;
    if (!candleSeries || !volumeSeries || !chart) return;
    const up = cssVar("--success", "#22c55e");
    const down = cssVar("--error", "#ef4444");
    candleSeries.setData(
      candles.map((c): CandlestickData<UTCTimestamp> => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
    );
    volumeSeries.setData(
      candles.map((c): HistogramData<UTCTimestamp> => ({
        time: c.time as UTCTimestamp,
        value: c.volume,
        color: c.close >= c.open ? `${up}80` : `${down}80`,
      }))
    );
    chart.timeScale().fitContent();
  }, [candles, chartReady]);

  /* ---------------- moving-average overlays ---------------- */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || candles.length === 0) return;
    let cancelled = false;
    void import("lightweight-charts").then(({ LineSeries }) => {
      if (cancelled) return;
      const closes = candles.map((c) => c.close);
      const times = candles.map((c) => c.time as UTCTimestamp);
      const sync = (
        ref: React.MutableRefObject<ISeriesApi<"Line"> | null>,
        on: boolean,
        window: number,
        color: string
      ) => {
        if (on && !ref.current) {
          ref.current = chart.addSeries(LineSeries, {
            color,
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
          });
        } else if (!on && ref.current) {
          chart.removeSeries(ref.current);
          ref.current = null;
        }
        if (on && ref.current) {
          const values = ma(closes, window);
          const data: LineData<UTCTimestamp>[] = [];
          values.forEach((v, i) => {
            if (v !== null) data.push({ time: times[i], value: v });
          });
          ref.current.setData(data);
        }
      };
      // Cyan/amber already carry meaning in the UI (commodity chips); reuse
      // them so no new palette enters the theme.
      sync(ma20Ref, showMa20, 20, "#22d3ee");
      sync(ma50Ref, showMa50, 50, "#f59e0b");
    });
    return () => {
      cancelled = true;
    };
  }, [candles, chartReady, showMa20, showMa50]);

  /* ---------------- compare overlay ---------------- */
  const compareLabel = useMemo(() => {
    if (!compare) return null;
    if (compare.kind === "venue") {
      const info = ALL_EXCHANGES.find((e) => e.apiKey === compare.api);
      return info ? `${info.exchangeName} %` : null;
    }
    return `${CORPORATION_TYPE_LABELS[compare.sector] ?? compare.sector} %`;
  }, [compare]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || candles.length === 0) return;
    let cancelled = false;
    if (!compare) {
      if (compareRef.current) {
        chart.removeSeries(compareRef.current);
        compareRef.current = null;
      }
      return;
    }
    const base = candles[0].time;
    const normalize = (series: { time: number; value: number }[]): LineData<UTCTimestamp>[] => {
      if (series.length === 0) return [];
      const first = series[0].value;
      if (!first) return [];
      return series.map((p) => ({
        time: p.time as UTCTimestamp,
        value: ((p.value - first) / first) * 100,
      }));
    };
    const applyLine = (data: LineData<UTCTimestamp>[]) => {
      if (!chart) return;
      if (data.length === 0) {
        setCompareError(true);
        compareRef.current?.setData([]);
        return;
      }
      if (!compareRef.current) {
        void import("lightweight-charts").then(({ LineSeries }) => {
          if (cancelled || !chart || compareRef.current) return;
          compareRef.current = chart.addSeries(LineSeries, {
            color: cssVar("--primary", "#dc2626"),
            lineWidth: 2,
            priceScaleId: "compare",
            priceLineVisible: false,
            lastValueVisible: true,
            crosshairMarkerVisible: true,
          });
          chart.priceScale("compare").applyOptions({ borderVisible: false });
          compareRef.current.setData(data);
        });
      } else {
        compareRef.current.setData(data);
      }
    };
    if (compare.kind === "venue") {
      fetch(`/api/stock-exchange/candles?exchange=${compare.api}&turns=${turns}`, {
        cache: "no-store",
      })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("compare failed"))))
        .then((json: CandlesResponse) => {
          if (cancelled) return;
          const pts = (json.points ?? [])
            .filter((p) => p.time >= base)
            .map((p) => ({ time: p.time, value: p.close }));
          applyLine(normalize(pts));
        })
        .catch(() => {
          if (!cancelled) setCompareError(true);
        });
    } else {
      fetch(
        `/api/stock-exchange/market-cap-history?exchange=${exchangeApi}&limit=${turns === 0 ? 2000 : turns}`,
        {
          cache: "no-store",
        }
      )
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("sector failed"))))
        .then(
          (json: {
            points?: { turn: number; createdAt: string; bySector?: Record<string, number> }[];
          }) => {
            if (cancelled) return;
            const pts = (json.points ?? [])
              .map((p) => ({
                turn: p.turn,
                time: Math.floor(new Date(p.createdAt).getTime() / 1000),
                value: p.bySector?.[compare.sector] ?? 0,
              }))
              .filter((p) => Number.isFinite(p.time) && p.value > 0);
            // Weekly buckets mirror the main series on long ranges.
            const bucketedPts =
              turns === 8760 || turns === 0
                ? candles.flatMap((c, i) => {
                    const nextTurn = candles[i + 1]?.turn ?? Infinity;
                    const week = pts.filter((p) => p.turn >= c.turn && p.turn < nextTurn);
                    const last = week[week.length - 1];
                    return last ? [{ time: c.time, value: last.value }] : [];
                  })
                : pts.filter((p) => p.time >= base);
            applyLine(normalize(bucketedPts));
          }
        )
        .catch(() => {
          if (!cancelled) setCompareError(true);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [candles, chartReady, compare, exchangeApi, turns]);

  const last = candles[candles.length - 1];
  const prev = candles.length > 1 ? candles[candles.length - 2] : null;
  const lastChg = last && prev ? last.close - prev.close : 0;
  const lastChgPct = last && prev && prev.close !== 0 ? (lastChg / prev.close) * 100 : 0;

  const venueOptions = useMemo(
    () =>
      [{ apiKey: "global", exchangeName: "Global" }, ...ALL_EXCHANGES].filter(
        (v) =>
          v.apiKey !== exchangeApi &&
          (!exchangeMeta ||
            v.apiKey === "global" ||
            Object.values(exchangeMeta).some((entry) => entry.exchangeApi === v.apiKey))
      ),
    [exchangeApi, exchangeMeta]
  );
  const sectorOptions = useMemo(
    () => Object.keys(CORPORATION_TYPE_LABELS) as CorporationType[],
    []
  );

  return (
    <div className="rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
      <div className="px-4 pt-4 pb-3 border-b border-card-border">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-muted">
              {exchangeLabel} Market · Candles
            </h3>
            {!loading && last && (
              <div className="text-sm tabular-nums">
                <span className="font-mono font-bold text-foreground">
                  {formatAmount(last.close)}
                </span>{" "}
                <span
                  className={`font-mono font-bold ${lastChg >= 0 ? "text-success" : "text-error"}`}
                >
                  {lastChg >= 0 ? "+" : ""}
                  {formatAmount(Math.round(lastChg))} ({lastChg >= 0 ? "+" : ""}
                  {lastChgPct.toFixed(2)}%)
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                title={
                  r.turns === 0
                    ? "Full recorded history"
                    : `Last ${r.turns} turns (${r.turns === 24 ? "a day" : r.turns === 168 ? "a week" : r.turns === 720 ? "a month" : "a year"})`
                }
                className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors whitespace-nowrap ${
                  range === r.key
                    ? "bg-primary/10 text-primary border-primary/20"
                    : "bg-card-elevated border-card-border text-muted hover:text-foreground hover:bg-card-elevated/80"
                }`}
              >
                {r.label}
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-card-border" />
            <button
              onClick={() => setShowMa20((v) => !v)}
              aria-pressed={showMa20}
              title="20-turn moving average of closes"
              className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors whitespace-nowrap ${
                showMa20
                  ? "bg-primary/10 text-primary border-primary/20"
                  : "bg-card-elevated border-card-border text-muted hover:text-foreground"
              }`}
            >
              MA-20
            </button>
            <button
              onClick={() => setShowMa50((v) => !v)}
              aria-pressed={showMa50}
              title="50-turn moving average of closes"
              className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors whitespace-nowrap ${
                showMa50
                  ? "bg-primary/10 text-primary border-primary/20"
                  : "bg-card-elevated border-card-border text-muted hover:text-foreground"
              }`}
            >
              MA-50
            </button>
            <span className="mx-1 h-4 w-px bg-card-border" />
            <select
              aria-label="Compare with another index"
              value={
                compare
                  ? `${compare.kind}:${compare.kind === "venue" ? compare.api : compare.sector}`
                  : ""
              }
              onChange={(e) => {
                const v = e.target.value;
                setCompareError(false);
                if (!v) {
                  setCompare(null);
                  return;
                }
                const [kind, key] = v.split(":");
                setCompare(
                  kind === "venue"
                    ? { kind: "venue", api: key }
                    : { kind: "sector", sector: key as CorporationType }
                );
              }}
              className="px-2 py-1 rounded-md text-xs font-medium border bg-card-elevated border-card-border text-muted hover:text-foreground max-w-44"
            >
              <option value="">Compare…</option>
              <optgroup label="Exchanges">
                {venueOptions.map((v) => (
                  <option key={v.apiKey} value={`venue:${v.apiKey}`}>
                    {v.exchangeName}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Sectors">
                {sectorOptions.map((s) => (
                  <option key={s} value={`sector:${s}`}>
                    {CORPORATION_TYPE_LABELS[s]}
                  </option>
                ))}
              </optgroup>
            </select>
            {compareLabel && (
              <span className="text-[11px] text-muted">
                vs {compareLabel} ·{" "}
                <button onClick={() => setCompare(null)} className="text-primary hover:underline">
                  clear
                </button>
              </span>
            )}
            {compareError && (
              <span className="text-[11px] text-error">Comparison series unavailable</span>
            )}
          </div>
        </div>
      </div>

      <div className="px-4 pt-3">
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-[2px] bg-success" />
            <span className="inline-block h-2.5 w-2.5 rounded-[2px] bg-error" />
            Turn candles · volume
          </span>
          {bucketed && <span>Weekly buckets</span>}
          {!loading && candles.length > 0 && (
            <span>
              {intradayTurns}/{candles.length} {bucketed ? "buckets" : "turns"} with intraday prints
              {intradayTurns === 0 ? " (turn closes only)" : ""}
            </span>
          )}
        </div>
        <div className="relative h-60 sm:h-80">
          <div ref={containerRef} className="h-full w-full" />
          <div
            ref={tooltipRef}
            style={{ display: "none" }}
            className="pointer-events-none absolute z-10 rounded-lg border border-card-border bg-card-elevated px-2.5 py-1.5 text-xs shadow-lg whitespace-nowrap"
          />
          {loading && candles.length === 0 && (
            <Skeleton className="absolute inset-0 h-full w-full" />
          )}
          {!loading && (failed || candles.length === 0) && (
            <p className="absolute inset-0 flex items-center justify-center bg-card text-sm text-muted">
              No market history available yet for this range.
            </p>
          )}
        </div>
      </div>
      <div className="px-4 py-2 text-[11px] text-muted border-t border-card-border mt-3">
        Raw market capitalization, grouped weekly for long ranges. High/low include observed
        intraday prints where recorded; otherwise they use recorded closes. Hover or drag for
        O/H/L/C and turnover.
      </div>
    </div>
  );
}
