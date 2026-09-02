"use client";

/**
 * Compare this region against its siblings across all nine categories.
 *
 * Unlike the national CompareView, this one issues NO fetches: every metric in
 * the payload already carries a `regions` array with every region's value, so
 * the whole comparison is a re-read of data already in hand.
 */

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { RegionPoliticalMetricsResponse } from "@/lib/politicalMetrics/queries/regionPoliticalMetrics";
import { CategoryIcon } from "@/app/country/[code]/political-metrics/components/categoryIcons";
import { LeanChip } from "@/app/country/[code]/political-metrics/components/LeanChip";
import { scoreTone } from "@/app/country/[code]/political-metrics/components/tones";

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

/** How many siblings a player may hold on screen at once. */
const MAX_PEERS = 3;

export function RegionCompareView({
  home,
  initialCategoryId,
  onBack,
}: {
  home: RegionPoliticalMetricsResponse;
  initialCategoryId?: string;
  onBack: () => void;
}) {
  const [openCategory, setOpenCategory] = useState<string | null>(initialCategoryId ?? null);
  const [peers, setPeers] = useState<string[]>([]);

  /** Every other region, by id, from any metric's breakdown. */
  const siblings = useMemo(() => {
    const seen = new Map<string, string>();
    for (const cat of home.categories) {
      for (const m of cat.metrics) {
        for (const r of m.regions) if (r.regionId !== home.regionId) seen.set(r.regionId, r.name);
      }
    }
    return [...seen.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [home]);

  /** regionId -> categoryId -> mean score across that category's seven metrics. */
  const scoresByRegion = useMemo(() => {
    const out = new Map<string, Map<string, number>>();
    for (const id of peers) {
      const byCategory = new Map<string, number>();
      for (const cat of home.categories) {
        let sum = 0;
        let n = 0;
        for (const m of cat.metrics) {
          const v = m.regions.find((r) => r.regionId === id)?.value;
          if (typeof v === "number") {
            sum += v;
            n += 1;
          }
        }
        if (n > 0) byCategory.set(cat.id, Math.round((sum / n) * 10) / 10);
      }
      out.set(id, byCategory);
    }
    return out;
  }, [home, peers]);

  const columns = [
    { id: home.regionId, name: home.regionName, self: true },
    ...peers.map((id) => ({
      id,
      name: siblings.find((s) => s.id === id)?.name ?? id,
      self: false,
    })),
  ];

  const scoreFor = (regionId: string, categoryId: string): number | null => {
    if (regionId === home.regionId) {
      return home.categories.find((c) => c.id === categoryId)?.score ?? null;
    }
    return scoresByRegion.get(regionId)?.get(categoryId) ?? null;
  };

  const valueFor = (regionId: string, categoryId: string, metricId: string): number | null => {
    const metric = home.categories
      .find((c) => c.id === categoryId)
      ?.metrics.find((m) => m.id === metricId);
    return metric?.regions.find((r) => r.regionId === regionId)?.value ?? null;
  };

  const togglePeer = (id: string) =>
    setPeers((prev) =>
      prev.includes(id)
        ? prev.filter((p) => p !== id)
        : prev.length >= MAX_PEERS
          ? prev
          : [...prev, id]
    );

  return (
    <section className="mt-4 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← {home.regionName} overview
        </Button>
        <span className="font-mono text-body-xs uppercase tracking-widest text-muted">
          Comparison · up to {MAX_PEERS} {home.regionLabelPlural.toLowerCase()}
        </span>
      </div>

      <div className="rounded-lg border border-card-border bg-card p-4 shadow-card">
        <div className="mb-2.5 font-mono text-body-xs uppercase tracking-widest text-muted">
          Compare against
        </div>
        <div className="flex flex-wrap gap-1.5">
          {siblings.map((s) => {
            const on = peers.includes(s.id);
            const full = !on && peers.length >= MAX_PEERS;
            return (
              <button
                key={s.id}
                type="button"
                disabled={full}
                onClick={() => togglePeer(s.id)}
                className={`rounded border px-2 py-1 font-mono text-body-xs transition-colors ${
                  on
                    ? "border-primary bg-primary/10 text-primary"
                    : full
                      ? "cursor-not-allowed border-card-border text-muted/40"
                      : "border-card-border text-muted hover:border-muted hover:text-foreground"
                }`}
              >
                {s.name}
              </button>
            );
          })}
        </div>
        {peers.length === 0 && (
          <p className="mt-2.5 text-body-sm text-muted">
            Pick a {home.regionLabel.toLowerCase()} to see its scores beside {home.regionName}.
          </p>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-card-border bg-card shadow-card">
        <table className="w-full min-w-[32rem] border-collapse">
          <thead>
            <tr className="border-b border-card-border">
              <th className="px-4 py-2 text-left font-mono text-body-xs uppercase tracking-wider text-muted">
                Category
              </th>
              {columns.map((c) => (
                <th
                  key={c.id}
                  className={`px-4 py-2 text-right font-mono text-body-xs uppercase tracking-wider ${
                    c.self ? "text-primary" : "text-muted"
                  }`}
                >
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* flatMap, not map: returning an array per category would nest
                arrays inside tbody and lean on React to key the outer ones. */}
            {home.categories.flatMap((cat) => {
              const isOpen = openCategory === cat.id;
              return [
                <tr
                  key={cat.id}
                  className="cursor-pointer border-b border-card-border/50 hover:bg-card-muted/40"
                  onClick={() => setOpenCategory(isOpen ? null : cat.id)}
                >
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2 text-body-sm text-foreground">
                      <span className="text-primary">
                        <CategoryIcon
                          icon={CATEGORY_ICONS[cat.id] ?? "library"}
                          className="h-4 w-4"
                        />
                      </span>
                      {cat.displayName}
                      <span className="text-muted" aria-hidden="true">
                        {isOpen ? "▾" : "▸"}
                      </span>
                    </span>
                  </td>
                  {columns.map((c) => {
                    const v = scoreFor(c.id, cat.id);
                    return (
                      <td
                        key={c.id}
                        className={`px-4 py-2.5 text-right font-bold tabular-nums ${
                          v != null ? scoreTone(v).text : "text-muted"
                        }`}
                      >
                        {v != null ? Math.round(v) : "—"}
                      </td>
                    );
                  })}
                </tr>,
                ...(isOpen
                  ? cat.metrics.map((m) => (
                      <tr key={`${cat.id}-${m.id}`} className="border-b border-card-border/30">
                        <td className="py-1.5 pl-10 pr-4">
                          <span className="flex items-center gap-2">
                            <LeanChip lean={m.lean} label={m.leanLabel} className="px-1.5" />
                            <span className="text-body-sm text-muted">{m.displayName}</span>
                          </span>
                        </td>
                        {columns.map((c) => {
                          const v = valueFor(c.id, cat.id, m.id);
                          return (
                            <td
                              key={c.id}
                              className={`px-4 py-1.5 text-right tabular-nums ${
                                v != null ? scoreTone(v).text : "text-muted"
                              }`}
                            >
                              {v != null ? Math.round(v) : "—"}
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  : []),
              ];
            })}
          </tbody>
        </table>
      </div>

      <p className="text-body-xs text-muted">
        Every figure is that {home.regionLabel.toLowerCase()}&apos;s own registry value. Scores are
        the mean of the nine categories&apos; seven metrics.
      </p>
    </section>
  );
}

export default RegionCompareView;
