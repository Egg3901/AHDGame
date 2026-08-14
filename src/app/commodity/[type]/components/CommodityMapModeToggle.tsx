"use client";

export type MapMode = "supply" | "demand" | "price" | "capacity" | "reachable";

interface CommodityMapModeToggleProps {
  mode: MapMode;
  onModeChange: (mode: MapMode) => void;
  showCapacity?: boolean;
  /**
   * Reachable needs the per-country books, which only exist once a world has
   * run a turn on 1.1.2 or later. Hidden rather than disabled when absent: an
   * always-greyed button on an older world is just noise.
   */
  showReachable?: boolean;
}

export default function CommodityMapModeToggle({
  mode,
  onModeChange,
  showCapacity = false,
  showReachable = false,
}: CommodityMapModeToggleProps) {
  return (
    <div className="flex items-center gap-1 bg-card/90 backdrop-blur-md p-1 rounded-lg border border-card-border shadow-sm">
      <button
        onClick={() => onModeChange("supply")}
        className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all ${
          mode === "supply"
            ? "bg-success text-white shadow-sm"
            : "text-muted hover:text-foreground hover:bg-card-elevated"
        }`}
      >
        Supply
      </button>
      <button
        onClick={() => onModeChange("demand")}
        className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all ${
          mode === "demand"
            ? "bg-error text-white shadow-sm"
            : "text-muted hover:text-foreground hover:bg-card-elevated"
        }`}
      >
        Demand
      </button>
      <button
        onClick={() => onModeChange("price")}
        className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all ${
          mode === "price"
            ? "bg-primary text-white shadow-sm"
            : "text-muted hover:text-foreground hover:bg-card-elevated"
        }`}
      >
        Price
      </button>
      {showReachable && (
        <button
          onClick={() => onModeChange("reachable")}
          title="Demand each country's own producers can actually sell into, after imports and exports. Embargoed and untraded supply is excluded."
          className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all ${
            mode === "reachable"
              ? "bg-foreground text-card shadow-sm"
              : "text-muted hover:text-foreground hover:bg-card-elevated"
          }`}
        >
          Reachable
        </button>
      )}
      {showCapacity && (
        <button
          onClick={() => onModeChange("capacity")}
          className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all ${
            mode === "capacity"
              ? "bg-warning text-white shadow-sm"
              : "text-muted hover:text-foreground hover:bg-card-elevated"
          }`}
        >
          Deposits
        </button>
      )}
    </div>
  );
}
