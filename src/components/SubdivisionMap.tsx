"use client";

import { useState, useRef, useEffect } from "react";
import { formatLeanLabel } from "@/lib/utils/subdivisionResults";

const DEFAULT_PARTY_COLORS: Record<string, string> = {
  democrat: "#3B82F6",
  republican: "#EF4444",
  independent: "#9CA3AF",
};

const VACANT_FILL = "#4b5563";

// FIPS state codes → 2-letter state abbreviations (matches us-atlas states TopoJSON)
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

export interface SubdivisionDatum {
  id: string;
  name: string;
  path: string;
  /** Absent for seat-ordered (CD-style) data with no vote distribution. */
  votes?: Record<string, number>;
  margin: number;
  winner: string;
  /** When present, the tooltip shows a Lean line (US Cook-PVI style). */
  leanScalar?: number;
  /**
   * Seat-ordered (CD-style) data only: the winner's party key. When present,
   * the subdivision renders in that party's flat color (no margin shading)
   * and the tooltip shows winner/party/margin instead of a vote list.
   */
  party?: string;
}

interface SubdivisionMapProps {
  viewBox: string;
  subdivisions: SubdivisionDatum[];
  candidateNames: Record<string, string>;
  candidateParties: Record<string, string>;
  partyColors?: Record<string, string>;
  showBackgroundMap?: boolean;
  /** State abbreviation → EV color (e.g. "CA" → "#3B82F6"). Colors other states by EV result. */
  backgroundStateColors?: Record<string, string>;
  /** When true, uses the full national US viewBox (0 0 960 600) for context. */
  nationalView?: boolean;
  /** Fill the parent's height (CD-map layout) instead of natural aspect height. */
  fitToParent?: boolean;
}

interface StateOutline {
  id: string;
  stateAbbr: string;
  path: string;
}

const NATIONAL_VIEWBOX = "0 0 960 600";

/** Parse "x y w h" viewBox string and return padded version for zoom-to-state effect.
 *  Uses proportional padding (20% of each dimension) so small and large states scale consistently. */
function getPaddedViewBox(viewBox: string): string {
  const parts = viewBox.split(" ").map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return viewBox;
  const [x, y, w, h] = parts;
  const pw = w * 0.2;
  const ph = h * 0.2;
  return `${x - pw} ${y - ph} ${w + pw * 2} ${h + ph * 2}`;
}

/** Flat party color for seat-ordered (CD-style) data — legacy CD map look. */
function getFlatPartyColor(party: string, partyColors?: Record<string, string>): string {
  const partyLower = party.toLowerCase();
  return (
    partyColors?.[partyLower] ??
    DEFAULT_PARTY_COLORS[partyLower] ??
    DEFAULT_PARTY_COLORS.independent
  );
}

function getSubdivisionColor(
  winner: string,
  margin: number,
  candidateParties: Record<string, string>,
  partyColors?: Record<string, string>
): string {
  if (!winner) return VACANT_FILL;
  const party = (candidateParties[winner] ?? "independent").toLowerCase();
  const base =
    partyColors?.[party] ?? DEFAULT_PARTY_COLORS[party] ?? DEFAULT_PARTY_COLORS.independent;

  const r = parseInt(base.slice(1, 3), 16);
  const g = parseInt(base.slice(3, 5), 16);
  const b = parseInt(base.slice(5, 7), 16);

  if (margin >= 20)
    return `rgb(${Math.floor(r * 0.7)}, ${Math.floor(g * 0.7)}, ${Math.floor(b * 0.7)})`;
  if (margin >= 10) return base;
  if (margin >= 5)
    return `rgb(${Math.floor(r + (255 - r) * 0.4)}, ${Math.floor(g + (255 - g) * 0.4)}, ${Math.floor(b + (255 - b) * 0.4)})`;
  return `rgb(${Math.floor(r + (255 - r) * 0.7)}, ${Math.floor(g + (255 - g) * 0.7)}, ${Math.floor(b + (255 - b) * 0.7)})`;
}

