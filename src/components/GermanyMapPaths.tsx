"use client";

import { useEffect, useMemo, useState } from "react";
import { RegionLink } from "@/components/mapRegionLink";
import type { Feature, FeatureCollection, Geometry } from "geojson";

interface D3GeoProjection {
  center(center: [number, number]): D3GeoProjection;
  scale(scale: number): D3GeoProjection;
  translate(translate: [number, number]): D3GeoProjection;
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

interface GermanyMapPathsProps {
  regionData: Record<string, RegionMapData>;
  onRegionClick?: (regionId: string) => void;
  highlightedRegions?: Set<string> | string[];
  /** When supplied, regions with data render inside an SVG <a href>. */
  regionHref?: (regionId: string) => string | undefined;
  /** When set, render ONLY these Länder (by game code) and fit the frame to
   *  them — e.g. West Germany's 11 Länder in the 1979 era. Omit to draw all 16. */
  regionCodes?: string[];
}

import { CDN_GEO } from "@/lib/images/cdnUrls";
import { fetchJson } from "@/lib/observability/fetchJson";
const GEO_URL = CDN_GEO.deLaender;

/** Short display labels for each Land shown on the map. */
const LAND_LABELS: Record<string, string> = {
  SH: "S-H",
  HH: "HH",
  BRE: "BRE",
  MV: "MV",
  NI: "NI",
  NW: "NRW",
  BB: "BB",
  BE: "BE",
  ST: "ST",
  TH: "TH",
  SN: "SN",
  HE: "HE",
  RP: "RP",
  SL: "SL",
  BW: "BW",
  BY: "BY",
};

/** City-states get a smaller label so it fits inside the tiny polygon. */
const SMALL_LANDS = new Set(["BE", "HH", "BRE", "SL"]);

interface LandShape {
  id: string;
  pathD: string;
  centroid: [number, number];
}

const WIDTH = 300;
const HEIGHT = 440;

// Germany centered on Fulda (~10.4°E, 51.2°N). Scale 1800 fits the real-border
// bbox (~5.87°–15.04°E, 47.27°–55.06°N) inside the 300×440 viewBox with
// ~6px horizontal and ~24px vertical padding.
const projection = d3Geo
  .geoMercator()
  .center([10.4, 51.2])
  .scale(1800)
  .translate([WIDTH / 2, HEIGHT / 2]);

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

type Ring = [number, number][];

// Signed shoelace area on lon/lat; positive = CW in lon/lat (i.e. CCW on the
// globe viewed from outside the sphere), which is what d3-geo expects for
// exterior rings. Rings with the opposite winding are interpreted as polygons
// covering the *complement* of the intended area — d3 then draws a huge
// sphere-wrapped path that bleeds fill across the entire viewBox.
function ringSignedArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    sum += (x2 - x1) * (y2 + y1);
  }
  return sum;
}

function normalizeRing(ring: Ring): Ring {
  return ringSignedArea(ring) < 0 ? [...ring].reverse() : ring;
}

function normalizeFeature(feature: Feature): Feature {
  const geom = feature.geometry;
  if (!geom) return feature;
  // Exterior ring is kept CW in lon/lat; interior (hole) rings flipped to CCW.
  if (geom.type === "Polygon") {
    const coords = geom.coordinates as Ring[];
    const exterior = normalizeRing(coords[0]);
    const holes = coords.slice(1).map((r) => (ringSignedArea(r) > 0 ? [...r].reverse() : r));
    return { ...feature, geometry: { ...geom, coordinates: [exterior, ...holes] } };
  }
  if (geom.type === "MultiPolygon") {
    const polys = geom.coordinates as Ring[][];
    const fixed = polys.map((poly) => {
      const exterior = normalizeRing(poly[0]);
      const holes = poly.slice(1).map((r) => (ringSignedArea(r) > 0 ? [...r].reverse() : r));
      return [exterior, ...holes];
    });
    return { ...feature, geometry: { ...geom, coordinates: fixed } };
  }
  return feature;
}

