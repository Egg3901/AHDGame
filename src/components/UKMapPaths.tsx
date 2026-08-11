"use client";

import { useState } from "react";
import { geoCentroid } from "d3-geo";
import { ComposableMap, Geographies, Geography, Annotation } from "react-simple-maps";
import { RegionLink } from "@/components/mapRegionLink";

export interface RegionMapData {
  color: string;
  label?: string;
  tooltip?: string[];
}

interface UKMapPathsProps {
  regionData: Record<string, RegionMapData>;
  onRegionClick?: (regionId: string) => void;
  highlightedRegions?: Set<string> | string[];
  /** When supplied, regions with data render inside an SVG <a href>. */
  regionHref?: (regionId: string) => string | undefined;
}

/**
 * Pre-extracted UK NUTS1 GeoJSON (from Eurostat Nuts2json 2021 vintage).
 * Bundled locally to avoid external fetch failures and CORS issues.
 */
import { CDN_GEO } from "@/lib/images/cdnUrls";
const GEO_URL = CDN_GEO.ukNuts1;

/**
 * NUTS1 code → internal region ID used in UK_REGIONS (uk.ts).
 * Covers all 12 UK sub-regions (9 English + Scotland + Wales + NI).
 */
const NUTS_TO_REGION: Record<string, string> = {
  UKC: "NEE", // North East England
  UKD: "NWE", // North West England
  UKE: "YHU", // Yorkshire & the Humber
  UKF: "EMI", // East Midlands
  UKG: "WMI", // West Midlands
  UKH: "EAE", // East of England
  UKI: "LON", // London
  UKJ: "SEE", // South East England
  UKK: "SWE", // South West England
  UKL: "WAL", // Wales
  UKM: "SCO", // Scotland
  UKN: "NIR", // Northern Ireland
};

/** Short display labels for each region shown on the map. */
const REGION_LABELS: Record<string, string> = {
  NEE: "N. East",
  NWE: "N. West",
  YHU: "Yorks.",
  EMI: "E. Mids",
  WMI: "W. Mids",
  EAE: "E. Eng",
  LON: "London",
  SEE: "S. East",
  SWE: "S. West",
  WAL: "Wales",
  SCO: "Scotland",
  NIR: "N. Ireland",
};

export function UKMapPaths({
  regionData,
  onRegionClick,
  highlightedRegions,
  regionHref,
}: UKMapPathsProps) {
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

  const getRegionId = (geo: {
    id?: string | number;
    properties?: { id?: string };
  }): string | null => {
    const raw = geo.id ?? geo.properties?.id;
    const nutsCode = raw != null && raw !== "" ? String(raw).toUpperCase() : "";
    return NUTS_TO_REGION[nutsCode] ?? null;
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

  // Southern regions sit low in the SVG — flip tooltip above cursor so the
  // full per-party breakdown isn't clipped by the map container's bottom edge.
  const flipTooltip = tooltipPos ? tooltipPos.yRatio > 0.5 : false;

  return (
    <div className="relative w-full h-full min-w-0 flex items-center justify-center">
      <ComposableMap
        projection="geoMercator"
        projectionConfig={{
          center: [-2.5, 55],
          scale: 1400,
        }}
        width={280}
        height={400}
        className="w-full h-full max-w-full max-h-full object-contain"
        style={{ overflow: "hidden" }}
      >
        <Geographies geography={GEO_URL}>
          {({ geographies }) =>
            geographies.map((geo) => {
              const regionId = getRegionId(geo);
              if (!regionId) return null;

              const data = regionData[regionId];
              const isHov = hovered === regionId;
              const isHighlighted = highlightedSet.has(regionId);
              const hasData = !!data;

              let fill = "#1e293b";
              if (data) {
                fill = data.color;
              }

              let centroid: [number, number] = [0, 0];
              try {
                centroid = geoCentroid(geo);
              } catch {
                // fallback for degenerate geometry
              }

              const href = hasData ? regionHref?.(regionId) : undefined;

              return (
                <g key={geo.rsmKey}>
                  <RegionLink href={href} regionId={regionId} onActivate={onRegionClick}>
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
                        setHovered(regionId);
                        if (data) {
                          setTooltipContent([data.label ?? regionId, ...(data.tooltip ?? [])]);
                        }
                      }}
                      onMouseLeave={() => {
                        setHovered(null);
                        setTooltipContent([]);
                        setTooltipPos(null);
                      }}
                      onMouseMove={handleMouseMove}
                      // When an href exists the anchor owns activation; keeping this
                      // handler too would fire onRegionClick twice (directly and
                      // again via bubbling to the <a>).
                      onClick={href ? undefined : () => hasData && onRegionClick?.(regionId)}
                    />
                    {hasData && (
                      <Annotation subject={centroid} dx={0} dy={0}>
                        <text
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fontSize={regionId === "LON" ? 4 : 6}
                          fontWeight={700}
                          fill={isHov ? "#ffffff" : "rgba(255,255,255,0.9)"}
                          style={{ pointerEvents: "none", userSelect: "none" }}
                        >
                          {REGION_LABELS[regionId] ?? regionId}
                        </text>
                      </Annotation>
                    )}
                  </RegionLink>
                </g>
              );
            })
          }
        </Geographies>
      </ComposableMap>

      {/* Tooltip */}
      {hovered && tooltipPos && tooltipContent.length > 0 && (
        <div
          className="absolute pointer-events-none z-10 px-2 py-1.5 rounded text-xs bg-slate-900 border border-slate-600 shadow-lg max-w-[200px]"
          style={{
            left: tooltipPos.x + 12,
            top: tooltipPos.y + (flipTooltip ? -12 : -8),
            transform: flipTooltip ? "translateY(-100%)" : undefined,
          }}
        >
          <div className="font-semibold text-slate-100">{tooltipContent[0]}</div>
          {tooltipContent.slice(1).map((line, i) => (
            <div key={i} className="text-slate-400 mt-0.5">
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
