"use client";

import { CATEGORY_LABELS } from "../actionsConstants";

interface CategoryFilterProps {
  categories: string[];
  /** Card count per category id (plus "all"); renders as a trailing badge. */
  counts?: Record<string, number>;
  activeCategory: string;
  onCategoryChange: (cat: string) => void;
}

export default function CategoryFilter({
  categories,
  counts,
  activeCategory,
  onCategoryChange,
}: CategoryFilterProps) {
  return (
    <div
      role="tablist"
      aria-label="Filter operations by category"
      className="flex items-center gap-2 overflow-x-auto pb-2 sm:pb-0 scrollbar-hide"
    >
      {categories.map((cat) => {
        const active = activeCategory === cat;
        const count = counts?.[cat];
        return (
          <button
            key={cat}
            role="tab"
            aria-selected={active}
            onClick={() => onCategoryChange(cat)}
            className={`flex items-center gap-2 whitespace-nowrap rounded-full border px-4 py-1.5 text-body font-medium transition-colors ${
              active
                ? "border-foreground/40 bg-card-elevated text-foreground"
                : "border-card-border bg-card text-muted hover:bg-card-elevated hover:text-foreground"
            }`}
          >
            {cat === "all" ? "All operations" : CATEGORY_LABELS[cat]}
            {count !== undefined && (
              <span className="text-body-sm tabular-nums text-muted">{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
