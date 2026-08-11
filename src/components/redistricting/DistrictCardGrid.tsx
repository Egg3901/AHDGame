"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DistrictCard, type CampaignContext } from "./DistrictCard";
import { DistrictCompositionSummary } from "./DistrictCompositionSummary";
import type { DistrictSquareView } from "@/lib/redistricting/districtSquareResponse";
import type { RedistrictCaps } from "@/lib/redistricting/caps";

type SortMode = "competitive" | "leftRight" | "rightLeft";

const SORTS: { id: SortMode; label: string }[] = [
  { id: "competitive", label: "Most competitive" },
  { id: "leftRight", label: "Lean: left → right" },
  { id: "rightLeft", label: "Lean: right → left" },
];

function sortViews(views: DistrictSquareView[], mode: SortMode): DistrictSquareView[] {
  const copy = [...views];
  switch (mode) {
    case "competitive":
      return copy.sort((a, b) => Math.abs(a.netLean) - Math.abs(b.netLean) || a.index - b.index);
    case "leftRight":
      return copy.sort((a, b) => a.netLean - b.netLean || a.index - b.index);
    case "rightLeft":
      return copy.sort((a, b) => b.netLean - a.netLean || a.index - b.index);
  }
}

function SkeletonCard() {
  return (
    <div className="rounded-lg border border-card-border bg-card overflow-hidden animate-pulse">
      <div className="px-3 py-2 border-b border-card-border/60 bg-card-muted/30">
        <div className="h-3 w-20 rounded bg-card-muted" />
      </div>
      <div className="px-3 py-3 space-y-2">
        <div className="h-7 w-full rounded-md bg-card-muted" />
        <div className="h-2 w-12 rounded bg-card-muted" />
      </div>
      <div className="px-3 py-2 border-t border-card-border/60">
        <div className="h-2 w-24 rounded bg-card-muted" />
      </div>
    </div>
  );
}

export function DistrictCardGrid({
  districts,
  redistrictHref,
  campaign,
  caps,
  loading = false,
  isAdmin = false,
}: {
  districts: DistrictSquareView[];
  redistrictHref?: string;
  campaign?: CampaignContext;
  caps?: RedistrictCaps;
  loading?: boolean;
  isAdmin?: boolean;
}) {
  const [sort, setSort] = useState<SortMode>("competitive");
  const sorted = useMemo(() => sortViews(districts, sort), [districts, sort]);
  const squares = useMemo(() => districts.map((d) => d.squares), [districts]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  if (districts.length === 0) {
    return (
      <div className="rounded-lg border border-card-border bg-card px-4 py-6 text-center text-sm text-muted">
        <p>District data hasn&apos;t been generated for this state yet.</p>
        {isAdmin ? (
          <p className="mt-1 text-xs">
            Run the seed or trigger redistricting from the admin panel to populate districts.
          </p>
        ) : (
          <p className="mt-1 text-xs">Ask an admin to run the seed or trigger redistricting.</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <DistrictCompositionSummary districts={squares} caps={caps} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs text-muted">
          Sort
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortMode)}
            className="rounded-md border border-card-border bg-card px-2 py-1 text-xs text-foreground"
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        {redistrictHref && (
          <Link
            href={redistrictHref}
            className="rounded-md border border-card-border bg-card px-3 py-1.5 text-xs font-medium hover:border-primary"
          >
            Redistrict map →
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {sorted.map((d) => (
          <DistrictCard key={d.index} district={d} campaign={campaign} />
        ))}
      </div>
    </div>
  );
}
