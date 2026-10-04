"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { PMCategory, PMRegistryData } from "./registryTypes";
import { sentenceCase } from "./labels";
import { LeanStrip } from "./LeanStrip";
import {
  NO_HISTORY_YET,
  categoryAtSnapshot,
  deltaTextClass,
  formatDelta,
  movementSince,
} from "./movement";
import { statusTextClass } from "./tones";

/** v1 sort options. Trend, severity and recency return with the dynamics sub-project. */
type SortKey = "lean" | "score" | "alpha";

const SORT_CAPTION: Record<SortKey, string> = {
  lean: "Ordered by political association, left to right.",
  score: "Ordered by score, highest first.",
  alpha: "Ordered by name.",
};

const LINK_CLASS =
  "text-left underline decoration-card-border underline-offset-4 transition-colors hover:decoration-foreground";

export function CategoryDetailView({
  data,
  category,
  onBack,
  onOpenMetric,
  onCompareCategory,
}: {
  data: PMRegistryData;
  category: PMCategory;
  onBack: () => void;
  onOpenMetric: (metricId: string) => void;
  onCompareCategory: () => void;
}) {
  const [sort, setSort] = useState<SortKey>("lean");
  const rows = useMemo(() => {
    const r = [...category.metrics];
    if (sort === "score") r.sort((a, b) => b.value - a.value);
    else if (sort === "alpha") r.sort((a, b) => a.displayName.localeCompare(b.displayName));
    else r.sort((a, b) => a.lean - b.lean);
    return r;
  }, [category.metrics, sort]);
  const movement = movementSince(category.score, categoryAtSnapshot(category, 0));
  const moving = category.metrics.filter((m) => m.modifiers.direction !== "flat");
  const legislated = category.metrics.filter((m) => m.legislation?.primary);

  return (
    <section className="mt-8 flex flex-col gap-10">
      <div>
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← Overview
        </Button>
      </div>

      <header>
        <h2 className="text-heading-lg font-semibold tracking-tight text-foreground">
          {category.displayName}
        </h2>
        <p className="mt-1 text-body text-muted">
          {data.countryDisplayName} · seven metrics spanning the ideological range
        </p>
        <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-display font-semibold leading-none tabular-nums text-foreground">
            {Math.round(category.score)}
          </span>
          <span className={`text-heading-sm font-semibold ${statusTextClass(category.status)}`}>
            {category.status}
          </span>
        </div>
        <p className="mt-2 text-body text-muted">
          Change over the last {data.historyCadenceTurns} turns:{" "}
          {movement ? (
            <>
              <span className={`font-semibold tabular-nums ${deltaTextClass(movement.delta)}`}>
                {formatDelta(movement.delta)}
              </span>{" "}
              from {Math.round(movement.from)}
            </>
          ) : (
            NO_HISTORY_YET.toLowerCase()
          )}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)] lg:items-start">
        <section aria-labelledby="pm-category-metrics" className="min-w-0">
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
            <div>
              <h3
                id="pm-category-metrics"
                className="text-heading-sm font-semibold text-foreground"
              >
                Metrics
              </h3>
              <p className="mt-0.5 text-body text-muted">{SORT_CAPTION[sort]}</p>
            </div>
            <label className="flex items-center gap-2 text-body text-muted">
              Sort by
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="rounded-md border border-card-border bg-card px-2 py-1 text-body text-foreground"
              >
                <option value="lean">Ideological lean</option>
                <option value="score">Objective score</option>
                <option value="alpha">Alphabetical</option>
              </select>
            </label>
          </div>

          <table aria-labelledby="pm-category-metrics" className="mt-3 w-full border-collapse">
            <thead>
              <tr className="border-b border-card-border text-left text-body-sm text-muted">
                <th scope="col" className="hidden py-2 pr-3 font-medium sm:table-cell">
                  Lean
                </th>
                <th scope="col" className="py-2 pr-3 font-medium sm:px-3">
                  Metric
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Score
                </th>
                <th scope="col" className="hidden py-2 pl-3 font-medium sm:table-cell">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const statusClass = statusTextClass(m.status);
                const lean = sentenceCase(m.leanLabel);
                return (
                  <tr
                    key={m.id}
                    // Mouse convenience, as the old card had; the metric name
                    // is the keyboard control.
                    onClick={() => onOpenMetric(m.id)}
                    className="cursor-pointer border-b border-card-border/60 align-top transition-colors last:border-b-0 hover:bg-card/60"
                  >
                    <td className="hidden whitespace-nowrap py-3 pr-3 text-body text-muted sm:table-cell">
                      {lean}
                    </td>
                    <th scope="row" className="py-3 pr-3 text-left font-normal sm:px-3">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenMetric(m.id);
                        }}
                        className={`${LINK_CLASS} text-body font-medium text-foreground`}
                      >
                        {m.displayName}
                      </button>
                      <span className="mt-0.5 block text-body-sm text-muted sm:hidden">{lean}</span>
                      {m.description && (
                        <span className="mt-1 block text-body text-muted">{m.description}</span>
                      )}
                      {(m.pos[0] || m.neg[0]) && (
                        <span className="mt-1.5 block text-body-sm text-muted">
                          {m.pos[0] && <span className="mr-4">Positive: {m.pos[0]}</span>}
                          {m.neg[0] && <span>Negative: {m.neg[0]}</span>}
                        </span>
                      )}
                    </th>
                    <td className="px-3 py-3 text-right">
                      <span className="font-mono text-body-lg font-semibold tabular-nums text-foreground">
                        {Math.round(m.value)}
                      </span>
                      <span className={`mt-0.5 block text-body-sm sm:hidden ${statusClass}`}>
                        {m.status}
                      </span>
                    </td>
                    <td className={`hidden py-3 pl-3 text-body sm:table-cell ${statusClass}`}>
                      {m.status}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <aside className="flex min-w-0 flex-col gap-10">
          <section aria-labelledby="pm-category-range">
            <h3 id="pm-category-range" className="text-heading-sm font-semibold text-foreground">
              Ideological range
            </h3>
            <div className="mt-3">
              <LeanStrip metrics={category.metrics} onOpenMetric={onOpenMetric} size="lg" />
            </div>
            <div className="mt-1.5 flex justify-between gap-2 text-body-sm text-muted">
              <span>Strong left</span>
              <span>Mixed</span>
              <span>Strong right</span>
            </div>
            <p className="mt-3 text-body text-muted">
              Each bar is one metric, placed by its political association and as tall as its score.
              Lean describes association, not quality.
            </p>
          </section>

          <section aria-labelledby="pm-category-modifiers">
            <h3
              id="pm-category-modifiers"
              className="text-heading-sm font-semibold text-foreground"
            >
              Active modifiers
            </h3>
            {moving.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {moving.map((m) => {
                  const gap = Math.round((m.modifiers.target - m.value) * 10) / 10;
                  const up = m.modifiers.direction === "up";
                  return (
                    <li key={m.id} className="flex items-baseline justify-between gap-3 text-body">
                      <button
                        type="button"
                        onClick={() => onOpenMetric(m.id)}
                        className={`${LINK_CLASS} text-foreground`}
                      >
                        <span className={up ? "text-success" : "text-error"} aria-hidden="true">
                          {up ? "▲" : "▼"}
                        </span>{" "}
                        <span className="sr-only">{up ? "Rising: " : "Falling: "}</span>
                        {m.displayName}
                      </button>
                      <span className="shrink-0 text-body-sm tabular-nums text-muted">
                        {Math.abs(gap).toLocaleString("en-US")} pts to target
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-2 text-body text-muted">
                No active laws, policies, or events are currently moving this category.
              </p>
            )}
          </section>

          <section aria-labelledby="pm-category-legislation">
            <h3
              id="pm-category-legislation"
              className="text-heading-sm font-semibold text-foreground"
            >
              Relevant legislation
            </h3>
            {legislated.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {legislated.map((m) => {
                  const primary = m.legislation!.primary!;
                  return (
                    <li key={m.id} className="flex items-baseline justify-between gap-3 text-body">
                      <button
                        type="button"
                        onClick={() => onOpenMetric(m.id)}
                        className={`${LINK_CLASS} text-foreground`}
                      >
                        {primary.title}
                      </button>
                      <span className="shrink-0 text-body-sm text-muted">
                        {primary.levelName || `Level ${primary.level}`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-2 text-body text-muted">None linked yet.</p>
            )}
          </section>

          <div>
            <Button variant="secondary" onClick={onCompareCategory}>
              {data.scope === "region"
                ? "Compare this category with other regions"
                : "Compare this category across countries"}
            </Button>
          </div>
        </aside>
      </div>
    </section>
  );
}
