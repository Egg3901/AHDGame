"use client";

import type { MetricConfig, MetricFormat } from "@/lib/constants/cabinetMechanicsTypes";
import { Tile } from "./dossier";

function fmt(value: number | undefined, format: MetricFormat, sym: string): string {
  if (value === undefined) return "—";
  switch (format) {
    case "percent":
      return `${value.toFixed(1)}%`;
    case "currency":
      return `${sym}${Math.round(value).toLocaleString("en-US")}`;
    case "number":
      return Math.round(value).toLocaleString("en-US");
    default:
      return value.toFixed(1);
  }
}

export function CabinetStatStrip({
  metrics,
  values,
  currencySymbol = "$",
}: {
  metrics: MetricConfig[];
  values: Record<string, number>;
  currencySymbol?: string;
}) {
  if (metrics.length === 0) return null;
  return (
    <div className="grid grid-cols-2 divide-x divide-y divide-card-border bg-card-muted/60 sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0">
      {metrics.map((m) => {
        const v = values[`${m.category}.${m.metricId}`];
        const good = v === undefined ? null : m.higherIsBetter ? v >= 50 : v <= 50;
        return (
          <Tile
            key={`${m.category}.${m.metricId}`}
            label={m.label}
            value={fmt(v, m.format, currencySymbol)}
            tone={good === null ? "muted" : good ? "up" : "down"}
            sub="current"
          />
        );
      })}
    </div>
  );
}
