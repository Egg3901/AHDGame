"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ComposableMap,
  Geographies,
  Geography,
  Annotation,
  ZoomableGroup,
} from "react-simple-maps";
import { fetchJson } from "@/lib/observability/fetchJson";

export interface RegionCell {
  color: string;
  label?: string;
  tooltip?: string[];
}

/**
 * A region split into two halves (e.g. a US state's two Senate seats). Rendered
 * as a 45° two-colour gradient; the tooltip lists both halves. Opt-in via
 * `splitMode` — off by default so every other map renders a single colour.
 */
export interface RegionSplitCell {
  color1: string;
  color2: string;
  label1?: string;
  label2?: string;
  tooltip1?: string;
  tooltip2?: string;
}

interface RegionalGeoMapProps {
  /**
   * Combined region GeoJSON URL (features tagged `properties.regionCode`).
   * Optional when `features` is supplied (pre-merged multi-shard geometry).
   */
  sourceUrl?: string;
  /**
   * Pre-merged features (tagged `properties.regionCode`) to render instead of
   * fetching `sourceUrl` — for a country whose owned regions span MORE THAN ONE
   * shard (e.g. France after acquiring German Länder), via `useRegionGeometry`.
   */
  features?: GeoFeature[];
  /** The region codes to render — the live roster for this map. */
  regionCodes: string[];
  /** Per-region color/label/tooltip, keyed by region code. */
  regionData: Record<string, RegionCell>;
  onRegionClick?: (code: string) => void;
  highlightedRegions?: Set<string> | string[];
  /**
   * Compact on-map text per region code (e.g. BR's N/NE/CO/SE/S), used only for
   * the drawn `<text>` label; the tooltip still shows the full `regionData.label`.
   * Omit to show the full label on the map.
   */
  labelOverrides?: Record<string, string>;
  /**
   * Pixel nudges ([dx, dy], SVG user units) for labels whose area-weighted
   * centroid lands somewhere unreadable — e.g. a donut region (Spain's ES_CEN
   * wraps Madrid) whose centroid falls on the enclave it surrounds.
   */
  labelOffsets?: Record<string, [number, number]>;
  /**
   * SVG viewBox dimensions. Defaults to a portrait 280×400 (UK/DE/JP/BR). Pass a
   * landscape box for wide countries (e.g. CN 480×340, US 800×600) so the auto-fit
   * doesn't letterbox them; the container's `aspectRatio` should match.
   */
  width?: number;
  height?: number;
  /**
   * react-simple-maps projection name. Defaults to `"geoMercator"` with an
   * auto-computed fit. Pass e.g. `"geoAlbersUsa"` (which insets Alaska/Hawaii and
   * positions everything itself) together with `projectionConfig` to bypass the
   * Mercator fit.
   */
  projection?: string;
  /**
   * Explicit projection config. When given, it is used verbatim and the Mercator
   * auto-fit is skipped (required for non-Mercator projections like AlbersUsa).
   */
  projectionConfig?: Record<string, unknown>;
  /** Render two-colour region splits (e.g. US Senate). Default single colour. */
  splitMode?: boolean;
  /** Per-region split halves, keyed by region code. Only used when `splitMode`. */
  splitData?: Record<string, RegionSplitCell>;
  /** Enable pan/zoom (1×–4×). Default off (static map). */
  zoomable?: boolean;
}

/**
 * The text drawn on the map for a region: the compact override if one is given,
 * else the data label, else the bare code. Tooltips deliberately do NOT use this
 * — they keep the full `regionData.label`.
 */
export function regionLabelText(
  code: string,
  labelOverrides: Record<string, string> | undefined,
  dataLabel: string | undefined
): string {
  // Last-resort fallback strips a country prefix (HU_BUD → BUD) — the raw
  // composite id is storage detail, not display copy.
  return labelOverrides?.[code] ?? dataLabel ?? code.replace(/^[A-Z]{2,3}_/, "");
}

/**
 * The endpoints of a region's 45° split gradient (upper-left → lower-right) from
 * its bounding box, in SVG user space. Ported from the US Senate map so a split
 * region fills with two equal diagonal halves regardless of its shape.
 */
export function gradientEndpoints(bbox: { x: number; y: number; width: number; height: number }): {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
} {
  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;
  const d = (bbox.width + bbox.height) / 2;
  return { x1: cx - d, y1: cy + d, x2: cx + d, y2: cy - d };
}

