"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  computeSnapshotDeltas,
  toAnchorMetricMap,
  type CorpHistoryComparePoint,
} from "@/lib/corporations/queries/corporationHistoryCompare";

interface CompareResponse {
  points?: CorpHistoryComparePoint[];
  currencyCode?: string;
  isPrivate?: boolean;
}

interface LoadedData {
  points: CorpHistoryComparePoint[];
  currencyCode?: CurrencyCode;
  isPrivate: boolean;
}

/** 24 turns == one in-game day. Lookback quick-picks in turns. */
const LOOKBACK_PRESETS: { label: string; turns: number }[] = [
  { label: "1 day", turns: 24 },
  { label: "3 days", turns: 72 },
  { label: "1 week", turns: 168 },
];

/** Available turn closest to `target` (points assumed ascending, non-empty). */
function nearestTurn(points: CorpHistoryComparePoint[], target: number): number {
  let best = points[0].turn;
  let bestDist = Infinity;
  for (const p of points) {
    const d = Math.abs(p.turn - target);
    if (d < bestDist) {
      bestDist = d;
      best = p.turn;
    }
  }
  return best;
}

/**
 * Snapshot tab (suggestion #97): a turn-over-turn compare TABLE. Pick two turns
 * (or a lookback preset) and see the absolute + % change per headline metric —
 * distinct from the Charts tab, which line-plots one metric across every turn.
 * Reads the already-persisted `corporationHistory` snapshots; no writes.
 */
