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
            className={`flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-medium transition-all whitespace-nowrap ${
              active
                ? "border-primary/50 bg-primary/10 text-primary shadow-sm"
                : "border-card-border bg-card text-muted hover:border-primary/30 hover:text-foreground hover:bg-card-elevated"
            }`}
          >
            {cat === "all" ? "All Operations" : CATEGORY_LABELS[cat]}
            {count !== undefined && (
              <span
                className={`rounded-full px-1.5 text-[10px] font-bold tabular-nums ${
                  active ? "bg-primary/20 text-primary" : "bg-card-elevated text-muted"
                }`}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
