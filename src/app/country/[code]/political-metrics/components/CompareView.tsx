"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import type { CountryPoliticalMetricsResponse } from "@/lib/politicalMetrics/queries/countryPoliticalMetrics";
import {
  POLITICAL_METRIC_COUNTRY_IDS,
  type PoliticalMetricsCountryId,
} from "@/lib/politicalMetrics/types";
import { sentenceCase } from "./labels";

const LINK_CLASS =
  "text-left underline decoration-card-border underline-offset-4 transition-colors hover:decoration-foreground";

/** Shown on phones above a table that is wider than the screen. */
function ScrollHint() {
  return (
    <p className="mb-2 text-body-sm text-muted sm:hidden">Scroll sideways to see every country.</p>
  );
}

export function CompareView({
  home,
  initialCategoryId,
  onBack,
}: {
  home: CountryPoliticalMetricsResponse;
  initialCategoryId?: string;
  onBack: () => void;
}) {
  const [selected, setSelected] = useState<Record<PoliticalMetricsCountryId, boolean>>({
    US: true,
    UK: true,
    RU: true,
    DD: true,
  });
  const [openCategory, setOpenCategory] = useState<string | null>(initialCategoryId ?? null);
  const [byCountry, setByCountry] = useState<
    Partial<Record<PoliticalMetricsCountryId, CountryPoliticalMetricsResponse | null>>
  >({ [home.countryId]: home });

  const loadCountry = useCallback(async (id: PoliticalMetricsCountryId) => {
    try {
      const res = await fetch(`/api/country/${id.toLowerCase()}/political-metrics`);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as CountryPoliticalMetricsResponse;
      setByCountry((prev) => ({ ...prev, [id]: data }));
    } catch {
      setByCountry((prev) => ({ ...prev, [id]: null }));
    }
  }, []);

  useEffect(() => {
    for (const id of POLITICAL_METRIC_COUNTRY_IDS) {
      if (byCountry[id] === undefined) void loadCountry(id);
    }
  }, [byCountry, loadCountry]);

  const activeIds = POLITICAL_METRIC_COUNTRY_IDS.filter((id) => selected[id]);
  const loadedAll = activeIds.every((id) => byCountry[id] !== undefined);
  const openCatHome = openCategory ? home.categories.find((c) => c.id === openCategory) : undefined;
  const nameOf = (id: PoliticalMetricsCountryId) => byCountry[id]?.countryDisplayName ?? id;
  const toggleCategory = (id: string) => setOpenCategory(openCategory === id ? null : id);

  return (
    <section className="mt-8 flex flex-col gap-10">
      <div>
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← Overview
        </Button>
      </div>

      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <h2 className="text-heading-lg font-semibold tracking-tight text-foreground">
            Country comparison
          </h2>
          <p className="mt-1 text-body text-muted">
            Pick the countries to compare. At least one stays selected.
          </p>
        </div>
        <div role="group" aria-label="Countries to compare" className="flex flex-wrap gap-2">
          {POLITICAL_METRIC_COUNTRY_IDS.map((id) => {
            const on = selected[id];
            return (
              <button
                key={id}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const next = { ...selected, [id]: !on };
                  if (Object.values(next).some(Boolean)) setSelected(next);
                }}
                className={`h-8 cursor-pointer rounded-md border px-3 text-body font-medium transition-colors ${
                  on
                    ? "border-foreground bg-foreground text-background"
                    : "border-card-border text-muted hover:text-foreground"
                }`}
              >
                {nameOf(id)}
              </button>
            );
          })}
        </div>
      </header>

      {!loadedAll ? (
        <LoadingSpinner label="Loading countries…" centered />
      ) : (
        <section aria-labelledby="pm-compare-scores">
          <h3 id="pm-compare-scores" className="text-heading-sm font-semibold text-foreground">
            Scores by category
          </h3>
          <p className="mb-3 mt-1 text-body text-muted">
            Open a category to compare its metric families.
          </p>
          <ScrollHint />
          <div className="overflow-x-auto">
            <table
              aria-labelledby="pm-compare-scores"
              className="w-full min-w-[36rem] border-collapse"
            >
              <thead>
                <tr className="border-b border-card-border text-left text-body-sm text-muted">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Category
                  </th>
                  {activeIds.map((id) => (
                    <th key={id} scope="col" className="px-3 py-2 text-right font-medium">
                      {nameOf(id)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-card-border">
                  <th
                    scope="row"
                    className="py-2.5 pr-3 text-left text-body font-semibold text-foreground"
                  >
                    Overall national score
                  </th>
                  {activeIds.map((id) => {
                    const c = byCountry[id];
                    return c ? (
                      <td
                        key={id}
                        className="px-3 py-2.5 text-right font-mono text-body-lg font-semibold tabular-nums text-foreground"
                      >
                        {Math.round(c.overall)}
                      </td>
                    ) : (
                      <td key={id} className="px-3 py-2.5 text-right text-body text-muted">
                        unavailable
                      </td>
                    );
                  })}
                </tr>
                {home.categories.map((cat) => {
                  const open = openCategory === cat.id;
                  return (
                    <tr
                      key={cat.id}
                      // Mouse convenience; the category name is the keyboard control.
                      onClick={() => toggleCategory(cat.id)}
                      className={`cursor-pointer border-b border-card-border/60 transition-colors hover:bg-card/60 ${
                        open ? "bg-card/60" : ""
                      }`}
                    >
                      <th scope="row" className="py-2.5 pr-3 text-left font-normal">
                        <button
                          type="button"
                          aria-expanded={open}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleCategory(cat.id);
                          }}
                          className="text-left text-body text-foreground"
                        >
                          <span className={LINK_CLASS}>{cat.displayName}</span>
                          <span className="ml-2 text-body-sm text-muted">
                            {open ? "Hide metrics" : "Show metrics"}
                          </span>
                        </button>
                      </th>
                      {activeIds.map((id) => {
                        const score = byCountry[id]?.categories.find((x) => x.id === cat.id)?.score;
                        return score === undefined ? (
                          <td key={id} className="px-3 py-2.5 text-right text-body text-muted">
                            n/a
                          </td>
                        ) : (
                          <td
                            key={id}
                            className="px-3 py-2.5 text-right font-mono text-body tabular-nums text-foreground"
                          >
                            {Math.round(score)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {loadedAll && openCatHome && (
        <section aria-labelledby="pm-compare-families">
          <h3 id="pm-compare-families" className="text-heading-sm font-semibold text-foreground">
            Metric families in {openCatHome.displayName}
          </h3>
          <p className="mb-3 mt-1 max-w-[80ch] text-body text-muted">
            Metric names are country-specific: comparisons match shared metric families, not display
            names. Identical scores do not imply identical institutions, because each country
            pursues these outcomes through its own system.
          </p>
          <ScrollHint />
          <div className="overflow-x-auto">
            <table
              aria-labelledby="pm-compare-families"
              className="w-full min-w-[40rem] border-collapse"
            >
              <thead>
                <tr className="border-b border-card-border text-left text-body-sm text-muted">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Family lean
                  </th>
                  {activeIds.map((id) => (
                    <th key={id} scope="col" className="px-3 py-2 font-medium">
                      {nameOf(id)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {openCatHome.metrics.map((m) => (
                  <tr
                    key={m.id}
                    className="border-b border-card-border/60 align-top last:border-b-0"
                  >
                    <th
                      scope="row"
                      className="whitespace-nowrap py-2.5 pr-3 text-left text-body font-normal text-muted"
                    >
                      {sentenceCase(m.leanLabel)}
                    </th>
                    {activeIds.map((id) => {
                      const cm = byCountry[id]?.categories
                        .find((x) => x.id === openCatHome.id)
                        ?.metrics.find((x) => x.id === m.id);
                      return cm ? (
                        <td key={id} className="px-3 py-2.5">
                          <span className="block text-body leading-snug text-foreground">
                            {cm.displayName}
                          </span>
                          <span className="mt-0.5 block font-mono text-body font-semibold tabular-nums text-foreground">
                            {Math.round(cm.value)}
                          </span>
                        </td>
                      ) : (
                        <td key={id} className="px-3 py-2.5 text-body text-muted">
                          n/a
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </section>
  );
}
