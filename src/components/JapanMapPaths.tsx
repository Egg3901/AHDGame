"use client";

import { useState, useEffect, useMemo } from "react";
import { RegionLink } from "@/components/mapRegionLink";
interface D3GeoProjection {
  center(center: [number, number]): D3GeoProjection;
  scale(scale: number): D3GeoProjection;
  translate(translate: [number, number]): D3GeoProjection;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const d3Geo = require("d3-geo") as {
  geoMercator: () => D3GeoProjection;
  geoPath: (projection: D3GeoProjection) => (feature: unknown) => string | null;
};
import * as topojson from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { MultiPolygon } from "geojson";

export interface RegionMapData {
  color: string;
  label?: string;
  tooltip?: string[];
}

interface JapanMapPathsProps {
  regionData: Record<string, RegionMapData>;
  onRegionClick?: (regionId: string) => void;
  highlightedRegions?: Set<string> | string[];
  /** When supplied, regions with data render inside an SVG <a href>. */
  regionHref?: (regionId: string) => string | undefined;
}

import { CDN_GEO } from "@/lib/images/cdnUrls";
import { fetchJson } from "@/lib/observability/fetchJson";
const GEO_URL = CDN_GEO.japanPrefectures;

/**
 * Prefecture code (1–47) → game region ID.
 * Groups 47 prefectures into 8 game regions matching japan.ts.
 */
const PREF_TO_REGION: Record<number, string> = {
  1: "HOK",
  2: "TOH",
  3: "TOH",
  4: "TOH",
  5: "TOH",
  6: "TOH",
  7: "TOH",
  8: "KAN",
  9: "KAN",
  10: "KAN",
  11: "KAN",
  12: "KAN",
  13: "KAN",
  14: "KAN",
  15: "CHU",
  16: "CHU",
  17: "CHU",
  18: "CHU",
  19: "CHU",
  20: "CHU",
  21: "CHU",
  22: "CHU",
  23: "CHU",
  24: "KNS",
  25: "KNS",
  26: "KNS",
  27: "KNS",
  28: "KNS",
  29: "KNS",
  30: "KNS",
  31: "CGK",
  32: "CGK",
  33: "CGK",
  34: "CGK",
  35: "CGK",
  36: "SHI",
  37: "SHI",
  38: "SHI",
  39: "SHI",
  40: "KYU",
  41: "KYU",
  42: "KYU",
  43: "KYU",
  44: "KYU",
  45: "KYU",
  46: "KYU",
  47: "KYU",
};

const REGION_IDS = ["HOK", "TOH", "KAN", "CHU", "KNS", "CGK", "SHI", "KYU"] as const;

const REGION_LABELS: Record<string, string> = {
  HOK: "Hokkaido",
  TOH: "Tohoku",
  KAN: "Kanto",
  CHU: "Chubu",
  KNS: "Kansai",
  CGK: "Chugoku",
  SHI: "Shikoku",
  KYU: "Kyushu",
};

interface MergedRegion {
  id: string;
  geometry: MultiPolygon;
  pathD: string;
}

const WIDTH = 300;
const HEIGHT = 440;

const projection = d3Geo
  .geoMercator()
  .center([137.5, 36.5])
  .scale(1000)
  .translate([WIDTH / 2, HEIGHT / 2]);

const path = d3Geo.geoPath(projection);

export function JapanMapPaths({
  regionData,
  onRegionClick,
  highlightedRegions,
  regionHref,
}: JapanMapPathsProps) {
  const highlightedSet = Array.isArray(highlightedRegions)
    ? new Set(highlightedRegions)
    : (highlightedRegions ?? new Set<string>());
  const [hovered, setHovered] = useState<string | null>(null);
  const [tooltipContent, setTooltipContent] = useState<string[]>([]);
  const [tooltipPos, setTooltipPos] = useState<{
    x: number;
    y: number;
    yRatio: number;
  } | null>(null);
  const [topo, setTopo] = useState<Topology | null>(null);

  useEffect(() => {
    fetchJson<Topology>(GEO_URL, { feature: "japan-map" })
      .then((data) => setTopo(data))
      .catch(() => {});
  }, []);

  // Merge 47 prefectures into 8 region polygons using topojson.merge
  const mergedRegions = useMemo<MergedRegion[]>(() => {
    if (!topo) return [];

    const japanObj = topo.objects.japan as GeometryCollection;
    if (!japanObj?.geometries) return [];

    // Group geometries by region
    const byRegion = new Map<string, typeof japanObj.geometries>();
    for (const geom of japanObj.geometries) {
      const prefId = (geom.properties as { id?: number })?.id;
      if (prefId == null) continue;
      const regionId = PREF_TO_REGION[prefId];
      if (!regionId) continue;
      const arr = byRegion.get(regionId) ?? [];
      arr.push(geom);
      byRegion.set(regionId, arr);
    }

    // Merge each region's geometries into a single MultiPolygon
    const results: MergedRegion[] = [];
    for (const regionId of REGION_IDS) {
      const geoms = byRegion.get(regionId);
      if (!geoms || geoms.length === 0) continue;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const merged = topojson.merge(topo, geoms as any) as MultiPolygon;
      const d = path(merged);
      if (d) {
        results.push({ id: regionId, geometry: merged, pathD: d });
      }
    }
    return results;
  }, [topo]);

  const handleMouseMove = (e: React.MouseEvent) => {
    const svg = (e.currentTarget as SVGElement).closest("svg");
    const rect = svg?.getBoundingClientRect();
    if (rect) {
      const y = e.clientY - rect.top;
      setTooltipPos({
        x: e.clientX - rect.left,
        y,
        yRatio: rect.height > 0 ? y / rect.height : 0,
      });
    }
  };

  // Flip tooltip above the cursor when hovering the lower half of the map
  // so the full breakdown isn't clipped by the map container's bottom edge.
  const flipTooltip = tooltipPos ? tooltipPos.yRatio > 0.5 : false;

  if (mergedRegions.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted text-sm">
        Loading map…
      </div>
    );
  }

