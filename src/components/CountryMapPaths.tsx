"use client";

import dynamic from "next/dynamic";
import type { RegionMapData } from "@/components/UKMapPaths";
import {
  STATE_MAPS,
  getStateMapRenderMode,
  type StateMapRenderMode,
} from "@/app/country/[code]/parties/[id]/components/slate/stateMapData";

export type { RegionMapData };

const MapFallback = () => (
  <div className="flex h-full items-center justify-center text-sm text-muted">Loading map…</div>
);

const USAMapPaths = dynamic(
  () => import("@/components/USAMapPaths").then((m) => ({ default: m.USAMapPaths })),
  { loading: MapFallback, ssr: false }
);
const UKMapPaths = dynamic(
  () => import("@/components/UKMapPaths").then((m) => ({ default: m.UKMapPaths })),
  { loading: MapFallback, ssr: false }
);
const JapanMapPaths = dynamic(
  () => import("@/components/JapanMapPaths").then((m) => ({ default: m.JapanMapPaths })),
  { loading: MapFallback, ssr: false }
);
const GermanyMapPaths = dynamic(
  () => import("@/components/GermanyMapPaths").then((m) => ({ default: m.GermanyMapPaths })),
  { loading: MapFallback, ssr: false }
);

/** Per-geometry frame. Aspect ratios are intrinsic to each country's projection. */
const LAYOUT: Record<
  Exclude<StateMapRenderMode, "bubble">,
  { className: string; aspectRatio: string }
> = {
  usa_paths: { className: "w-full", aspectRatio: "960/600" },
  uk_paths: { className: "mx-auto w-full max-w-[320px]", aspectRatio: "280/400" },
  jp_paths: { className: "mx-auto w-full max-w-[340px]", aspectRatio: "300/440" },
  de_paths: { className: "mx-auto w-full max-w-[340px]", aspectRatio: "300/440" },
};

const EMPTY_REGIONS: ReadonlySet<string> = new Set<string>();
const regionCache = new Map<string, ReadonlySet<string>>();

/**
 * Region ids this country can draw. Empty when the country has no geometry.
 * `CountryMapPaths` owns this question so consumers don't reach into the
 * recruitment-slate module for map data.
 */
export function getMappableRegions(countryId: string): ReadonlySet<string> {
  const cached = regionCache.get(countryId);
  if (cached) return cached;
  const table = STATE_MAPS[countryId];
  if (!table) return EMPTY_REGIONS;
  const set: ReadonlySet<string> = new Set(Object.keys(table));
  regionCache.set(countryId, set);
  return set;
}

/** True when this country has a geographic map to render. */
export function countryHasMap(countryId: string): boolean {
  return getMappableRegions(countryId).size > 0;
}

export interface CountryMapPathsProps {
  countryId: string;
  regionData: Record<string, RegionMapData>;
  highlighted?: string[];
  onRegionClick?: (regionId: string) => void;
  /** When supplied, each region with data renders inside an SVG <a href>. */
  regionHref?: (regionId: string) => string | undefined;
  /** Extra classes for the frame (e.g. rounded/background). */
  className?: string;
}

/**
 * Renders the correct per-country map component, normalizing the prop-name
 * differences between USAMapPaths (stateData/onStateClick/highlightedStates)
 * and the UK/JP/DE components (regionData/onRegionClick/highlightedRegions).
 */
export function CountryMapPaths({
  countryId,
  regionData,
  highlighted,
  onRegionClick,
  regionHref,
  className,
}: CountryMapPathsProps) {
  const renderMode = getStateMapRenderMode(countryId);
  if (renderMode === "bubble" || !countryHasMap(countryId)) return null;

  const inner =
    renderMode === "usa_paths" ? (
      <USAMapPaths
        stateData={regionData}
        highlightedStates={highlighted}
        onStateClick={onRegionClick}
        regionHref={regionHref}
      />
    ) : renderMode === "uk_paths" ? (
      <UKMapPaths
        regionData={regionData}
        highlightedRegions={highlighted}
        onRegionClick={onRegionClick}
        regionHref={regionHref}
      />
    ) : renderMode === "jp_paths" ? (
      <JapanMapPaths
        regionData={regionData}
        highlightedRegions={highlighted}
        onRegionClick={onRegionClick}
        regionHref={regionHref}
      />
    ) : (
      <GermanyMapPaths
        regionData={regionData}
        highlightedRegions={highlighted}
        onRegionClick={onRegionClick}
        regionHref={regionHref}
      />
    );

  const layout = LAYOUT[renderMode];
  return (
    <div
      className={`${layout.className}${className ? ` ${className}` : ""}`}
      style={{ aspectRatio: layout.aspectRatio }}
    >
      {inner}
    </div>
  );
}