function labelCenter(feature: Feature, proj: D3GeoProjection): [number, number] {
  const fallback: [number, number] = [WIDTH / 2, HEIGHT / 2];
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

export function GermanyMapPaths({
  regionData,
  onRegionClick,
  highlightedRegions,
  regionHref,
  regionCodes,
}: GermanyMapPathsProps) {
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
  const [geo, setGeo] = useState<FeatureCollection<Geometry> | null>(null);

  useEffect(() => {
    fetchJson<FeatureCollection<Geometry>>(GEO_URL, { feature: "germany-map" })
      .then((data) => setGeo(data))
      .catch(() => {});
  }, []);

  const shapes = useMemo<LandShape[]>(() => {
    if (!geo?.features?.length) return [];
    const allow =
      regionCodes && regionCodes.length ? new Set(regionCodes.map((c) => c.toUpperCase())) : null;
    // 4 of the 16 Länder in de-laender.json ship with the exterior ring in
    // the wrong winding order (HH, BRE, BE, MV — the city-states and MV).
    // d3-geo reads those as polygons covering the *rest of the sphere*,
    // producing a huge secondary sub-path that bleeds color across the map.
    // Normalize to the expected winding before projection.
    const feats: { id: string; feature: Feature }[] = [];
    for (const raw of geo.features) {
      const id = getFeatureId(raw);
      if (!id || (allow && !allow.has(id))) continue;
      feats.push({ id, feature: normalizeFeature(raw) });
    }
    // Fit the projection to the rendered subset so West Germany fills the frame
    // (the flat inner-German border on the east). The full 16-Land map keeps its
    // fixed, hand-tuned projection so its appearance is unchanged.
    let proj = projection;
    if (allow) {
      const fc: FeatureCollection<Geometry> = {
        type: "FeatureCollection",
        features: feats.map((f) => f.feature),
      };
      const PAD = 12;
      proj = (
        d3Geo.geoMercator() as unknown as {
          fitExtent: (
            extent: [[number, number], [number, number]],
            object: unknown
          ) => D3GeoProjection;
        }
      ).fitExtent(
        [
          [PAD, PAD],
          [WIDTH - PAD, HEIGHT - PAD],
        ],
        fc
      );
    }
    const pathGen = d3Geo.geoPath(proj);
    const out: LandShape[] = [];
    for (const { id, feature } of feats) {
      const d = pathGen(feature);
      if (!d) continue;
      // Compute the label anchor from the feature's raw coordinate bbox in
      // lon/lat then project that center. d3-geo's geoCentroid and
      // path.centroid both break on the four city-state Länder (HH, BRE, BE,
      // MV) — their small polygons trip winding-order ambiguity and the
      // resulting "centroid" lands in the Pacific (~−170° lon), which then
      // projects off-screen. A projected bbox center is robust and lands
      // inside each Land, which is all the label needs.
      const centroid = labelCenter(feature, proj);
      out.push({ id, pathD: d, centroid });
    }
    return out;
  }, [geo, regionCodes]);

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

  // Flip tooltip above the cursor when hovering the lower half of the map so
  // the breakdown isn't clipped by the card's bottom edge.
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
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-full max-w-full max-h-full object-contain"
      >
        {shapes.map(({ id, pathD }) => {
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
                  setTooltipContent(data?.tooltip ?? [data?.label ?? id]);
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
        {shapes.map(({ id, centroid }) => {
          const data = regionData[id];
          if (!data) return null;
          const isHov = hovered === id;
          return (
            <text
              key={`label-${id}`}
              x={centroid[0]}
              y={centroid[1]}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={SMALL_LANDS.has(id) ? 7 : 10}
              fontWeight={700}
              fill={isHov ? "#ffffff" : "rgba(255,255,255,0.9)"}
              style={{ pointerEvents: "none", userSelect: "none" }}
            >
              {LAND_LABELS[id] ?? id}
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
