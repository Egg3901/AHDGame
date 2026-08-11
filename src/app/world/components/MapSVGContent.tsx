"use client";

import React from "react";
import {
  SVG_W as DEFAULT_SVG_W,
  SVG_H as DEFAULT_SVG_H,
  TRANSLATE as DEFAULT_TRANSLATE,
  ORTHO_SCALE as DEFAULT_ORTHO_SCALE,
  MAP_COLORS,
} from "../worldConstants";
import { resolveCountryAvailability } from "@/lib/countryAvailability";
import { WORLD_COUNTRY_ISO_TO_ID, WORLD_MAPPED_COUNTRIES } from "@/lib/worldCountryRegistry";
import type { CountryAccessMap } from "../page";
import type { CountryId } from "@/lib/constants/countries";
import type { ArcSpec, HotspotSpec, StarSpec } from "@/components/landing/globeEnhancements";
import type { WorldEntityMapSnapshot } from "@/lib/world/worldEntityMap";
import {
  isTierInteractive,
  tierWireframeFill,
  TIER_COLORS,
  TIER_STROKES,
  TIER_STROKE_WIDTHS,
  type CountryTier,
} from "@/components/landing/countryTiers";
import { BLOC_COLORS, BLOC_STROKES, type WorldBloc } from "../worldBlocs";

/**
 * pathRefsMap key for the single merged Background Nations layer. The landing
 * globe writes one concatenated `d` here per frame instead of touching ~150
 * individual background paths.
 */
export const BACKGROUND_LAYER_KEY = "__tier_background__";

/** The status color a country's blob uses — so a British-Isles overlay blob
 *  matches whoever owns it (active green, etc.). */
function countryIdentityColor(countryId: CountryId, countryAccess?: CountryAccessMap): string {
  const access = countryAccess?.[countryId];
  if (!access) return MAP_COLORS.default;
  // Econ-only outranks the raw status (mirrors WorldMapSVG's filter path): a
  // registered country that is browsable but not playable renders light blue,
  // not "planned" red. Intentionally NOT gated on `status` — a "beta" country
  // can sit in the econ-only tier too.
  if (!access.enabledForPlayers) return MAP_COLORS.econOnly;
  const status = access.status === "coming-soon" ? "planned" : access.status;
  return (MAP_COLORS as Record<string, string>)[status] ?? MAP_COLORS.default;
}

/**
 * The hover/highlight UNIT for a feature id: its owning country, so a nation's
 * base polygon and any region-overlay `bi:` blob(s) highlight together and share
 * one tooltip. Falls back to the id itself for unmapped features (each highlights
 * only itself, never grouping all unmapped countries).
 */
function featureOwnerKey(id: string): string {
  // Region-overlay feature id is `bi:<owner>:<regionCode>` (or legacy `bi:<owner>`).
  if (id.startsWith("bi:")) return id.slice(3).split(":")[0];
  return WORLD_COUNTRY_ISO_TO_ID[id] ?? id;
}

function featureCountryId(feature: {
  id?: unknown;
  properties?: { ownerCountryId?: CountryId };
}): CountryId | undefined {
  const id = feature.id != null ? String(feature.id) : "";
  if (id.startsWith("bi:")) return feature.properties?.ownerCountryId;
  return WORLD_COUNTRY_ISO_TO_ID[id];
}

export type GlobeLayout = {
  svgW: number;
  svgH: number;
  translate: [number, number];
  orthoScale: number;
};

