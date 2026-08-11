"use client";

/**
 * SP6 — regional drill-down for one registry category: the seven family
 * metrics scored from THIS region's values, each expandable to the full
 * regional breakdown, with an optional side-by-side comparison against up to
 * two sibling regions (all values come from the national payload's per-metric
 * `regions` arrays — no extra fetches).
 */

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { statusFor } from "@/lib/politicalMetrics/display";
import type { PMCategory } from "./CategoryCard";
import { CategoryIcon } from "./categoryIcons";
import { LeanChip } from "./LeanChip";
import { LeanStrip } from "./LeanStrip";
import { RegionBreakdown } from "./RegionBreakdown";
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

/** A sibling region's mean score across one category's metrics. */
function categoryMeanFor(regionId: string, national: PMCategory): number | null {
  let sum = 0;
  let n = 0;
  for (const m of national.metrics) {
    const v = m.regions.find((r) => r.regionId === regionId)?.value;
    if (typeof v === "number") {
      sum += v;
      n += 1;
    }
  }
  return n > 0 ? Math.round((sum / n) * 10) / 10 : null;
}

export function RegionalCategoryDetail({
  regionId,
  regionName,
  national,
  regional,
  onBack,
}: {
  regionId: string;
  regionName: string;
  /** The category with NATIONAL values + per-metric regions arrays. */
  national: PMCategory;
  /** The same category re-scored to this region (parent's transform). */
  regional: PMCategory;
  onBack: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [compareA, setCompareA] = useState<string>("");
  const [compareB, setCompareB] = useState<string>("");

  const siblings = useMemo(() => {
    const seen = new Map<string, string>();
    for (const m of national.metrics) {
      for (const r of m.regions) {
        if (r.regionId !== regionId) seen.set(r.regionId, r.name);
      }
    }
    return [...seen.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [national.metrics, regionId]);

  const compareIds = [compareA, compareB].filter(Boolean);
  const compareRegions = compareIds.map((id) => ({
    id,
    name: siblings.find((s) => s.id === id)?.name ?? id,
    mean: categoryMeanFor(id, national),
  }));

  const tone = scoreTone(regional.score);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← {regionName} overview
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-card-border bg-card p-4 shadow-card">
        <span className="text-primary">
          <CategoryIcon icon={CATEGORY_ICONS[national.id] ?? "library"} className="h-6 w-6" />
        </span>
        <div className="min-w-[200px] flex-1">
          <h3 className="font-display text-heading-lg font-bold text-foreground">
            {national.displayName}
          </h3>
          <div className="mt-0.5 text-body-sm text-muted">
            {regionName} · seven metrics spanning the ideological range
          </div>
        </div>
        <div className="text-right">
          <div className={`text-display font-extrabold leading-none tabular-nums ${tone.text}`}>
            {Math.round(regional.score)}
            <span className="text-body-sm font-normal text-muted">/100</span>
          </div>
          <div className="mt-1 flex items-center justify-end gap-2">
            <StatusBadge score={regional.score} label={regional.status} />
            <span className="text-body-xs text-muted">national {Math.round(national.score)}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,2.1fr)_minmax(250px,1fr)]">
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-body-xs uppercase tracking-widest text-muted">
              Metrics — ideological order, L → R
            </span>
            <label className="flex flex-wrap items-center gap-2 text-body-sm text-muted">
              Compare
              {[
                { value: compareA, set: setCompareA, exclude: compareB },
                { value: compareB, set: setCompareB, exclude: compareA },
              ].map((slot, i) => (
                <select
                  key={i}
                  value={slot.value}
                  onChange={(e) => slot.set(e.target.value)}
                  className="max-w-[160px] rounded-md border border-card-border bg-card px-2 py-1 text-body-sm text-foreground"
                >
                  <option value="">—</option>
                  {siblings
                    .filter((s) => s.id !== slot.exclude)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              ))}
            </label>
          </div>

          {compareRegions.length > 0 && (
            <div className="flex flex-wrap items-baseline gap-3 rounded-lg border border-card-border bg-card-muted px-3 py-2 text-body-sm">
              <span className="font-mono text-body-xs uppercase tracking-wider text-muted">
                Category score
              </span>
              <span className="font-bold tabular-nums text-foreground">
                {regionName} {Math.round(regional.score)}
              </span>
              {compareRegions.map((c) => (
                <span key={c.id} className="tabular-nums text-muted">
                  {c.name}{" "}
                  <span className={c.mean != null ? scoreTone(c.mean).text : ""}>
                    {c.mean != null ? Math.round(c.mean) : "—"}
                  </span>
                </span>
              ))}
            </div>
          )}

          {regional.metrics.map((m) => {
            const nationalMetric = national.metrics.find((n) => n.id === m.id)!;
            const mTone = scoreTone(m.nationalValue);
            const natDelta = m.nationalValue - nationalMetric.nationalValue;
            const isOpen = expanded === m.id;
            return (
              <div key={m.id} className="flex flex-col">
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={isOpen}
                  onClick={() => setExpanded(isOpen ? null : m.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") setExpanded(isOpen ? null : m.id);
                  }}
                  className={`card-hover flex cursor-pointer items-center gap-4 rounded-lg border border-card-border bg-card p-4 shadow-card ${
                    isOpen ? "rounded-b-none" : ""
                  }`}
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
                        national {Math.round(nationalMetric.nationalValue)}
                        {Math.abs(natDelta) >= 0.5 && (
                          <span
                            className={natDelta > 0 ? "text-success" : "text-error"}
                            aria-hidden="true"
                          >
                            {" "}
                            {natDelta > 0 ? "▲" : "▼"}
                          </span>
                        )}
                      </span>
                      {compareRegions.map((c) => {
                        const v = nationalMetric.regions.find((r) => r.regionId === c.id)?.value;
                        return (
                          <span key={c.id} className="tabular-nums">
                            {c.name}{" "}
                            <span className={v != null ? scoreTone(v).text : ""}>
                              {v != null ? Math.round(v) : "—"}
                            </span>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  <div className="w-16 flex-shrink-0 text-right">
                    <div
                      className={`text-heading font-extrabold leading-none tabular-nums ${mTone.text}`}
                    >
                      {Math.round(m.nationalValue)}
                    </div>
                    <div className="mt-0.5 text-body-xs text-muted">{m.status}</div>
                  </div>
                  <span
                    className={`flex-shrink-0 text-muted transition-transform ${isOpen ? "rotate-90" : ""}`}
                    aria-hidden="true"
                  >
                    ›
                  </span>
                </div>
                {isOpen && (
                  <div className="rounded-b-lg border border-t-0 border-card-border bg-card-muted p-3">
                    <RegionBreakdown
                      nationalValue={nationalMetric.nationalValue}
                      regions={nationalMetric.regions}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-card-border bg-card p-4 shadow-card">
            <div className="mb-2.5 font-mono text-body-xs uppercase tracking-widest text-muted">
              Ideological range
            </div>
            <LeanStrip
              metrics={regional.metrics}
              onOpenMetric={(metricId) => setExpanded(metricId)}
              size="lg"
            />
            <div className="mt-1.5 flex justify-between text-body-xs text-muted">
              <span>Strong Left</span>
              <span>Mixed</span>
              <span>Strong Right</span>
            </div>
            <p className="mt-2.5 text-body-xs leading-normal text-muted">
              Bar height and color mark {regionName}&apos;s objective performance; position marks
              each metric&apos;s political association.
            </p>
          </div>
          <div className="rounded-lg border border-card-border bg-card p-4 shadow-card">
            <div className="mb-2.5 font-mono text-body-xs uppercase tracking-widest text-muted">
              Strongest / weakest here
            </div>
            {(() => {
              const sorted = [...regional.metrics].sort(
                (a, b) => b.nationalValue - a.nationalValue
              );
              const best = sorted[0];
              const worst = sorted[sorted.length - 1];
              return (
                <div className="flex flex-col gap-1.5 text-body-sm">
                  <div className="flex min-w-0 gap-1.5">
                    <span className="flex-shrink-0 text-success">▲</span>
                    <span className="truncate text-foreground">{best.displayName}</span>
                    <span className="ml-auto flex-shrink-0 tabular-nums text-success">
                      {Math.round(best.nationalValue)}
                    </span>
                  </div>
                  <div className="flex min-w-0 gap-1.5">
                    <span className="flex-shrink-0 text-error">▼</span>
                    <span className="truncate text-foreground">{worst.displayName}</span>
                    <span className="ml-auto flex-shrink-0 tabular-nums text-error">
                      {Math.round(worst.nationalValue)}
                    </span>
                  </div>
                </div>
              );
            })()}
            <p className="mt-2.5 text-body-xs leading-normal text-muted">
              Statuses recomputed from {regionName}&apos;s own values · {statusFor(regional.score)}{" "}
              overall. Modifiers and legislation are national-scope — see the national registry.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default RegionalCategoryDetail;
