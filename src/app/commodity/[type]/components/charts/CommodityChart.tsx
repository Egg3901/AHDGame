"use client";

import { useState } from "react";
import PriceChart from "./PriceChart";
import SupplyDemandChart from "./SupplyDemandChart";
import type { HistoryPoint, ChartView } from "../../types";

// 48 turns = 1 game year
const TURNS_PER_YEAR = 48;

type TimeRange = "6m" | "1y" | "5y" | "all";

const TIME_RANGE_TURNS: Record<TimeRange, number | null> = {
  "6m": TURNS_PER_YEAR / 2,
  "1y": TURNS_PER_YEAR,
  "5y": TURNS_PER_YEAR * 5,
  all: null,
};

const TIME_RANGE_LABELS: Record<TimeRange, string> = {
  "6m": "6M",
  "1y": "1Y",
  "5y": "5Y",
  all: "All",
};

interface CommodityChartProps {
  history: HistoryPoint[];
  basePrice: number;
  unit: string;
  scopeLabel?: string;
}

export default function CommodityChart({
  history,
  basePrice,
  unit,
  scopeLabel,
}: CommodityChartProps) {
  const [view, setView] = useState<ChartView>("price");
  const [timeRange, setTimeRange] = useState<TimeRange>("1y");

  if (history.length < 2) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6 mb-6">
        <h2 className="text-lg font-bold text-foreground mb-4">Chart</h2>
        <div className="text-center text-muted text-sm py-12">
          Chart data will appear after a few turns have been processed.
        </div>
      </div>
    );
  }

  const maxTurns = TIME_RANGE_TURNS[timeRange];
  const filteredHistory =
    maxTurns === null ? history : history.slice(-Math.min(maxTurns, history.length));

  return (
    <div className="rounded-xl border border-card-border bg-card p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-foreground">
            {view === "price" ? "Price Over Time" : "Supply & Demand Over Time"}
          </h2>
          {scopeLabel && <p className="text-xs text-muted mt-0.5">{scopeLabel}</p>}
        </div>
        <div className="flex items-center gap-2">
          {/* Time range selector */}
          <div className="flex bg-card-elevated rounded-lg p-0.5 border border-card-border">
            {(["6m", "1y", "5y", "all"] as TimeRange[]).map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  timeRange === range
                    ? "bg-primary text-white shadow-sm"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {TIME_RANGE_LABELS[range]}
              </button>
            ))}
          </div>
          {/* View toggle */}
          <div className="flex bg-card-elevated rounded-lg p-0.5 border border-card-border">
            <button
              onClick={() => setView("price")}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                view === "price"
                  ? "bg-primary text-white shadow-sm"
                  : "text-muted hover:text-foreground"
              }`}
            >
              Price
            </button>
            <button
              onClick={() => setView("supply_demand")}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                view === "supply_demand"
                  ? "bg-primary text-white shadow-sm"
                  : "text-muted hover:text-foreground"
              }`}
            >
              Supply / Demand
            </button>
          </div>
        </div>
      </div>
      {view === "price" ? (
        <PriceChart history={filteredHistory} basePrice={basePrice} />
      ) : (
        <SupplyDemandChart history={filteredHistory} unit={unit} />
      )}
    </div>
  );
}
