"use client";

import type { PMCategory, PMMetric } from "./registryTypes";
import { statusTextClass } from "./tones";

/** Quiet underline that firms up on hover, for text that opens something. */
const LINK_CLASS =
  "text-left underline decoration-card-border underline-offset-4 transition-colors hover:decoration-foreground";

/** The highest- and lowest-scoring metric in a category. */
function extremes(category: PMCategory): { best?: PMMetric; worst?: PMMetric } {
  const sorted = [...category.metrics].sort((a, b) => b.value - a.value);
  return { best: sorted[0], worst: sorted[sorted.length - 1] };
}

/** A metric name that opens the metric, with its score beside it. */
function MetricLink({ metric, onOpen }: { metric: PMMetric; onOpen: () => void }) {
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          // The row itself opens the category; this opens the metric instead.
          e.stopPropagation();
          onOpen();
        }}
        className={`${LINK_CLASS} text-foreground`}
      >
        {metric.displayName}
      </button>{" "}
      <span className="font-mono tabular-nums text-muted">{Math.round(metric.value)}</span>
    </>
  );
}

/**
 * The nine categories as one table: score, status, and the strongest and
 * weakest metric in each, with a control to open the category. Only a bad
 * status is coloured. On a phone the status folds under the score and the two
 * metrics fold under the category name, so nothing scrolls sideways.
 */
export function CategoryTable({
  categories,
  onOpenCategory,
  onOpenMetric,
}: {
  categories: PMCategory[];
  onOpenCategory: (categoryId: string) => void;
  onOpenMetric: (categoryId: string, metricId: string) => void;
}) {
  return (
    <section aria-labelledby="pm-categories-heading">
      <h2
        id="pm-categories-heading"
        className="text-heading-lg font-semibold tracking-tight text-foreground"
      >
        Categories
      </h2>
      <p className="mt-1 text-body text-muted">
        Each category is the mean of its seven metrics, out of 100. Open one to see its metrics.
      </p>
      <table aria-labelledby="pm-categories-heading" className="mt-4 w-full border-collapse">
        <thead>
          <tr className="border-b border-card-border text-left text-body-sm text-muted">
            <th scope="col" className="py-2 pr-3 font-medium">
              Category
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Score
            </th>
            <th scope="col" className="hidden px-3 py-2 font-medium sm:table-cell">
              Status
            </th>
            <th scope="col" className="hidden px-3 py-2 font-medium md:table-cell">
              Strongest metric
            </th>
            <th scope="col" className="hidden px-3 py-2 font-medium md:table-cell">
              Weakest metric
            </th>
            <th scope="col" className="py-2 pl-3">
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {categories.map((category) => {
            const { best, worst } = extremes(category);
            const statusClass = statusTextClass(category.status);
            const open = () => onOpenCategory(category.id);
            return (
              <tr
                key={category.id}
                // Mouse convenience: the whole row opens the category, as the
                // old card did. Keyboard and screen-reader users get the Open
                // button at the end of the row.
                onClick={open}
                className="cursor-pointer border-b border-card-border/60 align-top transition-colors last:border-b-0 hover:bg-card/60"
              >
                <th scope="row" className="py-3 pr-3 text-left font-normal">
                  <span className="text-body font-medium text-foreground">
                    {category.displayName}
                  </span>
                  {(best || worst) && (
                    <span className="mt-1 block space-y-0.5 text-body-sm text-muted md:hidden">
                      {best && (
                        <span className="block">
                          Strongest:{" "}
                          <MetricLink
                            metric={best}
                            onOpen={() => onOpenMetric(category.id, best.id)}
                          />
                        </span>
                      )}
                      {worst && (
                        <span className="block">
                          Weakest:{" "}
                          <MetricLink
                            metric={worst}
                            onOpen={() => onOpenMetric(category.id, worst.id)}
                          />
                        </span>
                      )}
                    </span>
                  )}
                </th>
                <td className="px-3 py-3 text-right">
                  <span className="font-mono text-body-lg font-semibold tabular-nums text-foreground">
                    {Math.round(category.score)}
                  </span>
                  <span className={`mt-0.5 block text-body-sm sm:hidden ${statusClass}`}>
                    {category.status}
                  </span>
                </td>
                <td className={`hidden px-3 py-3 text-body sm:table-cell ${statusClass}`}>
                  {category.status}
                </td>
                <td className="hidden px-3 py-3 text-body md:table-cell">
                  {best && (
                    <MetricLink metric={best} onOpen={() => onOpenMetric(category.id, best.id)} />
                  )}
                </td>
                <td className="hidden px-3 py-3 text-body md:table-cell">
                  {worst && (
                    <MetricLink metric={worst} onOpen={() => onOpenMetric(category.id, worst.id)} />
                  )}
                </td>
                <td className="py-3 pl-3 text-right">
                  <button
                    type="button"
                    aria-label={`Open ${category.displayName}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      open();
                    }}
                    className={`${LINK_CLASS} text-body font-medium text-foreground`}
                  >
                    Open
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