export default function SnapshotTab({
  corpId,
  brandColor,
  modViewEnabled = false,
}: {
  corpId: string;
  brandColor?: string;
  modViewEnabled?: boolean;
}) {
  const { formatAmount, formatPrice, toInternalFrom } = useCurrency();
  const [data, setData] = useState<LoadedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fromTurn, setFromTurn] = useState<number | null>(null);
  const [toTurn, setToTurn] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      try {
        const url = modViewEnabled
          ? `/api/corporations/${corpId}/history/compare?modView=1`
          : `/api/corporations/${corpId}/history/compare`;
        const res = await fetch(url);
        if (!res.ok) {
          if (!cancelled) setData(null);
          return;
        }
        const json = (await res.json()) as CompareResponse;
        if (cancelled) return;
        const points = json.points ?? [];
        setData({
          points,
          currencyCode: json.currencyCode as CurrencyCode | undefined,
          isPrivate: json.isPrivate === true,
        });
        if (points.length >= 2) {
          const last = points[points.length - 1].turn;
          const first = points[0].turn;
          const span = last - first;
          const lookback = span >= LOOKBACK_PRESETS[0].turns ? LOOKBACK_PRESETS[0].turns : span;
          setToTurn(last);
          setFromTurn(nearestTurn(points, last - lookback));
        }
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [corpId, modViewEnabled]);

  // Rate-aware ₳ normalization — identical approach to the Charts tab: use the
  // FX rate recorded at write time so old snapshots don't drift with today's
  // rate (#2958); fall back to the live rate for pre-fxRateAtWrite rows.
  const toAnchor = useCallback(
    (val: number, code?: string, fxRateAtWrite?: number) => {
      if (!code) return val;
      if (typeof fxRateAtWrite === "number" && fxRateAtWrite > 0) return val / fxRateAtWrite;
      return toInternalFrom(val, code as CurrencyCode);
    },
    [toInternalFrom]
  );

  // Order-independent: the earlier turn is always the "then" baseline.
  const earlierTurn = fromTurn != null && toTurn != null ? Math.min(fromTurn, toTurn) : null;
  const laterTurn = fromTurn != null && toTurn != null ? Math.max(fromTurn, toTurn) : null;

  const deltas = useMemo(() => {
    if (!data || earlierTurn == null || laterTurn == null) return null;
    const from = data.points.find((p) => p.turn === earlierTurn);
    const to = data.points.find((p) => p.turn === laterTurn);
    if (!from || !to) return null;
    return computeSnapshotDeltas(
      toAnchorMetricMap(from, toAnchor),
      toAnchorMetricMap(to, toAnchor)
    );
  }, [data, earlierTurn, laterTurn, toAnchor]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (data?.isPrivate) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-8 text-center">
        <p className="text-sm font-semibold text-foreground">Private Corporation</p>
        <p className="mt-1 text-sm text-muted">
          Historical financials are not publicly disclosed for this corporation.
        </p>
      </div>
    );
  }

  if (!data || data.points.length < 2) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-8 text-center">
        <p className="text-sm font-semibold text-foreground">Not enough history yet</p>
        <p className="mt-1 text-sm text-muted">
          The snapshot compare needs at least two turns of recorded history. Check back after a few
          more turns of activity.
        </p>
      </div>
    );
  }

  const points = data.points;
  const cc = data.currencyCode;
  const firstTurn = points[0].turn;
  const lastTurn = points[points.length - 1].turn;
  const fullSpan = lastTurn - firstTurn;
  const accent = brandColor || "#3b82f6";

  const fmtMetric = (v: number, format: "money" | "price") =>
    format === "price" ? formatPrice(v, cc) : formatAmount(v, cc);

  const applyLookback = (turns: number) => {
    setToTurn(lastTurn);
    setFromTurn(nearestTurn(points, lastTurn - turns));
  };

  const applyMax = () => {
    setToTurn(lastTurn);
    setFromTurn(firstTurn);
  };

  const spanTurns = laterTurn != null && earlierTurn != null ? laterTurn - earlierTurn : 0;
  const activePreset = (turns: number) =>
    toTurn === lastTurn && earlierTurn === nearestTurn(points, lastTurn - turns);

  return (
    <div className="space-y-4">
      {/* Selector card */}
      <div className="rounded-xl border border-card-border bg-card p-4 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">Snapshot compare</h3>
            <p className="mt-0.5 max-w-md text-xs text-muted">
              Turn-over-turn change across the corporation&apos;s recorded history. Pick two turns
              or a lookback window.
            </p>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted">Span</div>
            <div className="text-lg font-bold tabular-nums text-foreground">{spanTurns} turns</div>
          </div>
        </div>

        {/* Lookback quick-picks */}
        <div className="flex flex-wrap gap-2">
          {LOOKBACK_PRESETS.filter((p) => p.turns <= fullSpan).map((preset) => {
            const isActive = activePreset(preset.turns);
            return (
              <button
                key={preset.label}
                type="button"
                onClick={() => applyLookback(preset.turns)}
                className={`inline-flex items-center rounded-full px-3.5 py-1.5 text-xs font-medium transition-all ${
                  isActive
                    ? "text-white shadow"
                    : "border border-card-border bg-card-elevated text-muted hover:text-foreground hover:border-card-border/80"
                }`}
                style={isActive ? { backgroundColor: accent } : undefined}
              >
                {preset.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={applyMax}
            className={`inline-flex items-center rounded-full px-3.5 py-1.5 text-xs font-medium transition-all ${
              toTurn === lastTurn && earlierTurn === firstTurn
                ? "text-white shadow"
                : "border border-card-border bg-card-elevated text-muted hover:text-foreground hover:border-card-border/80"
            }`}
            style={
              toTurn === lastTurn && earlierTurn === firstTurn
                ? { backgroundColor: accent }
                : undefined
            }
          >
            Max
          </button>
        </div>

        {/* Precise turn selectors */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
              From turn
            </span>
            <select
              value={fromTurn ?? ""}
              onChange={(e) => setFromTurn(Number(e.target.value))}
              className="rounded-lg border border-card-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
            >
              {points.map((p) => (
                <option key={p.turn} value={p.turn}>
                  Turn {p.turn}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
              To turn
            </span>
            <select
              value={toTurn ?? ""}
              onChange={(e) => setToTurn(Number(e.target.value))}
              className="rounded-lg border border-card-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
            >
              {points.map((p) => (
                <option key={p.turn} value={p.turn}>
                  Turn {p.turn}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* Delta table */}
      <div className="overflow-x-auto rounded-xl border border-card-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-card-border text-left">
              <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-muted">
                Metric
              </th>
              <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-widest text-muted">
                T{earlierTurn}
              </th>
              <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-widest text-muted">
                T{laterTurn}
              </th>
              <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-widest text-muted">
                Change
              </th>
              <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-widest text-muted">
                %
              </th>
            </tr>
          </thead>
          <tbody>
            {deltas?.map((row) => {
              const flat = Math.abs(row.delta) < 1e-9;
              const good = row.delta > 0;
              const toneClass = flat ? "text-muted" : good ? "text-success" : "text-error";
              const deltaBody = fmtMetric(Math.abs(row.delta), row.format);
              // The % cell is muted (not colored) when there is no baseline to
              // divide by, or when the change is flat.
              const pctToneClass = row.pctDelta == null ? "text-muted" : toneClass;
              const pctText =
                row.pctDelta == null
                  ? "n/a"
                  : flat
                    ? "—"
                    : `${row.pctDelta > 0 ? "+" : "−"}${Math.abs(row.pctDelta).toFixed(1)}%`;
              return (
                <tr key={row.key} className="border-b border-card-border last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground" title={row.description}>
                      {row.label}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-foreground">
                    {fmtMetric(row.then, row.format)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-foreground">
                    {fmtMetric(row.now, row.format)}
                  </td>
                  <td className={`px-4 py-3 text-right font-semibold tabular-nums ${toneClass}`}>
                    {flat ? "—" : `${good ? "+" : "−"}${deltaBody}`}
                  </td>
                  <td className={`px-4 py-3 text-right font-semibold tabular-nums ${pctToneClass}`}>
                    {pctText}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="px-1 text-xs text-muted">
        Values are per-turn snapshots recorded during turn processing. Revenue and net income are
        per-turn flows; multiply by 24 to compare with the daily Financial Statement.
      </p>
    </div>
  );
}
