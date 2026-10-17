"use client";

import { memo } from "react";
import { useTranslations } from "next-intl";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface ConfidenceGaugeHistoryEntry {
  turn: number | null;
  value: number;
  at: string;
  reason: string;
}

export function confidenceBand(value: number): { label: string; color: string } {
  if (value >= 66) return { label: "Secure", color: "#16a34a" };
  if (value >= 33) return { label: "Shaky", color: "#d97706" };
  if (value > 0) return { label: "Crisis", color: "#dc2626" };
  return { label: "Collapsed", color: "#991b1b" };
}

export const ConfidenceGaugeReadout = memo(function ConfidenceGaugeReadout({
  value,
  history,
}: {
  value: number;
  history: ConfidenceGaugeHistoryEntry[];
}) {
  const t = useTranslations("ukGovernment.confidence");
  const clamped = Math.max(0, Math.min(100, value));
  const band = confidenceBand(clamped);
  const chartData = history.map((point, index) => ({
    ...point,
    index,
    turnLabel: point.turn === null ? t("unknownTurn") : `T${point.turn}`,
  }));
  const recent = [...chartData].reverse().slice(0, 6);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-card-border bg-card p-6 shadow-card">
        <div className="flex items-baseline justify-between">
          <h3 className="text-caption font-semibold text-muted">{t("title")}</h3>
          <span className="text-body-sm font-medium" style={{ color: band.color }}>
            {t(`bands.${band.label.toLowerCase()}`)}
          </span>
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-2xl font-semibold text-foreground">{Math.round(clamped)}</span>
          <span className="text-body-sm text-muted">/ 100</span>
        </div>
        <div
          className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-card-muted ring-1 ring-card-border"
          role="meter"
          aria-valuenow={Math.round(clamped)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={t("title")}
        >
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${clamped}%`, backgroundColor: band.color }}
          />
        </div>
        <p className="mt-2 text-caption text-muted">{t("description")}</p>
      </div>

      <section
        className="rounded-2xl border border-card-border bg-card p-4 shadow-card"
        aria-label={t("history.title")}
      >
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-semibold text-foreground">{t("history.title")}</h3>
          {history.length > 0 && (
            <span className="text-xs text-muted">
              {t("history.points", { count: history.length })}
            </span>
          )}
        </div>
        {chartData.length < 2 ? (
          <p className="text-sm text-muted">{t("history.notEnoughData")}</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis
                dataKey="index"
                tick={{ fontSize: 11 }}
                stroke="var(--color-muted)"
                tickFormatter={(index: number) => chartData[index]?.turnLabel ?? ""}
                minTickGap={24}
              />
              <YAxis
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                tick={{ fontSize: 11 }}
                stroke="var(--color-muted)"
              />
              <Tooltip
                labelFormatter={(_label, entries) => {
                  const point = entries[0]?.payload as (typeof chartData)[number] | undefined;
                  return point?.turn === null || point?.turn === undefined
                    ? t("history.unknownTurn")
                    : t("history.turn", { turn: point.turn });
                }}
                formatter={(entryValue, _name, item) => {
                  const point = item.payload as (typeof chartData)[number];
                  return [
                    `${Math.round(Number(entryValue))} / 100`,
                    `${t("history.value")} · ${t(`reasons.${point.reason}`)}`,
                  ];
                }}
                contentStyle={{
                  backgroundColor: "var(--color-card)",
                  border: "1px solid var(--color-border)",
                  fontSize: 12,
                }}
              />
              <Line
                type="monotone"
                dataKey="value"
                name={t("history.value")}
                stroke={band.color}
                strokeWidth={2}
                dot={{ r: 2 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
        <p className="mt-2 text-xs text-muted">{t("history.retention")}</p>
        {recent.length > 0 && (
          <ol className="mt-3 space-y-1 border-t border-card-border pt-3 text-xs text-muted">
            {recent.map((point) => (
              <li key={`${point.index}-${point.reason}`} className="flex justify-between gap-3">
                <span>
                  {point.turn === null
                    ? t("history.unknownTurn")
                    : t("history.turn", { turn: point.turn })}
                  {" · "}
                  {t(`reasons.${point.reason}`)}
                </span>
                <span className="font-medium text-foreground">{Math.round(point.value)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
});