interface MapSVGContentProps {
  /** Override dimensions (e.g. landing page mini globe). Defaults to world map constants. */
  layout?: GlobeLayout;
  svgRef: React.RefObject<SVGSVGElement | null>;
  sphereRef: React.RefObject<SVGCircleElement | null>;
  graticuleRef: React.RefObject<SVGPathElement | null>;
  warBorderPathRef?: React.RefObject<SVGPathElement | null>;
  pathRefsMap: React.MutableRefObject<Map<string, SVGPathElement>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  features: any[];
  warBorderInitialD?: string;
  paths: Map<string, string | null>;
  hovered: string | null;
  isAnimating: boolean;
  /** Whether any metric/party filter is active (not "none") */
  hasActiveFilter: boolean;
  isFullscreen: boolean;
  getCountryColor: (id: string, defaultColor: string) => string;
  isAnimatingRef: React.MutableRefObject<boolean>;
  viewModeRef: React.MutableRefObject<"map" | "globe">;
  hoveredRef: React.MutableRefObject<string | null>;
  syncPathsState: () => void;
  onHover: (id: string | null) => void;
  onTooltipClear: () => void;
  onCountryClick: (id: string) => void;
  /** DB-driven country access state. When provided, overrides configured world-map status for coloring. */
  countryAccess?: CountryAccessMap;
  /** Preset-scoped country-tier classification for the base Natural Earth features. */
  worldEntities?: WorldEntityMapSnapshot;
  /** Countries fully drawn by a British-Isles bi: blob — their base feature is
   *  skipped so internal borders don't bleed through the merged overlay. */
  biCoveredCountries?: Set<string>;
  /** Enhanced landing-globe overlay. When true (and overlay data props are
   *  provided), renders halo + starfield + arcs + hotspots using token colors.
   *  Defaults OFF so /world and broadsheet callers render identically. */
  enhanced?: boolean;
  arcs?: ArcSpec[];
  arcRefs?: React.MutableRefObject<Map<string, SVGPathElement>>;
  hotspots?: HotspotSpec[];
  hotspotRefs?: React.MutableRefObject<Map<string, SVGGElement>>;
  starfield?: StarSpec[];
  haloRef?: React.RefObject<SVGCircleElement | null>;
  /** CRT phosphor wireframe color. When set, overrides fills/strokes with a dark-bg + bright-line aesthetic. */
  wireframeColor?: string;
  /** Landing-only country identities that receive the playable cross-hatch overlay. */
  playableCountryIds?: ReadonlySet<string>;
  /** Landing-only refs for the hatch paths, updated beside the base paths each frame. */
  playablePathRefs?: React.MutableRefObject<Map<string, SVGPathElement>>;
  /** Country currently spotlighted by the historical-crisis showcase — rendered
   *  with the alert cross-hatch instead of the routine single-direction one. */
  crisisCountryId?: string;
  /**
   * Landing-only four-tier coloring (see components/landing/countryTiers.ts).
   * Precomputed once per era by the caller: feature id → tier, missing means
   * Background. When set it REPLACES the ad-hoc access/status color branches —
   * exactly four fills are drawn and nothing else — and Background Nations are
   * collapsed into one inert, handler-free layer.
   */
  tierLookup?: ReadonlyMap<string, CountryTier>;
  /**
   * East / West / Non-Aligned overlay for the tier-mode globe. Only meaningful
   * alongside `tierLookup`: it recolors the interactive tiers and leaves the
   * merged Background layer alone. Absent means plain tier coloring.
   */
  blocLookup?: ReadonlyMap<string, WorldBloc>;
}