const W = 280;
const H = 400;
const PAD = 12;
const D2R = Math.PI / 180;

// Minimal GeoJSON shapes (d3-geo is untyped in this repo; we don't need it —
// the Mercator fit is computed directly below).
export type GeoFeature = {
  geometry?: { type?: string; coordinates: unknown } | null;
  /** `na` is the region's own name, carried by every shard that has one. */
  properties?: { regionCode?: string; na?: string } | null;
  rsmKey?: string;
};
type GeoFC = { type: "FeatureCollection"; features: GeoFeature[] };

const mercY = (latDeg: number) => Math.log(Math.tan(Math.PI / 4 + (latDeg * D2R) / 2));

/** Walk nested coordinate arrays, calling `pt` on each [lon, lat] pair. */
function eachCoord(coords: unknown, pt: (lon: number, lat: number) => void): void {
  if (Array.isArray(coords) && typeof coords[0] === "number") {
    pt(coords[0] as number, coords[1] as number);
  } else if (Array.isArray(coords)) {
    for (const c of coords) eachCoord(c, pt);
  }
}

/**
 * Mercator `{center, scale}` for react-simple-maps (translate = [W/2, H/2]) that
 * fits `fc`'s lon/lat bounds into the (w×h) box with padding. Pure math, safe
 * default for an empty set (no NaN).
 */
export function computeFitProjection(
  fc: GeoFC,
  w: number = W,
  h: number = H
): { center: [number, number]; scale: number } {
  let minLon = Infinity,
    minLat = Infinity,
    maxLon = -Infinity,
    maxLat = -Infinity,
    any = false;
  for (const f of fc.features ?? []) {
    if (!f.geometry) continue;
    eachCoord(f.geometry.coordinates, (lon, lat) => {
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
      any = true;
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    });
  }
  if (!any) return { center: [-4, 54], scale: 1400 };
  const center: [number, number] = [(minLon + maxLon) / 2, (minLat + maxLat) / 2];
  const lonSpan = Math.max((maxLon - minLon) * D2R, 1e-6);
  const latSpan = Math.max(mercY(maxLat) - mercY(minLat), 1e-6);
  const scale = Math.min((w - 2 * PAD) / lonSpan, (h - 2 * PAD) / latSpan);
  return { center, scale: Number.isFinite(scale) && scale > 0 ? scale : 1400 };
}

/**
 * Drop rings d3-geo cannot stream.
 *
 * A GeoJSON linear ring needs at least 4 positions (closed, so first === last). A
 * shorter one — `cn-regions.json`'s HN part carries a ONE-POINT ring — makes d3's
 * `ringEnd` read `[0]` of a segment that never formed, throwing "Cannot read
 * properties of undefined" and taking the whole map down. Shards are externally
 * built artifacts, so guard here rather than trusting every one of them.
 *
 * Only invalid rings are removed; valid geometry is untouched, and a feature left
 * with no drawable ring is dropped entirely.
 */
export function dropDegenerateRings(f: GeoFeature): GeoFeature | null {
  const g = f.geometry;
  const ok = (r: unknown) => Array.isArray(r) && r.length >= 4;

  if (g?.type === "Polygon") {
    const rings = ((g.coordinates as unknown[]) ?? []).filter(ok);
    if (rings.length === 0) return null;
    return { ...f, geometry: { ...g, coordinates: rings } };
  }

  if (g?.type === "MultiPolygon") {
    const polys = ((g.coordinates as unknown[][]) ?? [])
      .map((p) => (Array.isArray(p) ? p.filter(ok) : []))
      .filter((p) => p.length > 0);
    if (polys.length === 0) return null;
    return { ...f, geometry: { ...g, coordinates: polys } };
  }

  return f;
}

type Ring = [number, number][];

