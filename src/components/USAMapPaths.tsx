"use client";

import { useState, useRef, useLayoutEffect, useEffect } from "react";
import { geoCentroid } from "d3-geo";
import { ComposableMap, Geographies, Geography, ZoomableGroup } from "react-simple-maps";
import { RegionLink } from "@/components/mapRegionLink";
export interface StateMapData {
  color: string;
  label?: string;
  tooltip?: string[];
  /** Optional structured tooltip content. When set, replaces the default
   *  string-array rendering for that state. Used by `BattlegroundMap` to
   *  render per-candidate hover cards (Phase 7a Item 1). */
  tooltipNode?: React.ReactNode;
  phase?: "actual" | "projected";
}

export interface SenateSplitData {
  seat1Color: string;
  seat2Color: string;
  seat1Label: string;
  seat2Label: string;
  seat1Tooltip?: string;
  seat2Tooltip?: string;
}

interface USAMapPathsProps {
  stateData: Record<string, StateMapData>;
  senateSplitData?: Record<string, SenateSplitData>;
  senateSplitMode?: boolean;
  /** State IDs to highlight with a purple border (e.g. competitive states) */
  highlightedStates?: Set<string> | string[];
  onStateClick?: (stateId: string) => void;
  /** When supplied, regions with data render inside an SVG <a href>. */
  regionHref?: (stateId: string) => string | undefined;
  viewBox?: string;
}

/** Same TopoJSON as `us-atlas` states-10m — served from `/public` so maps work when CDNs fail or are blocked. */
import { CDN_GEO } from "@/lib/images/cdnUrls";
const GEO_URL = CDN_GEO.usStates;

// FIPS state codes (us-atlas) → 2-letter state abbreviations
const FIPS_TO_STATE: Record<string, string> = {
  "01": "AL",
  "02": "AK",
  "04": "AZ",
  "05": "AR",
  "06": "CA",
  "08": "CO",
  "09": "CT",
  "10": "DE",
  "11": "DC",
  "12": "FL",
  "13": "GA",
  "15": "HI",
  "16": "ID",
  "17": "IL",
  "18": "IN",
  "19": "IA",
  "20": "KS",
  "21": "KY",
  "22": "LA",
  "23": "ME",
  "24": "MD",
  "25": "MA",
  "26": "MI",
  "27": "MN",
  "28": "MS",
  "29": "MO",
  "30": "MT",
  "31": "NE",
  "32": "NV",
  "33": "NH",
  "34": "NJ",
  "35": "NM",
  "36": "NY",
  "37": "NC",
  "38": "ND",
  "39": "OH",
  "40": "OK",
  "41": "OR",
  "42": "PA",
  "44": "RI",
  "45": "SC",
  "46": "SD",
  "47": "TN",
  "48": "TX",
  "49": "UT",
  "50": "VT",
  "51": "VA",
  "53": "WA",
  "54": "WV",
  "55": "WI",
  "56": "WY",
};

interface GradientParams {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function USAMapPaths({
  stateData,
  senateSplitData,
  senateSplitMode = false,
  highlightedStates,
  onStateClick,
  regionHref,
}: USAMapPathsProps) {
  const highlightedSet = Array.isArray(highlightedStates)
    ? new Set(highlightedStates)
    : (highlightedStates ?? new Set<string>());
  const [hovered, setHovered] = useState<string | null>(null);
  const [tooltipContent, setTooltipContent] = useState<string[]>([]);
  const [tooltipNode, setTooltipNode] = useState<React.ReactNode | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{
    x: number;
    y: number;
    yRatio: number;
  } | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);

  // Block d3-zoom's double-click/double-tap zoom-to-point, which flies the map to
  // unexpected coordinates with the AlbersUSA projection.  A native capture-phase
  // listener fires before d3's bubbling listener and stops the dblclick event.
  useEffect(() => {
    const el = mapRef.current;
    if (!el) return;
    const stopDblClick = (e: MouseEvent) => e.stopPropagation();
    el.addEventListener("dblclick", stopDblClick, true);
    return () => el.removeEventListener("dblclick", stopDblClick, true);
  }, []);

  // Measure each state path's bbox for uniform 45° gradient (upper-left → lower-right)
  const [gradientParams, setGradientParams] = useState<Record<string, GradientParams>>({});