export default function MapSVGContent({
  layout,
  svgRef,
  sphereRef,
  graticuleRef,
  warBorderPathRef,
  pathRefsMap,
  features,
  warBorderInitialD,
  paths,
  hovered,
  isAnimating,
  hasActiveFilter,
  isFullscreen,
  getCountryColor,
  isAnimatingRef,
  viewModeRef,
  hoveredRef,
  syncPathsState,
  onHover,
  onTooltipClear,
  onCountryClick,
  countryAccess,
  worldEntities,
  biCoveredCountries,
  enhanced,
  arcs,
  arcRefs,
  hotspots,
  hotspotRefs,
  starfield,
  haloRef,
  wireframeColor,
  playableCountryIds,
  playablePathRefs,
  crisisCountryId,
  tierLookup,
  blocLookup,
}: MapSVGContentProps) {
  const svgW = layout?.svgW ?? DEFAULT_SVG_W;
  const svgH = layout?.svgH ?? DEFAULT_SVG_H;
  const translate = layout?.translate ?? DEFAULT_TRANSLATE;
  const orthoScale = layout?.orthoScale ?? DEFAULT_ORTHO_SCALE;
  // Highlight by owning country, not by individual feature — so a nation drawn as
  // a base polygon PLUS overlay blobs (e.g. the USSR: Russia + its acquired Länder)
  // lights up as one when any of its pieces is hovered.
  const hoveredOwnerKey = hovered ? featureOwnerKey(hovered) : null;

  // Background Nations are static flavour, so they are drawn as ONE path whose
  // `d` is every background country's subpath concatenated. That drops ~150
  // interactive DOM nodes (and their handlers, hover state and per-frame
  // attribute writes) down to a single inert node.
  const backgroundLayerD = React.useMemo(() => {
    if (!tierLookup) return "";
    let merged = "";
    for (let idx = 0; idx < features.length; idx++) {
      const feature = features[idx];
      const id = feature.id != null ? String(feature.id) : `_geo_${idx}`;
      if (isTierInteractive(tierLookup.get(id) ?? "background")) continue;
      // A Background Nation that belongs to a BLOC is drawn on its own below.
      // Eight of NATO's fourteen members are background entities — Canada, the
      // Benelux, Norway, Denmark, Portugal, Iceland — as is Albania in the
      // Warsaw Pact. Merging them into the inert grey layer made bloc mode draw
      // an alliance at two-thirds of its real size, with no way to tell.
      if (blocLookup?.get(id)) continue;
      const segment = paths.get(id);
      if (segment) merged += segment;
    }
    return merged;
  }, [features, paths, tierLookup, blocLookup]);

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${svgW} ${svgH}`}
      className={isFullscreen ? "w-full h-full block" : "w-full block"}
      preserveAspectRatio={isFullscreen ? "xMidYMid meet" : undefined}
      style={{ pointerEvents: isAnimating ? "none" : "auto", display: "block" }}
    >
      <defs>
        <radialGradient id="globe-atmosphere" cx="40%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#4a9fd4" stopOpacity="1" />
          <stop offset="60%" stopColor="#1a6fa8" stopOpacity="1" />
          <stop offset="100%" stopColor="#0d4a78" stopOpacity="1" />
        </radialGradient>
        <style>{`@keyframes marchingAnts { to { stroke-dashoffset: -14; } }`}</style>
        {enhanced && (
          <radialGradient id="globe-ocean-enhanced" cx="38%" cy="32%" r="68%">
            <stop offset="0%" stopColor="#a8d8ea" stopOpacity="0.85" />
            <stop offset="18%" stopColor="#3d9bd4" stopOpacity="1" />
            <stop offset="45%" stopColor="#1a6b9f" stopOpacity="1" />
            <stop offset="72%" stopColor="#0d4876" stopOpacity="1" />
            <stop offset="100%" stopColor="#071d3a" stopOpacity="1" />
          </radialGradient>
        )}
        {enhanced && (
          <radialGradient id="globe-halo-enhanced" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#4fc3f7" stopOpacity="0.30" />
            <stop offset="60%" stopColor="#0288d1" stopOpacity="0.10" />
            <stop offset="100%" stopColor="#0288d1" stopOpacity="0" />
          </radialGradient>
        )}
        {playableCountryIds && (
          <pattern
            id="landing-playable-hatch"
            width={7}
            height={7}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line
              x1={0}
              y1={0}
              x2={0}
              y2={7}
              stroke={wireframeColor ?? "var(--success)"}
              strokeWidth={0.7}
              opacity={0.42}
            />
          </pattern>
        )}
        {crisisCountryId && (
          <pattern
            id="landing-crisis-hatch"
            width={7}
            height={7}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1={0} y1={0} x2={0} y2={7} stroke="var(--warning)" strokeWidth={0.9} />
            <line x1={0} y1={0} x2={7} y2={0} stroke="var(--warning)" strokeWidth={0.9} />
          </pattern>
        )}
      </defs>

      {enhanced && (
        <>
          <circle
            ref={haloRef}
            cx={translate[0]}
            cy={translate[1]}
            r={orthoScale + 22}
            fill="url(#globe-halo-enhanced)"
            style={{ pointerEvents: "none", opacity: wireframeColor ? 0 : 1 }}
          />
          {(starfield ?? []).map((s) => (
            <circle
              key={s.id}
              cx={s.cx}
              cy={s.cy}
              r={s.r}
              fill={wireframeColor ?? "var(--foreground)"}
              opacity={s.opacity}
              className="ahd-star-twinkle"
              style={{ pointerEvents: "none", animationDelay: `${s.twinkleDelay}s` }}
            />
          ))}
        </>
      )}

      <circle
        ref={sphereRef}
        cx={translate[0]}
        cy={translate[1]}
        r={orthoScale}
        fill={
          wireframeColor
            ? "#000800"
            : enhanced
              ? "url(#globe-ocean-enhanced)"
              : "url(#globe-atmosphere)"
        }
        stroke={wireframeColor ?? (enhanced ? "#1a6b9f" : "#0a3d62")}
        strokeWidth={1}
        style={{ opacity: 1 }}
      />

      <path
        ref={graticuleRef}
        fill="none"
        stroke={wireframeColor ?? "#5bb8f5"}
        strokeWidth={wireframeColor ? 0.4 : 0.3}
        style={{ opacity: wireframeColor ? 0.18 : 0.3 }}
      />

      {tierLookup && (
        <path
          ref={(el) => {
            if (el) pathRefsMap.current.set(BACKGROUND_LAYER_KEY, el);
            else pathRefsMap.current.delete(BACKGROUND_LAYER_KEY);
          }}
          d={backgroundLayerD}
          fill={
            wireframeColor
              ? tierWireframeFill("background", wireframeColor)
              : TIER_COLORS.background
          }
          stroke={wireframeColor ?? TIER_STROKES.background}
          strokeWidth={TIER_STROKE_WIDTHS.background}
          strokeOpacity={wireframeColor ? 0.35 : 1}
          style={{ pointerEvents: "none" }}
          aria-hidden="true"
        />
      )}

      {features.map((feature, idx) => {
        const id = feature.id != null ? String(feature.id) : `_geo_${idx}`;
        const mapped = WORLD_MAPPED_COUNTRIES[id];
        const isHov =
          !isAnimating && hoveredOwnerKey != null && featureOwnerKey(id) === hoveredOwnerKey;

        // Four-tier mode: exactly four fills, and Background Nations never reach
        // here (they are in the merged inert layer above).
        if (tierLookup) {
          const tier = tierLookup.get(id) ?? "background";
          // Bloc mode recolors the interactive countries by alignment, and adds
          // the background ones that belong to a bloc — an alliance has to be
          // drawn at its real size. A country with no bloc entry keeps its tier
          // fill rather than dropping out, so the roster and the map agree.
          const bloc = blocLookup?.get(id);
          if (!isTierInteractive(tier) && !bloc) return null;
          // Background members are painted but stay INERT: there is no country
          // page behind Luxembourg, so offering a click would promise one.
          if (!isTierInteractive(tier) && bloc) {
            return (
              <path
                key={id}
                ref={(el) => {
                  if (el) pathRefsMap.current.set(id, el);
                  else pathRefsMap.current.delete(id);
                }}
                d={paths.get(id) ?? ""}
                fill={wireframeColor ? tierWireframeFill(tier, wireframeColor) : BLOC_COLORS[bloc]}
                stroke={wireframeColor ?? BLOC_STROKES[bloc]}
                strokeWidth={TIER_STROKE_WIDTHS[tier]}
                style={{ outline: "none", pointerEvents: "none" }}
              />
            );
          }
          // Hover emphasises the border rather than swapping the fill, so the
          // globe never shows an extra color.
          const tierFill = wireframeColor
            ? tierWireframeFill(tier, wireframeColor)
            : bloc
              ? BLOC_COLORS[bloc]
              : TIER_COLORS[tier];
          const tierStroke = isHov
            ? (wireframeColor ?? MAP_COLORS.strokeActive)
            : (wireframeColor ?? (bloc ? BLOC_STROKES[bloc] : TIER_STROKES[tier]));
          return (
            <path
              key={id}
              ref={(el) => {
                if (el) pathRefsMap.current.set(id, el);
                else pathRefsMap.current.delete(id);
              }}
              d={paths.get(id) ?? ""}
              fill={tierFill}
              stroke={tierStroke}
              strokeWidth={isHov ? 1.5 : TIER_STROKE_WIDTHS[tier]}
              style={{
                outline: "none",
                cursor: isAnimating ? "default" : "pointer",
                transition: isAnimating ? "none" : "stroke 0.15s ease",
              }}
              onMouseEnter={() => {
                if (!isAnimatingRef.current) {
                  hoveredRef.current = id;
                  onHover(id);
                  if (viewModeRef.current === "globe") syncPathsState();
                }
              }}
              onMouseLeave={() => {
                hoveredRef.current = null;
                onHover(null);
                onTooltipClear();
              }}
              onClick={() => onCountryClick(id)}
            />
          );
        }

        // British-Isles overlay (id "bi:<owner>") — one MERGED blob per owning
        // country, so it reads as a single nation (no internal region lines), the
        // stroke is the national border, and hover highlights the whole country.
        if (id.startsWith("bi:")) {
          const owner = feature.properties?.ownerCountryId as CountryId | undefined;
          let biFill: string =
            owner && countryAccess
              ? countryIdentityColor(owner, countryAccess)
              : getCountryColor(id, MAP_COLORS.default);
          let biStroke: string = MAP_COLORS.stroke;
          let biStrokeWidth = 0.6;
          if (isHov) {
            biFill = MAP_COLORS.hover;
            biStroke = MAP_COLORS.strokeActive;
            biStrokeWidth = 1.2;
          }
          if (wireframeColor) {
            biFill = isHov ? "#004400" : "#000e00";
            biStroke = wireframeColor;
            biStrokeWidth = isHov ? 1.2 : 0.6;
          }
          return (
            <path
              key={id}
              ref={(el) => {
                if (el) pathRefsMap.current.set(id, el);
              }}
              d={paths.get(id) ?? ""}
              fill={biFill}
              stroke={biStroke}
              strokeWidth={biStrokeWidth}
              style={{
                outline: "none",
                cursor: isAnimating ? "default" : "pointer",
                transition: isAnimating ? "none" : "fill 0.15s ease",
              }}
              onMouseEnter={() => {
                if (!isAnimatingRef.current) {
                  hoveredRef.current = id;
                  onHover(id);
                  if (viewModeRef.current === "globe") syncPathsState();
                }
              }}
              onMouseLeave={() => {
                hoveredRef.current = null;
                onHover(null);
                onTooltipClear();
              }}
              onClick={() => onCountryClick(id)}
            />
          );
        }

        const countryId = WORLD_COUNTRY_ISO_TO_ID[id];
        // Skip the base feature when an overlay blob already draws this territory —
        // otherwise the base outline bleeds through the merged overlay on top of it.
        // Covered entries are matched by game countryId (e.g. "DE"), by raw
        // countries-110m feature id (e.g. "804" Ukraine, for the USSR's republics
        // which have no game country of their own), OR by feature NAME for the
        // features Natural Earth ships without an id (e.g. "Kosovo", hidden under
        // the yugoslavia shard) — and only while the overlay actually covers
        // them, so they revert to themselves otherwise.
        const featureName = feature.properties?.name as string | undefined;
        if (
          biCoveredCountries?.has(id) ||
          (countryId && biCoveredCountries?.has(countryId)) ||
          (featureName && biCoveredCountries?.has(featureName))
        )
          return null;
        const availability =
          countryId && countryAccess?.[countryId]
            ? resolveCountryAvailability(countryId, countryAccess[countryId])
            : null;
        const isNavigable =
          Boolean(mapped?.path) &&
          (availability?.isClickable === true ||
            ((!countryAccess || !countryId) &&
              (mapped?.status === "active" || mapped?.status === "beta")));

        let fillColor: string = MAP_COLORS.default;
        let strokeColor: string = MAP_COLORS.stroke;
        let strokeWidth = 0.5;

        const worldEntity = worldEntities?.byFeatureId[id];
        if (!hasActiveFilter && worldEntities) {
          if (worldEntity?.simulationTier === "full-autonomous") {
            fillColor = MAP_COLORS.tierFullAutonomous;
          } else if (worldEntity?.simulationTier === "sphere-macro") {
            fillColor = MAP_COLORS.tierSphereMacro;
          } else if (worldEntity?.simulationTier === "historical-presence") {
            fillColor = MAP_COLORS.tierHistoricalPresence;
          } else {
            fillColor = MAP_COLORS.tierUnclassified;
          }
        } else if (mapped) {
          if (hasActiveFilter) {
            fillColor = getCountryColor(id, MAP_COLORS.default);
          } else {
            if (availability?.accessMode === "econ-only") {
              fillColor = MAP_COLORS.econOnly;
            } else {
              let globeStatus = mapped.status;
              if (countryAccess && countryId && countryId in countryAccess) {
                const dbStatus = countryAccess[countryId].status;
                globeStatus = dbStatus === "coming-soon" ? "planned" : dbStatus;
              }
              fillColor = MAP_COLORS[globeStatus];
            }
          }
        } else if (hasActiveFilter) {
          const color = getCountryColor(id, MAP_COLORS.default);
          if (color !== MAP_COLORS.default) {
            fillColor = color;
          }
        }

        if (isHov && mapped) {
          fillColor = MAP_COLORS.hover;
          strokeColor = MAP_COLORS.strokeActive;
          strokeWidth = 1.5;
        } else if (isHov && !mapped) {
          fillColor = "var(--card-border)";
        }

        if (wireframeColor) {
          fillColor = isHov ? "#004400" : "#000e00";
          strokeColor = wireframeColor;
          strokeWidth = isHov ? 1.2 : 0.6;
        }

        return (
          <path
            key={id}
            ref={(el) => {
              if (el) pathRefsMap.current.set(id, el);
            }}
            d={paths.get(id) ?? ""}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            style={{
              outline: "none",
              cursor: isNavigable && !isAnimating ? "pointer" : "default",
              transition: isAnimating ? "none" : "fill 0.15s ease",
            }}
            onMouseEnter={() => {
              if (!isAnimatingRef.current) {
                hoveredRef.current = id;
                onHover(id);
                if (viewModeRef.current === "globe") syncPathsState();
              }
            }}
            onMouseLeave={() => {
              hoveredRef.current = null;
              onHover(null);
              onTooltipClear();
            }}
            onClick={() => onCountryClick(id)}
          />
        );
      })}

      {playableCountryIds &&
        features.map((feature, idx) => {
          const id = feature.id != null ? String(feature.id) : `_geo_${idx}`;
          const countryId = featureCountryId(feature);
          if (!countryId || !playableCountryIds.has(countryId)) return null;
          return (
            <path
              key={`playable:${id}`}
              ref={(el) => {
                if (el) {
                  playablePathRefs?.current.set(id, el);
                } else {
                  playablePathRefs?.current.delete(id);
                }
              }}
              d={paths.get(id) ?? ""}
              fill={
                countryId === crisisCountryId
                  ? "url(#landing-crisis-hatch)"
                  : "url(#landing-playable-hatch)"
              }
              stroke="none"
              style={{ pointerEvents: "none" }}
            />
          );
        })}

      {warBorderInitialD && (
        <path
          ref={warBorderPathRef}
          d={warBorderInitialD}
          fill="none"
          stroke="#ef4444"
          strokeWidth={1.5}
          strokeDasharray="4 3"
          style={{
            pointerEvents: "none",
            animation: "marchingAnts 1.5s linear infinite",
          }}
        />
      )}

      {enhanced &&
        arcs?.map((a) => (
          <path
            key={a.id}
            ref={(el) => {
              if (el) arcRefs?.current.set(a.id, el);
            }}
            fill="none"
            stroke={a.color}
            strokeWidth={1.4}
            strokeDasharray="5 4"
            style={{
              opacity: 0,
              pointerEvents: "none",
              animation: "marchingAnts 2s linear infinite",
            }}
          />
        ))}
      {enhanced &&
        hotspots?.map((h) => (
          <g
            key={h.id}
            ref={(el) => {
              if (el) hotspotRefs?.current.set(h.id, el as unknown as SVGGElement);
            }}
            style={{ pointerEvents: "none", opacity: 0 }}
          >
            <circle r={3.5} fill="var(--danger)" />
            <circle r={3.5} fill="var(--danger)" opacity={0.6}>
              <animate attributeName="r" values="3.5;9;3.5" dur="2.4s" repeatCount="indefinite" />
              <animate
                attributeName="opacity"
                values="0.6;0;0.6"
                dur="2.4s"
                repeatCount="indefinite"
              />
            </circle>
          </g>
        ))}
    </svg>
  );
}
