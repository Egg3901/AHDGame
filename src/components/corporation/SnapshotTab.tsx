"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { DenseSection, Segmented, TableScroll, Td, Th } from "./dense/DenseKit";
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
 * (or a lookback preset) and see the absolute + % change per headline metric,
 * distinct from the Charts tab, which line-plots one metric across every turn.
 * Reads the already-persisted `corporationHistory` snapshots; no writes.
 */
export default function SnapshotTab({
  corpId,
  modViewEnabled = false,
}: {
  corpId: string;
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

  // Rate-aware ₳ normalization, the same approach as the Charts tab: use the
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
      <div className="space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (data?.isPrivate) {
    return (
      <DenseSection title="Snapshot compare">
        <p className="py-2 text-xs text-muted">
          Private corporation. Historical financials are not publicly disclosed.
        </p>
      </DenseSection>
    );
  }

  if (!data || data.points.length < 2) {
    return (
      <DenseSection title="Snapshot compare">
        <p className="py-2 text-xs text-muted">
          Not enough history yet. The snapshot compare needs at least two turns of recorded history.
          Check back after a few more turns of activity.
        </p>
      </DenseSection>
    );
  }

  const points = data.points;
  const cc = data.currencyCode;
  const firstTurn = points[0].turn;
  const lastTurn = points[points.length - 1].turn;
  const fullSpan = lastTurn - firstTurn;

  const fmtMetric = (v: number, format: "money" | "price") =>
    format === "price" ? formatPrice(v, cc) : formatAmount(v, cc);

  const spanTurns = laterTurn != null && earlierTurn != null ? laterTurn - earlierTurn : 0;
  const presets = [
    ...LOOKBACK_PRESETS.filter((p) => p.turns <= fullSpan).map((p) => ({
      value: p.label,
      label: p.label,
      from: nearestTurn(points, lastTurn - p.turns),
    })),
    { value: "Max", label: "Max", from: firstTurn },
  ];
  const activePreset =
    toTurn === lastTurn ? (presets.find((p) => p.from === earlierTurn)?.value ?? null) : null;

  const selectClass =
    "h-7 rounded-md border border-card-border bg-background px-2 font-mono text-xs text-foreground focus:border-foreground focus:outline-none";

  return (
    <DenseSection
      title="Snapshot compare"
      meta={`${spanTurns} turns`}
      actions={
        <>
          <Segmented
            ariaLabel="Lookback"
            options={presets.map(({ value, label }) => ({ value, label }))}
            value={activePreset}
            onChange={(value) => {
              const preset = presets.find((p) => p.value === value);
              if (!preset) return;
              setToTurn(lastTurn);
              setFromTurn(preset.from);
            }}
          />
          <label className="flex items-center gap-1.5 text-xs text-muted">
            From
            <select
              value={fromTurn ?? ""}
              onChange={(e) => setFromTurn(Number(e.target.value))}
              className={selectClass}
            >
              {points.map((p) => (
                <option key={p.turn} value={p.turn}>
                  T{p.turn}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted">
            to
            <select
              value={toTurn ?? ""}
              onChange={(e) => setToTurn(Number(e.target.value))}
              className={selectClass}
            >
              {points.map((p) => (
                <option key={p.turn} value={p.turn}>
                  T{p.turn}
                </option>
              ))}
            </select>
          </label>
        </>
      }
    >
      <p className="py-1 text-xs text-muted">
        Turn-over-turn change across the corporation&apos;s recorded history. Pick two turns or a
        lookback window.
      </p>
      <TableScroll>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <Th>Metric</Th>
              <Th align="right">T{earlierTurn}</Th>
              <Th align="right">T{laterTurn}</Th>
              <Th align="right">Change</Th>
              <Th align="right">%</Th>
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
                    ? "0.0%"
                    : `${row.pctDelta > 0 ? "+" : "−"}${Math.abs(row.pctDelta).toFixed(1)}%`;
              return (
                <tr key={row.key}>
                  <Td>
                    <span className="text-foreground" title={row.description}>
                      {row.label}
                    </span>
                  </Td>
                  <Td align="right">{fmtMetric(row.then, row.format)}</Td>
                  <Td align="right">{fmtMetric(row.now, row.format)}</Td>
                  <Td align="right" className={toneClass}>
                    {flat ? "0" : `${good ? "+" : "−"}${deltaBody}`}
                  </Td>
                  <Td align="right" className={pctToneClass}>
                    {pctText}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroll>

      <p className="pt-2 text-xs text-muted">
        Values are per-turn snapshots recorded during turn processing. Revenue and net income are
        per-turn flows; multiply by 24 to compare with the daily Financial Statement.
      </p>
    </DenseSection>
  );
}