  return (
    <div className="relative w-full h-full min-w-0 flex items-center justify-center">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-full max-w-full max-h-full object-contain"
      >
        {mergedRegions.map(({ id, pathD }) => {
          const data = regionData[id];
          const isHov = hovered === id;
          const isHighlighted = highlightedSet.has(id);
          const hasData = !!data;
          const fill = data?.color ?? "#1e293b";

          const href = hasData ? regionHref?.(id) : undefined;

          return (
            <RegionLink key={id} href={href} regionId={id} onActivate={onRegionClick}>
              <path
                d={pathD}
                fill={fill}
                fillOpacity={isHov ? 1.0 : hasData ? 0.85 : 0.4}
                stroke={isHov ? "#ffffff" : isHighlighted ? "#a855f7" : "#334155"}
                strokeWidth={isHov ? 1.5 : isHighlighted ? 2.5 : 0.5}
                style={{
                  cursor: hasData ? "pointer" : "default",
                  transition: "fill-opacity 0.15s",
                }}
                onMouseEnter={() => {
                  setHovered(id);
                  setTooltipContent(data?.tooltip ?? [REGION_LABELS[id] ?? id]);
                }}
                onMouseLeave={() => {
                  setHovered(null);
                  setTooltipContent([]);
                  setTooltipPos(null);
                }}
                onMouseMove={handleMouseMove}
                // When an href exists the anchor owns activation; keeping this
                // handler too would fire onRegionClick twice (directly and again
                // via bubbling to the <a>).
                onClick={href ? undefined : () => hasData && onRegionClick?.(id)}
              />
            </RegionLink>
          );
        })}
      </svg>

      {/* Tooltip */}
      {tooltipPos && tooltipContent.length > 0 && (
        <div
          className="pointer-events-none absolute z-50 rounded-lg border border-card-border bg-background/95 px-3 py-2 text-xs shadow-lg backdrop-blur-sm"
          style={{
            left: tooltipPos.x + 12,
            top: tooltipPos.y + (flipTooltip ? -12 : -8),
            transform: flipTooltip ? "translateY(-100%)" : undefined,
          }}
        >
          {tooltipContent.map((line, i) => (
            <div key={i} className={i === 0 ? "font-semibold text-foreground" : "text-muted"}>
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
