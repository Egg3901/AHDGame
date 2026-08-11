"use client";

import { HealthRing } from "./HealthRing";
import { catIcon, CATEGORY_ICON } from "./catIcon";
import { categoryRollup } from "./categoryRollup";
import { useWorldFlags } from "@/hooks/useWorldFlags";

interface CategoryEntry {
  id: string;
  name: string;
}

interface CategoryHealthOverviewProps {
  /** Ordered category list (id + display name). */
  categories: CategoryEntry[];
  /** National category summaries keyed by category id. */
  data: Record<string, Record<string, { populationWeightedAverage: number }>>;
  countryId: string;
  activeCategory: string;
  onSelect: (categoryId: string) => void;
  /** "National roll-up" vs "This region's standing". */
  scopeNote: string;
}

/** At-a-glance ring grid across all categories; clicking opens a category. */
export function CategoryHealthOverview({
  categories,
  data,
  countryId,
  activeCategory,
  onSelect,
  scopeNote,
}: CategoryHealthOverviewProps) {
  const { preset, eraSystemEnabled, currentYear, startingYear, incomeBandIndexByCountry } =
    useWorldFlags();
  // Live year for era-aware score bands; null while the flag is off (legacy path).
  const eraYear = eraSystemEnabled ? currentYear : null;
  const incomeIndex = eraYear != null ? (incomeBandIndexByCountry?.[countryId] ?? null) : null;
  return (
    <div className="rounded-xl border border-card-border bg-card p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Category health overview</h2>
          <p className="text-[11px] text-muted">
            {scopeNote} across all {categories.length} categories · click to open
          </p>
        </div>
        <span className="rounded-full border border-card-border bg-card-muted px-2 py-0.5 text-[11px] font-semibold text-muted">
          {categories.length} categories
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {categories.map((cat) => {
          const rollup = categoryRollup(
            data[cat.id] ?? {},
            countryId,
            preset,
            eraYear,
            incomeIndex,
            startingYear
          );
          const active = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => onSelect(cat.id)}
              className={`flex flex-col items-center gap-2 rounded-xl border p-3 text-center transition-all ${
                active
                  ? "border-primary/60 bg-primary/[0.07] shadow-glow-sm"
                  : "border-card-border bg-card-muted hover:border-primary/40"
              }`}
            >
              <HealthRing score={rollup.avgScore} size={54} />
              <div className="min-w-0">
                <div className="flex items-center justify-center gap-1 text-muted">
                  {catIcon(CATEGORY_ICON[cat.id] ?? "currency", "h-3 w-3")}
                  <span className="truncate text-[11px] font-semibold text-foreground">
                    {cat.name}
                  </span>
                </div>
                <div className="mt-0.5 text-[10px] text-muted">
                  <span className="text-success">{rollup.strong}↑</span> ·{" "}
                  <span className="text-error">{rollup.weak}↓</span> · {rollup.count}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default CategoryHealthOverview;
