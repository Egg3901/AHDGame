"use client";

import { useEffect, useMemo, useState } from "react";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { fetchJson } from "@/lib/observability/fetchJson";

interface D3GeoProjection {
  fitSize(size: [number, number], object: unknown): D3GeoProjection;
}

interface D3GeoPath {
  (feature: unknown): string | null;
  centroid(feature: unknown): [number, number];
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const d3Geo = require("d3-geo") as {
  geoMercator: () => D3GeoProjection;
  geoPath: (projection: D3GeoProjection) => D3GeoPath;
};

export interface RegionMapData {
  color: string;
  label?: string;
  tooltip?: string[];
}

export interface RegionMapPathsProps {
  /** URL of a GeoJSON FeatureCollection where each feature's `id` is a region key. */
  geoUrl: string;
  /** SVG viewBox width. */
  width: number;
  /** SVG viewBox height. */
  height: number;
  /** Region color/label/tooltip data, keyed by feature id. */
  regionData: Record<string, RegionMapData>;
  onRegionClick?: (regionId: string) => void;
  /** Optional short overlay labels per region id. */
  labels?: Record<string, string>;
  /** Region ids that should render a smaller label (tiny polygons). */
  smallLabelIds?: ReadonlySet<string>;
}

interface Shape {
  id: string;
  pathD: string;
  centroid: [number, number];
}

function getFeatureId(feature: Feature): string | null {
  const raw = feature.id ?? (feature.properties as { id?: string })?.id;
  return raw != null && raw !== "" ? String(raw).toUpperCase() : null;
}

function collectCoords(coords: unknown, out: [number, number][]): void {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === "number") {
    out.push([coords[0] as number, coords[1] as number]);
    return;
  }
  for (const inner of coords) collectCoords(inner, out);
}

function labelCenter(
  feature: Feature,
  proj: D3GeoProjection,
  fallback: [number, number]
): [number, number] {
  const geom = feature.geometry;
  if (!geom || !("coordinates" in geom)) return fallback;
  const pts: [number, number][] = [];
  collectCoords(geom.coordinates, pts);
  if (pts.length === 0) return fallback;
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const lonLat: [number, number] = [(minX + maxX) / 2, (minY + maxY) / 2];
  const projected = (proj as unknown as (p: [number, number]) => [number, number] | null)(lonLat);
  if (!projected || !Number.isFinite(projected[0]) || !Number.isFinite(projected[1])) {
    return fallback;
  }
  return projected;
}

export function RegionMapPaths({
  geoUrl,
  width,
  height,
  regionData,
  onRegionClick,
  labels,
  smallLabelIds,
}: RegionMapPathsProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [tooltipContent, setTooltipContent] = useState<string[]>([]);
  const [tooltipPos, setTooltipPos] = useState<{
    x: number;
    y: number;
    yRatio: number;
  } | null>(null);
  const [geo, setGeo] = useState<FeatureCollection<Geometry> | null>(null);

  useEffect(() => {
    fetchJson<FeatureCollection<Geometry>>(geoUrl, { feature: "region-map" })
      .then((data) => setGeo(data))
      .catch(() => {});
  }, [geoUrl]);

  const shapes = useMemo<Shape[]>(() => {
    if (!geo?.features?.length) return [];
    const features = geo.features.map((f) => ({ id: getFeatureId(f), feature: f }));
    const fc: FeatureCollection = { type: "FeatureCollection", features: geo.features };
    const projection = d3Geo.geoMercator().fitSize([width, height], fc);
    const path = d3Geo.geoPath(projection);
    const fallback: [number, number] = [width / 2, height / 2];
    const out: Shape[] = [];
    for (const { id, feature } of features) {
      if (!id) continue;
      const d = path(feature);
      if (!d) continue;
      out.push({ id, pathD: d, centroid: labelCenter(feature, projection, fallback) });
    }
    return out;
  }, [geo, width, height]);

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

  const flipTooltip = tooltipPos ? tooltipPos.yRatio > 0.5 : false;

  if (shapes.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted text-sm">
        Loading map…
      </div>
    );
  }

  return (
    <div className="relative w-full h-full min-w-0 flex items-center justify-center">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-full max-w-full max-h-full object-contain"
      >
        {shapes.map(({ id, pathD }) => {
          const data = regionData[id];
          const isHov = hovered === id;
          const hasData = !!data;
          const fill = data?.color ?? "#1e293b";
          return (
            <path
              key={id}
              d={pathD}
              fill={fill}
              fillOpacity={isHov ? 1.0 : hasData ? 0.85 : 0.4}
              stroke={isHov ? "#ffffff" : "#334155"}
              strokeWidth={isHov ? 1.5 : 0.5}
              style={{
                cursor: hasData ? "pointer" : "default",
                transition: "fill-opacity 0.15s",
              }}
              onMouseEnter={() => {
                setHovered(id);
                setTooltipContent(data?.tooltip ?? [data?.label ?? id]);
              }}
              onMouseLeave={() => {
                setHovered(null);
                setTooltipContent([]);
                setTooltipPos(null);
              }}
              onMouseMove={handleMouseMove}
              onClick={() => hasData && onRegionClick?.(id)}
            />
          );
        })}
        {shapes.map(({ id, centroid }) => {
          const data = regionData[id];
          if (!data) return null;
          const isHov = hovered === id;
          const isSmall = smallLabelIds?.has(id);
          return (
            <text
              key={`label-${id}`}
              x={centroid[0]}
              y={centroid[1]}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={isSmall ? 7 : 10}
              fontWeight={700}
              fill={isHov ? "#ffffff" : "rgba(255,255,255,0.9)"}
              style={{ pointerEvents: "none", userSelect: "none" }}
            >
              {labels?.[id] ?? data?.label ?? id}
            </text>
          );
        })}
      </svg>

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