  useLayoutEffect(() => {
    if (!senateSplitMode || !mapRef.current) return;
    const svg = mapRef.current.querySelector("svg");
    if (!svg) return;
    const gp: Record<string, GradientParams> = {};
    mapRef.current.querySelectorAll<SVGGElement>("[data-state-id]").forEach((g) => {
      const stateId = g.dataset.stateId!;
      const path = g.querySelector("path");
      if (!path) return;
      try {
        const b = path.getBBox();
        if (b.width > 5 && b.height > 5) {
          const cx = b.x + b.width / 2;
          const cy = b.y + b.height / 2;
          const D = (b.width + b.height) / 2;
          // 45° diagonal: upper-left (cx-D, cy+D) → lower-right (cx+D, cy-D)
          gp[stateId] = { x1: cx - D, y1: cy + D, x2: cx + D, y2: cy - D };
        }
      } catch {
        // getBBox unavailable in some environments
      }
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync from DOM measurement
    setGradientParams(gp);
  }, [senateSplitMode, senateSplitData]);

  const getStateId = (geo: { id?: string | number }) => {
    const fips = String(geo.id ?? "").padStart(2, "0");
    return FIPS_TO_STATE[fips] ?? null;
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const svg = (e.currentTarget as SVGGElement).closest("svg");
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

  const hasGradientBBoxes = Object.keys(gradientParams).length > 0;

  return (
    <div
      ref={mapRef}
      className="relative w-full h-full min-w-0"
      style={{ touchAction: "none", overscrollBehavior: "contain" }}
    >
      <ComposableMap
        projection="geoAlbersUsa"
        projectionConfig={{ scale: 1000 }}
        className="w-full h-full"
        style={{ overflow: "hidden" }}
      >
        <ZoomableGroup center={[0, 0]} zoom={1} minZoom={1} maxZoom={4}>
          {/* Senate split gradients - uniform 45° when bbox available */}
          {senateSplitMode && (
            <defs>
              {Object.entries(senateSplitData ?? {}).map(([stateId, split]) => {
                const gp = gradientParams[stateId];
                return gp && hasGradientBBoxes ? (
                  <linearGradient
                    key={stateId}
                    id={`grad-senate-${stateId}`}
                    x1={gp.x1}
                    y1={gp.y1}
                    x2={gp.x2}
                    y2={gp.y2}
                    gradientUnits="userSpaceOnUse"
                  >
                    <stop offset="50%" stopColor={split.seat1Color} />
                    <stop offset="50%" stopColor={split.seat2Color} />
                  </linearGradient>
                ) : (
                  <linearGradient
                    key={stateId}
                    id={`grad-senate-${stateId}`}
                    x1="0%"
                    y1="100%"
                    x2="100%"
                    y2="0%"
                    gradientUnits="objectBoundingBox"
                  >
                    <stop offset="50%" stopColor={split.seat1Color} />
                    <stop offset="50%" stopColor={split.seat2Color} />
                  </linearGradient>
                );
              })}
            </defs>
          )}
          <Geographies geography={GEO_URL}>
            {({ geographies, projection }) =>
              geographies.map((geo) => {
                const stateId = getStateId(geo);
                if (!stateId) return null;

                const isHov = hovered === stateId;
                const isHighlighted = highlightedSet.has(stateId);
                const data = stateData[stateId];
                const split = senateSplitData?.[stateId];
                const hasData = senateSplitMode ? !!split : !!data;

                let fill = "#1e293b";
                if (senateSplitMode && split) {
                  fill = `url(#grad-senate-${stateId})`;
                } else if (data) {
                  fill = data.color;
                }

                let labelPos: [number, number] = [0, 0];
                try {
                  const centroid = geoCentroid(geo);
                  const projected = projection(centroid);
                  if (projected) labelPos = projected;
                } catch {
                  // fallback for DC or degenerate geometry
                }

                const href = hasData ? regionHref?.(stateId) : undefined;

                return (
                  <g
                    key={geo.rsmKey}
                    data-state-id={stateId}
                    onTouchStart={() => hasData && setHovered(stateId)}
                    onTouchEnd={() => setHovered(null)}
                  >
                    <RegionLink href={href} regionId={stateId} onActivate={onStateClick}>
                      <Geography
                        geography={geo}
                        fill={fill}
                        fillOpacity={
                          isHov
                            ? 0.95
                            : data?.phase === "actual"
                              ? 0.92
                              : data?.phase === "projected"
                                ? 0.5
                                : hasData
                                  ? 0.85
                                  : 0.4
                        }
                        stroke={isHov ? "#ffffff" : isHighlighted ? "#a855f7" : "#334155"}
                        strokeWidth={isHov ? 1.5 : isHighlighted ? 6 : 0.5}
                        style={{
                          outline: "none",
                          cursor: hasData ? "pointer" : "default",
                          transition: "fill-opacity 0.1s",
                        }}
                        onMouseEnter={() => {
                          setHovered(stateId);
                          if (senateSplitMode && split) {
                            setTooltipContent(
                              [
                                `Seat 1: ${split.seat1Label}`,
                                split.seat1Tooltip ?? "",
                                `Seat 2: ${split.seat2Label}`,
                                split.seat2Tooltip ?? "",
                              ].filter(Boolean)
                            );
                            setTooltipNode(null);
                          } else if (data) {
                            setTooltipContent([data.label ?? stateId, ...(data.tooltip ?? [])]);
                            setTooltipNode(data.tooltipNode ?? null);
                          }
                        }}
                        onMouseLeave={() => {
                          setHovered(null);
                          setTooltipContent([]);
                          setTooltipNode(null);
                          setTooltipPos(null);
                        }}
                        onMouseMove={handleMouseMove}
                        // When an href exists the anchor owns activation; keeping
                        // this handler too would fire onStateClick twice (directly
                        // and again via bubbling to the <a>).
                        onClick={href ? undefined : () => hasData && onStateClick?.(stateId)}
                      />
                      {hasData && (
                        <text
                          x={labelPos[0]}
                          y={labelPos[1]}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fontSize={stateId === "DC" ? 4 : 7}
                          fontWeight={700}
                          fill={isHov ? "#ffffff" : "rgba(255,255,255,0.9)"}
                          style={{ pointerEvents: "none", userSelect: "none" }}
                        >
                          {stateId}
                        </text>
                      )}
                    </RegionLink>
                  </g>
                );
              })
            }
          </Geographies>
        </ZoomableGroup>
      </ComposableMap>

      {/* Tooltip */}
      {hovered && tooltipPos && (tooltipContent.length > 0 || tooltipNode) && (
        <div
          className="absolute pointer-events-none z-10 px-2 py-1.5 rounded text-xs bg-slate-900 border border-slate-600 shadow-lg max-w-[260px]"
          style={{
            left: tooltipPos.x + 12,
            top: tooltipPos.y + (flipTooltip ? -12 : -8),
            transform: flipTooltip ? "translateY(-100%)" : undefined,
          }}
        >
          {tooltipNode ?? (
            <>
              <div className="font-semibold text-slate-100">{tooltipContent[0]}</div>
              {tooltipContent.slice(1).map((line, i) => (
                <div key={i} className="text-slate-400 mt-0.5">
                  {line}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
