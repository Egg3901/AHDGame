"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { CountryPoliticalMetricsResponse } from "@/lib/politicalMetrics/queries/countryPoliticalMetrics";
import { CategoryIcon } from "./categoryIcons";
import type { PMCategory } from "./CategoryCard";
import { LeanChip } from "./LeanChip";
import { LeanStrip } from "./LeanStrip";
import { StatusBadge } from "./StatusBadge";
import { scoreTone } from "./tones";

const CATEGORY_ICONS: Record<string, string> = {
  economy: "currency",
  education: "cap",
  health: "heart",
  infrastructure: "building",
  order: "scales",
  environment: "globe",
  society: "users",
  governance: "library",
  defense: "shield",
};

/** v1 sort options — trend/severity/recency return with the dynamics sub-project. */
type SortKey = "lean" | "score" | "alpha";

export function CategoryDetailView({
  data,
  category,
  onBack,
  onOpenMetric,
  onCompareCategory,
}: {
  data: CountryPoliticalMetricsResponse;
  category: PMCategory;
  onBack: () => void;
  onOpenMetric: (metricId: string) => void;
  onCompareCategory: () => void;
}) {
  const [sort, setSort] = useState<SortKey>("lean");
  const tone = scoreTone(category.score);
  const rows = useMemo(() => {
    const r = [...category.metrics];
    if (sort === "score") r.sort((a, b) => b.nationalValue - a.nationalValue);
    else if (sort === "alpha") r.sort((a, b) => a.displayName.localeCompare(b.displayName));
    else r.sort((a, b) => a.lean - b.lean);
    return r;
  }, [category.metrics, sort]);

  return (
    <section className="mt-4 flex flex-col gap-4">
      <div>
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← National overview
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-card-border bg-card p-4 shadow-card">
        <span className="text-primary">
          <CategoryIcon icon={CATEGORY_ICONS[category.id] ?? "library"} className="h-6 w-6" />
        </span>
        <div className="min-w-[200px] flex-1">
          <h2 className="font-display text-heading-lg font-bold text-foreground">
            {category.displayName}
          </h2>
          <div className="mt-0.5 text-body-sm text-muted">
            {data.countryDisplayName} · seven metrics spanning the ideological range
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className={`text-display font-extrabold leading-none tabular-nums ${tone.text}`}>
              {Math.round(category.score)}
              <span className="text-body-sm font-normal text-muted">/100</span>
            </div>
            <div className="mt-1">
              <StatusBadge score={category.score} label={category.status} />
            </div>
          </div>
          <div className="text-body-sm text-muted">
            <div className="font-mono text-body-xs uppercase tracking-wider">Movement</div>
            <div className="mt-0.5 italic">series begins this campaign</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,2.1fr)_minmax(250px,1fr)]">
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-body-xs uppercase tracking-widest text-muted">
              Metrics — ideological order, L → R
            </span>
            <label className="flex items-center gap-2 text-body-sm text-muted">
              Sort
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="rounded-md border border-card-border bg-card px-2 py-1 text-body-sm text-foreground"
              >
                <option value="lean">Ideological lean</option>
                <option value="score">Objective score</option>
                <option value="alpha">Alphabetical</option>
              </select>
            </label>
          </div>
          {rows.map((m) => {
            const mTone = scoreTone(m.nationalValue);
            return (
              <div
                key={m.id}
                role="button"
                tabIndex={0}
                onClick={() => onOpenMetric(m.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") onOpenMetric(m.id);
                }}
                className="card-hover flex cursor-pointer items-center gap-4 rounded-lg border border-card-border bg-card p-4 shadow-card"
              >
                <div className="w-24 flex-shrink-0 text-center">
                  <LeanChip lean={m.lean} label={m.leanLabel} className="px-1.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-body font-semibold leading-snug text-foreground">
                    {m.displayName}
                  </div>
                  <div className="mt-0.5 text-body-sm leading-normal text-muted">
                    {m.description}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-3 text-body-xs text-muted">
                    <span>
                      <span className="text-success">+</span> {m.pos[0]}
                    </span>
                    <span>
                      <span className="text-error">−</span> {m.neg[0]}
                    </span>
                  </div>
                </div>
                <div className="w-20 flex-shrink-0 text-right">
                  <div
                    className={`text-heading font-extrabold leading-none tabular-nums ${mTone.text}`}
                  >
                    {Math.round(m.nationalValue)}
                  </div>
                  <div className="mt-0.5 text-body-xs text-muted">{m.status}</div>
                </div>
                <span className="flex-shrink-0 text-muted">›</span>
              </div>
            );
          })}
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-card-border bg-card p-4 shadow-card">
            <div className="mb-2.5 font-mono text-body-xs uppercase tracking-widest text-muted">
              Ideological range
            </div>
            <LeanStrip metrics={category.metrics} onOpenMetric={onOpenMetric} size="lg" />
            <div className="mt-1.5 flex justify-between text-body-xs text-muted">
              <span>Strong Left</span>
              <span>Mixed</span>
              <span>Strong Right</span>
            </div>
            <p className="mt-2.5 text-body-xs leading-normal text-muted">
              Position marks each metric&apos;s political association. Bar height and color mark its
              objective performance — the two are independent.
            </p>
          </div>
          <div className="rounded-lg border border-card-border bg-card p-4 shadow-card">
            <div className="mb-2.5 font-mono text-body-xs uppercase tracking-widest text-muted">
              Active modifiers
            </div>
            {category.metrics.some((m) => m.modifiers.direction !== "flat") ? (
              <div className="flex flex-col gap-1.5">
                {category.metrics
                  .filter((m) => m.modifiers.direction !== "flat")
                  .map((m) => {
                    const gap = Math.round((m.modifiers.target - m.nationalValue) * 10) / 10;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => onOpenMetric(m.id)}
                        className="flex cursor-pointer items-baseline justify-between gap-3 text-left text-body-xs transition-colors hover:text-foreground"
                      >
                        <span className="text-foreground">
                          <span
                            className={
                              m.modifiers.direction === "up" ? "text-success" : "text-error"
                            }
                            aria-hidden="true"
                          >
                            {m.modifiers.direction === "up" ? "▲" : "▼"}
                          </span>{" "}
                          {m.displayName}
                        </span>
                        <span className="shrink-0 tabular-nums text-muted">
                          {Math.abs(gap).toLocaleString("en-US")} pts to target
                        </span>
                      </button>
                    );
                  })}
              </div>
            ) : (
              <div className="text-body-sm italic text-muted">
                No active laws, policies, or events are currently moving this category.
              </div>
            )}
          </div>
          <div className="rounded-lg border border-card-border bg-card p-4 shadow-card">
            <div className="mb-2.5 font-mono text-body-xs uppercase tracking-widest text-muted">
              Relevant legislation
            </div>
            {category.metrics.some((m) => m.legislation?.primary) ? (
              <div className="flex flex-col gap-1.5">
                {category.metrics
                  .filter((m) => m.legislation?.primary)
                  .map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => onOpenMetric(m.id)}
                      className="flex cursor-pointer items-baseline justify-between gap-3 text-left text-body-xs transition-colors hover:text-foreground"
                    >
                      <span className="text-foreground">{m.legislation!.primary!.title}</span>
                      <span className="shrink-0 text-muted">
                        {m.legislation!.primary!.levelName ||
                          `Level ${m.legislation!.primary!.level}`}
                      </span>
                    </button>
                  ))}
              </div>
            ) : (
              <div className="text-body-sm italic text-muted">None linked yet.</div>
            )}
          </div>
          <Button variant="primary" onClick={onCompareCategory}>
            Compare this category across countries →
          </Button>
        </div>
      </div>
    </section>
  );
}
