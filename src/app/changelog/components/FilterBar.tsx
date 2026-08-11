"use client";

import type { TagFilter } from "../changelogTypes";
import { TAG_FILTER_OPTIONS } from "../changelogTypes";

interface FilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  tagFilter: TagFilter;
  onTagFilterChange: (value: TagFilter) => void;
  showCollapseToggle: boolean;
  allCollapsed: boolean;
  onToggleAll: () => void;
  totalFiltered: number;
}

export function FilterBar({
  search,
  onSearchChange,
  tagFilter,
  onTagFilterChange,
  showCollapseToggle,
  allCollapsed,
  onToggleAll,
  totalFiltered,
}: FilterBarProps) {
  return (
    <>
      {/* Search + collapse */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search changelog..."
            className="w-full rounded-lg border border-card-border bg-background px-4 py-2 pl-9 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none"
          />
          <svg
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          {search && (
            <button
              onClick={() => onSearchChange("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted hover:text-foreground"
            >
              ✕
            </button>
          )}
        </div>
        {showCollapseToggle && (
          <button
            onClick={onToggleAll}
            className="shrink-0 rounded-lg border border-card-border bg-card px-3 py-2 text-xs text-muted transition-colors hover:text-foreground"
          >
            {allCollapsed ? "Expand all" : "Collapse all"}
          </button>
        )}
      </div>

      {/* Tag filter pills */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="shrink-0 text-xs text-muted">Filter:</span>
        {TAG_FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onTagFilterChange(opt.value)}
            title={opt.desc}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              tagFilter === opt.value
                ? opt.value === "frontend"
                  ? "border-blue-500/40 bg-blue-500/15 text-blue-300"
                  : opt.value === "backend"
                    ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                    : opt.value === "both"
                      ? "border-violet-500/40 bg-violet-500/15 text-violet-300"
                      : "border-primary/40 bg-primary/15 text-primary"
                : "border-card-border bg-background text-muted hover:text-foreground"
            }`}
          >
            {opt.label}
          </button>
        ))}
        {(search.trim() || tagFilter !== "all") && (
          <span className="ml-auto text-xs text-muted">
            {totalFiltered} result{totalFiltered !== 1 ? "s" : ""}
          </span>
        )}
      </div>
    </>
  );
}