export function SubdivisionMap({
  viewBox,
  subdivisions,
  candidateNames,
  candidateParties,
  partyColors,
  showBackgroundMap = false,
  backgroundStateColors,
  nationalView = false,
  fitToParent = false,
}: SubdivisionMapProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const [backgroundStates, setBackgroundStates] = useState<StateOutline[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  const hoveredSub = subdivisions.find((s) => s.id === hovered);
  // nationalView = full US (tiny state); showBackgroundMap without nationalView = zoom to state with surrounding context
  const svgViewBox = nationalView
    ? NATIONAL_VIEWBOX
    : showBackgroundMap
      ? getPaddedViewBox(viewBox)
      : viewBox;

  useEffect(() => {
    if (!showBackgroundMap) return;

    async function loadBackgroundMap() {
      try {
        const response = await fetch("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json");
        const topoData = await response.json();

        // Convert TopoJSON to GeoJSON and extract paths
        const topojson = await import("topojson-client");
        // @ts-expect-error - d3-geo v3 type definitions issue
        const { geoPath, geoAlbersUsa } = await import("d3-geo");

        const projection = geoAlbersUsa();
        const pathGenerator = geoPath(projection);

        const features = topojson.feature(
          topoData,
          topoData.objects.states as Parameters<typeof topojson.feature>[1]
        );
        const statePaths: StateOutline[] = [];

        for (const feature of (features as { features: { id: string | number; path?: string }[] })
          .features) {
          const pathStr = pathGenerator(feature);
          if (pathStr) {
            const fips = String(feature.id ?? "").padStart(2, "0");
            const stateAbbr = FIPS_TO_STATE[fips] ?? "";
            statePaths.push({
              id: String(feature.id),
              stateAbbr,
              path: pathStr,
            });
          }
        }

        setBackgroundStates(statePaths);
      } catch (error) {
        console.error("Failed to load background map:", error);
      }
    }

    loadBackgroundMap();
  }, [showBackgroundMap]);

  return (
    <div
      ref={containerRef}
      className={fitToParent ? "relative h-full min-h-0 w-full" : "relative w-full h-full"}
    >
      <svg viewBox={svgViewBox} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
        {/* Background US map — colored by EV result when available, grey otherwise */}
        {showBackgroundMap &&
          backgroundStates.map((state) => {
            const evColor = backgroundStateColors?.[state.stateAbbr];
            return (
              <path
                key={state.id}
                d={state.path}
                fill={evColor ?? "#4a5568"}
                fillOpacity={evColor ? 0.65 : 0.15}
                stroke="#64748b"
                strokeWidth={evColor ? 0.8 : 0.5}
                strokeOpacity={evColor ? 0.5 : 0.3}
                pointerEvents="none"
              />
            );
          })}

        {/* Foreground subdivisions (full color) */}
        {subdivisions.map((sub) => {
          const isHov = hovered === sub.id;
          // party present = seat-ordered (CD-style) datum: flat party color,
          // legacy CD stroke/opacity; otherwise margin-shaded winner color.
          const isFlat = sub.party !== undefined;
          const fill = isFlat
            ? getFlatPartyColor(sub.party!, partyColors)
            : getSubdivisionColor(sub.winner, sub.margin, candidateParties, partyColors);
          return (
            <path
              key={sub.id}
              d={sub.path}
              fill={fill}
              fillOpacity={isHov ? 1 : isFlat ? 0.85 : 0.92}
              stroke={isHov ? "#ffffff" : isFlat ? "#1e293b" : "#0f172a"}
              strokeWidth={isHov ? 1.5 : isFlat ? 0.3 : 0.4}
              style={{ cursor: "pointer", transition: "fill-opacity 0.1s" }}
              onMouseEnter={() => setHovered(sub.id)}
              onMouseLeave={() => {
                setHovered(null);
                setTooltipPos(null);
              }}
              onMouseMove={(e) => {
                const rect = containerRef.current?.getBoundingClientRect();
                if (rect) setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
              }}
            />
          );
        })}
      </svg>

      {hoveredSub && tooltipPos && (
        <div
          className="absolute pointer-events-none z-10 px-2 py-1.5 rounded text-xs bg-slate-900 border border-slate-600 shadow-lg max-w-[220px]"
          style={{ left: tooltipPos.x + 12, top: tooltipPos.y - 8 }}
        >
          <div className="font-semibold text-slate-100">{hoveredSub.name}</div>
          {typeof hoveredSub.leanScalar === "number" && (
            <div className="text-slate-400 text-[10px]">
              Lean: {formatLeanLabel(hoveredSub.leanScalar).label}
            </div>
          )}
          {!hoveredSub.winner && <div className="text-slate-400 text-[10px]">Vacant</div>}
          {hoveredSub.party !== undefined && hoveredSub.winner && (
            <div className="mt-1 space-y-0.5">
              <div className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-2 rounded-sm shrink-0"
                  style={{ backgroundColor: getFlatPartyColor(hoveredSub.party, partyColors) }}
                />
                <span className="text-slate-300">
                  {candidateNames[hoveredSub.winner] ?? "Unknown"}
                </span>
                <span className="text-slate-500 ml-auto capitalize">{hoveredSub.party}</span>
              </div>
              <div className="text-slate-400 text-[10px]">
                Margin: {hoveredSub.margin.toFixed(1)}%
              </div>
            </div>
          )}
          {hoveredSub.votes && (
            <div className="mt-1 space-y-0.5">
              {Object.entries(hoveredSub.votes)
                .sort(([, a], [, b]) => b - a)
                .map(([cid, votes]) => {
                  const total = Object.values(hoveredSub.votes!).reduce((s, v) => s + v, 0);
                  const pct = total > 0 ? ((votes / total) * 100).toFixed(1) : "0";
                  const party = (candidateParties[cid] ?? "").toLowerCase();
                  const color = partyColors?.[party] ?? DEFAULT_PARTY_COLORS[party] ?? "#9CA3AF";
                  return (
                    <div key={cid} className="flex items-center gap-1.5">
                      <span
                        className="inline-block h-2 w-2 rounded-sm shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <span className="text-slate-300">{candidateNames[cid] ?? "Unknown"}</span>
                      <span className="text-slate-500 ml-auto">{pct}%</span>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
