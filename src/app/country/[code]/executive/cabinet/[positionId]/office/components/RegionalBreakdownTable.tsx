"use client";

import { useState } from "react";
import type { MetricConfig, MetricFormat } from "@/lib/constants/cabinetMechanicsTypes";

interface RegionRow {
  regionId: string;
  regionName: string;
  population: number;
  metrics: Record<string, number>;
}

interface RegionalBreakdownTableProps {
  metrics: MetricConfig[];
  regionData: RegionRow[];
  currencySymbol?: string;
}

function formatValue(
  value: number | undefined,
  format: MetricFormat,
  currencySymbol: string
): string {
  if (value === undefined) return "—";
  switch (format) {
    case "percent":
      return `${value.toFixed(1)}%`;
    case "currency":
      return `${currencySymbol}${Math.round(value).toLocaleString("en-US")}`;
    case "index":
    case "rate":
      return value.toFixed(1);
    case "number":
      return Math.round(value).toLocaleString("en-US");
    default:
      return value.toFixed(1);
  }
}

type SortDir = "asc" | "desc";

function SortIcon({ col, sortKey, sortDir }: { col: string; sortKey: string; sortDir: SortDir }) {
  if (sortKey !== col) {
    return <span className="ml-1 text-muted opacity-40">↕</span>;
  }
  return <span className="ml-1 text-primary">{sortDir === "asc" ? "↑" : "↓"}</span>;
}

export function RegionalBreakdownTable({
  metrics,
  regionData,
  currencySymbol = "$",
}: RegionalBreakdownTableProps) {
  const [sortKey, setSortKey] = useState<string>("regionName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  if (metrics.length === 0 || regionData.length === 0) return null;

  function handleSort(key: string) {
    setSortDir((prev) => (sortKey === key ? (prev === "asc" ? "desc" : "asc") : "asc"));
    setSortKey(key);
  }

  const sorted = [...regionData].sort((a, b) => {
    let aVal: number | string;
    let bVal: number | string;

    if (sortKey === "regionName") {
      aVal = a.regionName;
      bVal = b.regionName;
    } else if (sortKey === "population") {
      aVal = a.population;
      bVal = b.population;
    } else {
      aVal = a.metrics[sortKey] ?? 0;
      bVal = b.metrics[sortKey] ?? 0;
    }

    if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
    if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden">
      <div className="p-4 sm:p-6 border-b border-card-border">
        <h2 className="text-lg font-semibold text-foreground">Regional Breakdown</h2>
        <p className="text-sm text-muted mt-0.5">Key metrics by region</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-card-border bg-card-elevated">
              <th
                className="px-4 py-3 text-left font-medium text-muted cursor-pointer hover:text-foreground whitespace-nowrap select-none"
                onClick={() => handleSort("regionName")}
              >
                Region <SortIcon col="regionName" sortKey={sortKey} sortDir={sortDir} />
              </th>
              {metrics.map((m) => {
                // Region metrics are keyed by `${category}.${metricId}` (see the API
                // briefing payload and the cell render below), so the sort key must use
                // the same composite key — a bare metricId never matches and sorts no-op.
                const metricKey = `${m.category}.${m.metricId}`;
                return (
                  <th
                    key={metricKey}
                    className="px-4 py-3 text-right font-medium text-muted cursor-pointer hover:text-foreground whitespace-nowrap select-none"
                    onClick={() => handleSort(metricKey)}
                  >
                    {m.label} <SortIcon col={metricKey} sortKey={sortKey} sortDir={sortDir} />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr
                key={row.regionId}
                className="border-b border-card-border/50 hover:bg-card-elevated/50 transition-colors"
              >
                <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">
                  {row.regionName}
                </td>
                {metrics.map((m) => {
                  const value = row.metrics[`${m.category}.${m.metricId}`];
                  const isGood =
                    value !== undefined ? (m.higherIsBetter ? value >= 50 : value <= 50) : null;
                  const colourClass =
                    isGood === null ? "text-muted" : isGood ? "text-success" : "text-error";

                  return (
                    <td
                      key={m.metricId}
                      className={`px-4 py-3 text-right tabular-nums ${colourClass}`}
                    >
                      {formatValue(value, m.format, currencySymbol)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
