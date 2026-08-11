"use client";

import { memo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceDot,
} from "recharts";
import type { GameHealthSnapshot } from "@/lib/db/types";

interface Props {
  snapshots: GameHealthSnapshot[];
}

export const GameHealthTrendChart = memo(function GameHealthTrendChart({ snapshots }: Props) {
  if (snapshots.length === 0) {
    return <p className="text-sm text-muted">No trend data yet.</p>;
  }

  const sorted = [...snapshots].sort((a, b) => a.turn - b.turn);

  const data = sorted.map((s) => ({
    turn: s.turn,
    duration: s.turnProcessing.durationMs,
    warnings: s.turnProcessing.warningCount,
    errors: s.turnProcessing.errorCount,
  }));

  const warningDots = data.filter((d) => d.warnings > 0);
  const errorDots = data.filter((d) => d.errors > 0);

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-foreground">Turn Processing Trend</h3>
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis dataKey="turn" tick={{ fontSize: 11 }} stroke="var(--color-muted)" />
          <YAxis
            tick={{ fontSize: 11 }}
            stroke="var(--color-muted)"
            label={{ value: "ms", position: "insideLeft", style: { fontSize: 11 } }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--color-card)",
              border: "1px solid var(--color-border)",
              fontSize: 12,
            }}
          />
          <Line
            type="monotone"
            dataKey="duration"
            stroke="var(--color-primary)"
            strokeWidth={2}
            dot={false}
          />
          {warningDots.map((d) => (
            <ReferenceDot
              key={`w-${d.turn}`}
              x={d.turn}
              y={d.duration}
              r={4}
              fill="#eab308"
              stroke="#eab308"
            />
          ))}
          {errorDots.map((d) => (
            <ReferenceDot
              key={`e-${d.turn}`}
              x={d.turn}
              y={d.duration}
              r={5}
              fill="#ef4444"
              stroke="#ef4444"
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
});