/** Shoelace signed area of a single ring (positive for CCW winding). */
function ringArea(ring: Ring): number {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

/** Area-weighted centroid of a single ring's interior (the shoelace centroid formula). */
function ringCentroid(ring: Ring): [number, number] | null {
  const area = ringArea(ring);
  if (!Number.isFinite(area) || Math.abs(area) < 1e-12) return null;
  let cx = 0,
    cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    const cross = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  const factor = 1 / (6 * area);
  return [cx * factor, cy * factor];
}

/** Plain average of a ring's vertices — fallback when the ring's area is degenerate. */
function ringVertexMean(ring: Ring): [number, number] | null {
  if (!ring.length) return null;
  let sx = 0,
    sy = 0;
  for (const [x, y] of ring) {
    sx += x;
    sy += y;
  }
  return [sx / ring.length, sy / ring.length];
}

/** Every ring belonging to a Polygon (outer ring first) or MultiPolygon (per part). */
function extractRings(geometryType: string | undefined, coordinates: unknown): Ring[] {
  const rings: Ring[] = [];
  const toRing = (raw: unknown): Ring | null => {
    if (!Array.isArray(raw)) return null;
    const ring: Ring = [];
    for (const p of raw) {
      if (Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number") {
        ring.push([p[0], p[1]]);
      }
    }
    return ring.length >= 3 ? ring : null;
  };
  if (geometryType === "MultiPolygon" && Array.isArray(coordinates)) {
    for (const polygon of coordinates as unknown[]) {
      const outer = Array.isArray(polygon) ? toRing((polygon as unknown[])[0]) : null;
      if (outer) rings.push(outer);
    }
  } else if (geometryType === "Polygon" && Array.isArray(coordinates)) {
    const outer = toRing((coordinates as unknown[])[0]);
    if (outer) rings.push(outer);
  }
  return rings;
}

/**
 * Label placement point for a region's geometry: the area-weighted centroid of
 * its LARGEST ring (by area), not a flat mean of every vertex across every
 * ring. A plain vertex mean breaks badly for real US states — Michigan's two
 * peninsulas, Maryland/Virginia's Eastern Shore, Hawaii's islands, and other
 * multi-part or concave coastlines average out to a point in open water
 * between the parts instead of landing inside any of them. Falls back to the
 * old whole-geometry vertex mean when `geometry.type` is missing/unrecognized
 * (e.g. non-GeoJSON test fixtures) so nothing regresses to [0, 0].
 */
export function featureCentroid(geo: GeoFeature): [number, number] {
  const rings = geo.geometry ? extractRings(geo.geometry.type, geo.geometry.coordinates) : [];
  if (rings.length) {
    const largest = rings.reduce((a, b) => (Math.abs(ringArea(b)) > Math.abs(ringArea(a)) ? b : a));
    const centroid = ringCentroid(largest) ?? ringVertexMean(largest);
    if (centroid && centroid.every(Number.isFinite)) return centroid;
  }
  // Fallback: original flat vertex-mean behavior.
  let sx = 0,
    sy = 0,
    n = 0;
  if (geo.geometry)
    eachCoord(geo.geometry.coordinates, (lon, lat) => {
      sx += lon;
      sy += lat;
      n++;
    });
  return n ? [sx / n, sy / n] : [0, 0];
}

/**
 * Generic regional map: renders ONLY the regions in `regionCodes` from a
 * combined region-code-keyed GeoJSON, auto-fitting the projection to them. A
 * region appears here purely because its code is in the live roster — so a
 * transferred region follows its owner with no geometry change.
 *
 * Opt-in extensions (all default-off, so parliamentary maps are unaffected):
 * `projection`/`projectionConfig` (e.g. AlbersUsa), `splitMode`/`splitData`
 * (two-colour Senate splits), and `zoomable` (pan/zoom). Used by the US map.
 */
export function RegionalGeoMap({
  sourceUrl,
  features,
  regionCodes,
  regionData,
  onRegionClick,
  highlightedRegions,
  labelOverrides,
  labelOffsets,
  width = W,
  height = H,
  projection = "geoMercator",
  projectionConfig,
  splitMode = false,
  splitData,
  zoomable = false,
}: RegionalGeoMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [geojson, setGeojson] = useState<GeoFC | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [tooltipContent, setTooltipContent] = useState<string[]>([]);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number; yRatio: number } | null>(
    null
  );
  const [gradients, setGradients] = useState<
    Record<string, { x1: number; y1: number; x2: number; y2: number }>
  >({});

  useEffect(() => {
    // Pre-merged features supplied (multi-shard) or no URL → nothing to fetch.
    if (features || !sourceUrl) return;
    let alive = true;
    fetchJson<GeoFC>(sourceUrl, { feature: "regional-geo-map" })
      .then((d) => alive && setGeojson(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [sourceUrl, features]);

  const highlightedSet = Array.isArray(highlightedRegions)
    ? new Set(highlightedRegions)
    : (highlightedRegions ?? new Set<string>());

  // Memoize the rendered subset + fitted projection so react-simple-maps doesn't
  // re-parse geometry every render (the roster prop is rebuilt by the parent).
  const rosterKey = regionCodes.join(",");
  const sourceFeatures = features ?? geojson?.features;
  const shown = useMemo<GeoFC>(() => {
    const codeSet = new Set(regionCodes);
    return {
      type: "FeatureCollection",
      features:
        sourceFeatures
          ?.filter((f) => {
            const code = f.properties?.regionCode;
            return code != null && codeSet.has(code);
          })
          // Sanitised before d3 ever sees them — one bad ring otherwise throws
          // and takes the entire map down.
          .map(dropDegenerateRings)
          .filter((f): f is GeoFeature => f !== null) ?? [],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceFeatures, rosterKey]);
  const fit = useMemo(() => computeFitProjection(shown, width, height), [shown, width, height]);
  // Non-Mercator projections (AlbersUsa) position themselves — use the given
  // config verbatim; the Mercator path keeps the auto-fit.
  const projConfig = projectionConfig ?? fit;

  // Measure each rendered region's bbox so split gradients run a true 45° across
  // the actual shape (mirrors the US Senate map). Only runs in split mode.
  useLayoutEffect(() => {
    if (!splitMode || !containerRef.current) return;
    const gp: Record<string, { x1: number; y1: number; x2: number; y2: number }> = {};
    containerRef.current.querySelectorAll<SVGGElement>("[data-region-code]").forEach((g) => {
      const code = g.dataset.regionCode!;
      const path = g.querySelector("path");
      if (!path) return;
      try {
        const b = path.getBBox();
        if (b.width > 2 && b.height > 2) gp[code] = gradientEndpoints(b);
      } catch {
        // getBBox unavailable in some environments
      }
    });
    setGradients(gp);
  }, [splitMode, splitData, shown]);

  // AlbersUsa flies to odd coordinates on d3-zoom's dblclick; block it (zoom only).
  useEffect(() => {
    if (!zoomable || !containerRef.current) return;
    const el = containerRef.current;
    const stop = (e: MouseEvent) => e.stopPropagation();
    el.addEventListener("dblclick", stop, true);
    return () => el.removeEventListener("dblclick", stop, true);
  }, [zoomable]);

  const handleMouseMove = (e: React.MouseEvent) => {
    const svg = (e.currentTarget as SVGGElement).closest("svg");
    const rect = svg?.getBoundingClientRect();
    if (rect) {
      const y = e.clientY - rect.top;
      setTooltipPos({ x: e.clientX - rect.left, y, yRatio: rect.height > 0 ? y / rect.height : 0 });
    }
  };
  const flipTooltip = tooltipPos ? tooltipPos.yRatio > 0.5 : false;

  const geoLayers = (
    <Geographies geography={shown}>
      {({ geographies }: { geographies: GeoFeature[] }) => (
        <>
          {geographies.map((geo) => {
            const code = geo.properties?.regionCode;
            if (!code) return null;
            const data = regionData[code];
            const split = splitMode ? splitData?.[code] : undefined;
            const isHov = hovered === code;
            const isHighlighted = highlightedSet.has(code);
            const hasData = splitMode ? !!split : !!data;
            const fill =
              split && gradients[code]
                ? `url(#rgm-split-${code})`
                : split
                  ? split.color1
                  : data
                    ? data.color
                    : "#1e293b";
            return (
              <g key={geo.rsmKey} data-region-code={code}>
                <Geography
                  geography={geo}
                  fill={fill}
                  fillOpacity={isHov ? 0.95 : hasData ? 0.85 : 0.4}
                  stroke={isHov ? "#ffffff" : isHighlighted ? "#a855f7" : "#334155"}
                  strokeWidth={isHov ? 1.5 : isHighlighted ? 2.5 : 0.5}
                  style={{
                    outline: "none",
                    cursor: hasData ? "pointer" : "default",
                    transition: "fill-opacity 0.1s",
                  }}
                  onMouseEnter={() => {
                    setHovered(code);
                    if (split) {
                      setTooltipContent(
                        [
                          `Seat 1: ${split.label1 ?? ""}`,
                          split.tooltip1 ?? "",
                          `Seat 2: ${split.label2 ?? ""}`,
                          split.tooltip2 ?? "",
                        ].filter((l) => l && l !== "Seat 1: " && l !== "Seat 2: ")
                      );
                    } else if (data) {
                      setTooltipContent([
                        data.label ?? code.replace(/^[A-Z]{2,3}_/, ""),
                        ...(data.tooltip ?? []),
                      ]);
                    }
                  }}
                  onMouseLeave={() => {
                    setHovered(null);
                    setTooltipContent([]);
                    setTooltipPos(null);
                  }}
                  onMouseMove={handleMouseMove}
                  onClick={() => hasData && onRegionClick?.(code)}
                />
              </g>
            );
          })}
          {/* Labels in a second pass so a later region's fill never paints
              over an earlier region's label (e.g. NI over Donegal). */}
          {geographies.map((geo) => {
            const code = geo.properties?.regionCode;
            if (!code) return null;
            const data = regionData[code];
            const hasData = splitMode ? !!splitData?.[code] : !!data;
            if (!hasData) return null;
            const isHov = hovered === code;
            const [dx, dy] = labelOffsets?.[code] ?? [0, 0];
            return (
              <Annotation
                key={`label-${geo.rsmKey}`}
                subject={featureCentroid(geo)}
                dx={dx}
                dy={dy}
                connectorProps={{ stroke: "none" }}
              >
                <text
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={code === "LON" || code === "DC" ? 4 : 6}
                  fontWeight={700}
                  fill={isHov ? "#ffffff" : "rgba(255,255,255,0.9)"}
                  style={{ pointerEvents: "none", userSelect: "none" }}
                >
                  {regionLabelText(code, labelOverrides, data?.label)}
                </text>
              </Annotation>
            );
          })}
        </>
      )}
    </Geographies>
  );

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full min-w-0 items-center justify-center"
      style={zoomable ? { touchAction: "none", overscrollBehavior: "contain" } : undefined}
    >
      <ComposableMap
        projection={projection}
        projectionConfig={projConfig}
        width={width}
        height={height}
        className="h-full max-h-full w-full max-w-full object-contain"
        style={{ overflow: "hidden" }}
      >
        {/* Split gradients: a 45° two-colour fill per region (e.g. Senate seats). */}
        {splitMode && splitData && (
          <defs>
            {Object.entries(splitData).map(([code, split]) => {
              const g = gradients[code];
              return g ? (
                <linearGradient
                  key={code}
                  id={`rgm-split-${code}`}
                  x1={g.x1}
                  y1={g.y1}
                  x2={g.x2}
                  y2={g.y2}
                  gradientUnits="userSpaceOnUse"
                >
                  <stop offset="50%" stopColor={split.color1} />
                  <stop offset="50%" stopColor={split.color2} />
                </linearGradient>
              ) : (
                <linearGradient
                  key={code}
                  id={`rgm-split-${code}`}
                  x1="0%"
                  y1="100%"
                  x2="100%"
                  y2="0%"
                  gradientUnits="objectBoundingBox"
                >
                  <stop offset="50%" stopColor={split.color1} />
                  <stop offset="50%" stopColor={split.color2} />
                </linearGradient>
              );
            })}
          </defs>
        )}
        {zoomable ? (
          // Self-positioning projections (AlbersUsa, via projectionConfig) sit at
          // [0,0]; an auto-fit Mercator map must start centred on its own geometry,
          // else the ZoomableGroup pans it off to lon/lat 0.
          <ZoomableGroup
            center={projectionConfig ? [0, 0] : fit.center}
            zoom={1}
            minZoom={1}
            maxZoom={4}
          >
            {geoLayers}
          </ZoomableGroup>
        ) : (
          geoLayers
        )}
      </ComposableMap>

      {hovered && tooltipPos && tooltipContent.length > 0 && (
        <div
          className="pointer-events-none absolute z-10 max-w-[200px] rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs shadow-lg"
          style={{
            left: tooltipPos.x + 12,
            top: tooltipPos.y + (flipTooltip ? -12 : -8),
            transform: flipTooltip ? "translateY(-100%)" : undefined,
          }}
        >
          <div className="font-semibold text-slate-100">{tooltipContent[0]}</div>
          {tooltipContent.slice(1).map((line, i) => (
            <div key={i} className="mt-0.5 text-slate-400">
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
