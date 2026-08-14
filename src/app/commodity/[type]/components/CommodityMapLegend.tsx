"use client";

import { getLegendStops, getPriceLegendStops, getReachableLegendStops } from "@/lib/commodity-map";
import type { MapMode } from "./CommodityMapModeToggle";

interface CommodityMapLegendProps {
  mode: MapMode;
  label: string;
  unit: string;
  priceLabel?: string;
}

export default function CommodityMapLegend({
  mode,
  label: _label,
  unit,
  priceLabel = "Price",
}: CommodityMapLegendProps) {
  // Diverging legend: both poles AND the neutral midpoint are named, because a
  // polarity scale is unreadable if the middle is not labelled. Colours come
  // from the validated ramp itself rather than theme tokens, so the swatch and
  // the map fill cannot drift apart.
  if (mode === "reachable") {
    const stops = getReachableLegendStops();
    const gradient = `linear-gradient(to right, ${stops.map((s) => s.color).join(", ")})`;
    return (
      <div className="flex items-center gap-2 bg-card/90 backdrop-blur-md px-3 py-2 rounded-lg border border-card-border shadow-sm">
        <span className="text-[10px] font-semibold text-muted uppercase tracking-wider whitespace-nowrap">
          Reachable
        </span>
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-muted">{stops[0].label}</span>
          <div className="h-2 w-16 rounded-full" style={{ background: gradient }} />
          <span className="text-[9px] text-muted">{stops[4].label}</span>
        </div>
        <span className="hidden text-[9px] text-muted sm:inline">
          ({stops[2].label} at demand = supply)
        </span>
      </div>
    );
  }

  const stops =
    mode === "price"
      ? getPriceLegendStops()
      : mode === "capacity"
        ? [{ label: "Low" }, {}, { label: "High" }]
        : getLegendStops(mode as "supply" | "demand");
  const gradientColors =
    mode === "supply"
      ? "from-success/15 via-success/50 to-success/85"
      : mode === "demand"
        ? "from-error/15 via-error/50 to-error/85"
        : mode === "capacity"
          ? "from-warning/15 via-warning/50 to-warning/85"
          : "from-success/15 via-slate-400/50 to-error/85";

  const modeLabel =
    mode === "supply"
      ? "Supply"
      : mode === "demand"
        ? "Demand"
        : mode === "capacity"
          ? "Deposits"
          : priceLabel;

  const unitLabel =
    mode === "price" ? "(price)" : mode === "capacity" ? `(${unit}/turn)` : `(${unit}/day)`;

  return (
    <div className="flex items-center gap-2 bg-card/90 backdrop-blur-md px-3 py-2 rounded-lg border border-card-border shadow-sm">
      <span className="text-[10px] font-semibold text-muted uppercase tracking-wider whitespace-nowrap">
        {modeLabel}
      </span>
      <div className="flex items-center gap-1">
        <span className="text-[9px] text-muted">{stops[0].label}</span>
        <div className={`w-16 h-2 rounded-full bg-gradient-to-r ${gradientColors}`} />
        <span className="text-[9px] text-muted">{stops[2]?.label}</span>
      </div>
      <span className="text-[9px] text-muted hidden sm:inline">{unitLabel}</span>
    </div>
  );
}
