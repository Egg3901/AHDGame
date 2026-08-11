"use client";

export type MapMode = "supply" | "demand" | "price" | "capacity";

interface CommodityMapModeToggleProps {
  mode: MapMode;
  onModeChange: (mode: MapMode) => void;
  showCapacity?: boolean;
}

export default function CommodityMapModeToggle({
  mode,
  onModeChange,
  showCapacity = false,
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
