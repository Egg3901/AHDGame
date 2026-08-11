"use client";

import type { ActionsViewMode } from "../actionsTypes";

interface ViewToggleProps {
  viewMode: ActionsViewMode;
  onViewModeChange: (mode: ActionsViewMode) => void;
}

export default function ViewToggle({ viewMode, onViewModeChange }: ViewToggleProps) {
  return (
    <div className="flex items-center rounded-lg border border-card-border bg-card p-0.5">
      <button
        onClick={() => onViewModeChange("cards")}
        className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all ${
          viewMode === "cards"
            ? "bg-primary/10 text-primary border border-primary/30 shadow-sm"
            : "text-muted hover:text-foreground border border-transparent"
        }`}
        title="Card view"
      >
        {/* Grid icon */}
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"
          />
        </svg>
        <span className="hidden sm:inline">Cards</span>
      </button>
      <button
        onClick={() => onViewModeChange("compact")}
        className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all ${
          viewMode === "compact"
            ? "bg-primary/10 text-primary border border-primary/30 shadow-sm"
            : "text-muted hover:text-foreground border border-transparent"
        }`}
        title="Compact view"
      >
        {/* List icon */}
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
        <span className="hidden sm:inline">Compact</span>
      </button>
    </div>
  );
}
