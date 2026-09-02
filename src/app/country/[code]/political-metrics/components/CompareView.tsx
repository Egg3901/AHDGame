"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import type { CountryPoliticalMetricsResponse } from "@/lib/politicalMetrics/queries/countryPoliticalMetrics";
import {
  POLITICAL_METRIC_COUNTRY_IDS,
  type PoliticalMetricsCountryId,
} from "@/lib/politicalMetrics/types";
import { CategoryIcon } from "./categoryIcons";
import { LeanChip } from "./LeanChip";
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

  return (
    <section className="mt-4 flex flex-col gap-4">
      <div>
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← National overview
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-card-border bg-card p-4 shadow-card">
        <h2 className="flex-1 font-display text-heading-lg font-bold text-foreground">
          Country comparison
        </h2>
        <div className="flex flex-wrap gap-2">
          {POLITICAL_METRIC_COUNTRY_IDS.map((id) => {
            const on = selected[id];
            const name = byCountry[id]?.countryDisplayName ?? id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  const next = { ...selected, [id]: !on };
                  if (Object.values(next).some(Boolean)) setSelected(next);
                }}
                className={`cursor-pointer rounded-md border px-3 py-1 text-body-sm font-semibold transition-colors ${
                  on
                    ? "border-primary/60 bg-primary/10 text-foreground"
                    : "border-card-border text-muted hover:text-foreground"
                }`}
              >
                {name}
              </button>
            );
          })}
        </div>
      </div>

      {!loadedAll ? (
        <LoadingSpinner label="Retrieving registries…" centered />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-card-border bg-card p-0 shadow-card">
          <div className="min-w-[640px]">
            <div
              className="grid border-b border-card-border px-4 py-2 font-mono text-body-xs uppercase tracking-wider text-muted"
              style={{ gridTemplateColumns: `minmax(190px,1.5fr) repeat(${activeIds.length},1fr)` }}
            >
              <span>Category</span>
              {activeIds.map((id) => (
                <span key={id} className="text-center">
                  {(byCountry[id]?.countryDisplayName ?? id).toUpperCase()}
                </span>
              ))}
            </div>
            <div
              className="grid border-b border-dashed border-card-border bg-card-muted px-4 py-2"
              style={{ gridTemplateColumns: `minmax(190px,1.5fr) repeat(${activeIds.length},1fr)` }}
            >
              <span className="text-body-sm font-bold text-foreground">Overall national score</span>
              {activeIds.map((id) => {
                const c = byCountry[id];
                if (!c)
                  return (
                    <span key={id} className="text-center text-body-sm italic text-muted">
                      unavailable
                    </span>
                  );
                const tone = scoreTone(c.overall);
                return (
                  <span key={id} className="text-center">
                    <span className={`text-body-lg font-extrabold tabular-nums ${tone.text}`}>
                      {Math.round(c.overall)}
                    </span>
                  </span>
                );
              })}
            </div>
            {home.categories.map((cat) => (
              <div
                key={cat.id}
                role="button"
                tabIndex={0}
                onClick={() => setOpenCategory(openCategory === cat.id ? null : cat.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ")
                    setOpenCategory(openCategory === cat.id ? null : cat.id);
                }}
                className={`grid cursor-pointer items-center border-b border-dashed border-card-border px-4 py-2 ${
                  openCategory === cat.id ? "bg-card-muted" : ""
                }`}
                style={{
                  gridTemplateColumns: `minmax(190px,1.5fr) repeat(${activeIds.length},1fr)`,
                }}
              >
                <span className="flex items-center gap-2 text-body-sm text-foreground">
                  <span className="text-primary">
                    <CategoryIcon
                      icon={CATEGORY_ICONS[cat.id] ?? "library"}
                      className="h-3.5 w-3.5"
                    />
                  </span>
                  {cat.displayName}
                  <span className="text-body-xs text-muted">
                    {openCategory === cat.id ? "▲ close" : "▼ metrics"}
                  </span>
                </span>
                {activeIds.map((id) => {
                  const c = byCountry[id];
                  const score = c?.categories.find((x) => x.id === cat.id)?.score;
                  if (score === undefined)
                    return (
                      <span key={id} className="text-center text-body-sm italic text-muted">
                        —
                      </span>
                    );
                  const tone = scoreTone(score);
                  return (
                    <span
                      key={id}
                      className={`text-center text-body font-bold tabular-nums ${tone.text}`}
                    >
                      {Math.round(score)}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {loadedAll && openCatHome && (
        <div className="rounded-lg border border-card-border bg-card p-4 shadow-card">
          <div className="mb-1 font-mono text-body-xs uppercase tracking-widest text-muted">
            Metric families — {openCatHome.displayName.toUpperCase()}
          </div>
          <p className="mb-3 max-w-[80ch] text-body-xs leading-normal text-muted">
            Metric names are country-specific: comparisons match shared metric families, not display
            names. Identical scores do not imply identical institutions — each country pursues these
            outcomes through its own system.
          </p>
          <div className="flex flex-col gap-2.5">
            {openCatHome.metrics.map((m) => (
              <div
                key={m.id}
                className="rounded-md border border-card-border bg-card-muted px-3 py-2.5"
              >
                <div className="mb-2 flex items-center gap-2.5">
                  <LeanChip lean={m.lean} label={m.leanLabel} />
                  <span className="text-body-xs text-muted">family</span>
                </div>
                <div
                  className="grid gap-4"
                  style={{ gridTemplateColumns: `repeat(${activeIds.length},1fr)` }}
                >
                  {activeIds.map((id) => {
                    const c = byCountry[id];
                    const cm = c?.categories
                      .find((x) => x.id === openCatHome.id)
                      ?.metrics.find((x) => x.id === m.id);
                    if (!cm)
                      return (
                        <span key={id} className="text-body-sm italic text-muted">
                          —
                        </span>
                      );
                    const tone = scoreTone(cm.value);
                    return (
                      <div key={id} className="min-w-0">
                        <div className="text-body-sm font-semibold leading-snug text-foreground">
                          {cm.displayName}
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-track">
                            <span
                              className={`block h-full rounded-full ${tone.bg}`}
                              style={{ width: `${cm.value}%` }}
                            />
                          </span>
                          <span className={`text-body-sm font-extrabold tabular-nums ${tone.text}`}>
                            {Math.round(cm.value)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
