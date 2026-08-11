"use client";

import { memo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { CodeQualitySnapshot } from "@/lib/db/types";

interface Props {
  snapshots: CodeQualitySnapshot[];
}

export const CodeQualityTrendChart = memo(function CodeQualityTrendChart({ snapshots }: Props) {
  if (snapshots.length === 0) {
    return <p className="text-sm text-muted">No trend data yet.</p>;
  }

  const sorted = [...snapshots].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const data = sorted.map((s) => ({
    label: s.gitSha.slice(0, 7),
    overall: Math.round(s.overallScore),
    mobile: Math.round(s.mobileScore),
  }));

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-foreground">
        Quality Trend (Last 10 Deployments)
      </h3>
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="var(--color-muted)" />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} stroke="var(--color-muted)" />
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--color-card)",
              border: "1px solid var(--color-border)",
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line
            type="monotone"
            dataKey="overall"
            name="Overall"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
          <Line
            type="monotone"
            dataKey="mobile"
            name="Mobile"
            stroke="#8b5cf6"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
});
