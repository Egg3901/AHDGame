"use client";

import { useMemo } from "react";
import type { StateMapData } from "@/components/USAMapPaths";
import { CountryMapPaths, countryHasMap } from "@/components/CountryMapPaths";
import type { StatePartyRow } from "@/lib/states/buildStatePartyRows";
import { orgFill } from "./orgTier";

export type MapColorBy = "org" | "reg";

export interface StatePartyMapProps {
  countryId: string;
  rows: StatePartyRow[];
  colorBy: MapColorBy;
  selected: string | null;
  onSelect: (regionId: string) => void;
}

/** Re-exported so existing consumers (StatePartyHQ) keep their import site. */
export { countryHasMap };

export function StatePartyMap({
  countryId,
  rows,
  colorBy,
  selected,
  onSelect,
}: StatePartyMapProps) {
  const regionData = useMemo<Record<string, StateMapData>>(() => {
    const out: Record<string, StateMapData> = {};
    for (const r of rows) {
      const value = colorBy === "org" ? r.organization : r.registrationPct;
      out[r.regionId] = {
        color: orgFill(value),
        label: r.name,
        tooltip: [
          `Org: ${r.organization.toFixed(0)}%`,
          `Reg: ${r.registrationPct.toFixed(0)}%`,
          `PS: ${r.politicalStrength.toFixed(0)}`,
          `NPPs: ${r.nppCount}`,
        ],
      };
    }
    return out;
  }, [rows, colorBy]);

  if (!countryHasMap(countryId)) return null;

  const legendLabel = colorBy === "org" ? "Organization" : "Registration";

  return (
    <div className="rounded-xl border border-card-border bg-card p-4">
      <div className="mb-2 flex items-center gap-2 text-xs text-muted">
        <span>{legendLabel} %</span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-4 rounded" style={{ background: orgFill(10) }} />
          low
          <span className="inline-block h-2 w-4 rounded" style={{ background: orgFill(90) }} />
          high
        </span>
      </div>
      <div className="relative overflow-hidden rounded-lg bg-card-elevated/40">
        <CountryMapPaths
          countryId={countryId}
          regionData={regionData}
          highlighted={selected ? [selected] : undefined}
          onRegionClick={onSelect}
        />
      </div>
    </div>
  );
}
