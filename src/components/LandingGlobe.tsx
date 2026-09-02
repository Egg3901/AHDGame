"use client";

/**
 * Marketing hero globe — same imperative d3-geo pipeline as /world (WorldMapSVG):
 * path `d` updates via refs + requestAnimationFrame, no per-frame React reconciliation.
 * Smaller viewBox, globe-only, status colors only (aligned with worldConstants).
 */
import { useRouter } from "next/navigation";
import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { Badge, Skeleton } from "@/components/ui";
import MapSVGContent, {
  BACKGROUND_LAYER_KEY,
  type GlobeLayout,
} from "@/app/world/components/MapSVGContent";
import MapTooltip from "@/app/world/components/MapTooltip";
import { getMapTooltipAccessDisplay, ISO_TO_COUNTRY_ID } from "@/app/world/worldMetricHighlight";
import { resolveCountryAvailability } from "@/lib/countryAvailability";
import { COUNTRY_CONFIGS, type CountryId, type CountryStatus } from "@/lib/constants/countries";
import { WORLD_MAPPED_COUNTRIES } from "@/lib/worldCountryRegistry";
import { computeRegionBlobs } from "@/lib/maps/regionOverlay";
import { cdnStatic } from "@/lib/images/cdnUrls";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";
import {
  EAST_DE_REGION_CODES,
  GERMANY_GEO_URL,
  WEST_DE_REGION_CODES,
} from "@/lib/maps/germanyGeometry";
import { DD_GEO_URL, DD_SHARD_CODES } from "@/lib/maps/ddGeometry";
import {
  WORLD_GEO_URL,
  LANDING_SVG_W,
  LANDING_SVG_H,
  LANDING_TRANSLATE,
  LANDING_ORTHO_SCALE,
} from "@/app/world/worldConstants";
import {
  buildArcs,
  buildHotspots,
  buildStarfield,
  type ArcSpec,
  type HotspotSpec,
  type StarSpec,
} from "@/components/landing/globeEnhancements";
import {
  HISTORICAL_CRISIS_SHOWCASE,
  type HistoricalCrisisShowcaseEntry,
} from "@/components/landing/historicalCrisisShowcase";
import {
  buildTierLookup,
  isTierInteractive,
  tierWireframeFill,
  TIER_COLORS,
  TIER_LABELS,
  TIER_ORDER,
} from "@/components/landing/countryTiers";
import { useCountryDisplayName } from "@/contexts/RegisteredCountriesContext";

type LandingCountryAccess = Partial<
  Record<string, { enabledForPlayers: boolean; economyPreview: boolean; status: CountryStatus }>
>;

const LANDING_LAYOUT: GlobeLayout = {
  svgW: LANDING_SVG_W,
  svgH: LANDING_SVG_H,
  translate: LANDING_TRANSLATE,
  orthoScale: LANDING_ORTHO_SCALE,
};

/**
 * Playable-country markers on the landing globe. Positions are hand-set lon/lat
 * (not d3 centroids) so each chip sits on the recognizable heart of its nation:
 * USSR at Moscow (Russia's centroid is deep in Siberia) and East Germany near
 * Berlin (the modern basemap has no DDR feature — it shares unified Germany).
 */
type LandingMarkerGeo = { label: string; lonLat: [number, number] };
const LANDING_MARKERS: Record<string, LandingMarkerGeo> = {
  US: { label: "United States", lonLat: [-98, 39] },
  UK: { label: "United Kingdom", lonLat: [-1.8, 52.6] },
  RU: { label: "USSR", lonLat: [37.6, 55.75] },
  DD: { label: "East Germany", lonLat: [12.6, 52.2] },
};
// Marker declutter geometry (screen px): chips lift above their pin, cluster when
// their pins fall within CLUSTER_DX, and stack ROW_H apart with leader lines.
const MARKER_LIFT = 54;
const MARKER_ROW_H = 34;
const MARKER_CLUSTER_DX = 120;
const SHOWCASE_IDLE_MS = 12_000;
/**
 * Idle-spin frame budgets. The globe re-runs d3 path generation for every
 * feature on each frame it advances, so the budget is the single biggest lever
 * on a weak machine: 33ms is ~30fps, 66ms ~15fps. The rotation step scales with
 * the budget, so the globe turns at the same degrees-per-second either way — a
 * potato gets a coarser animation, not a slower world.
 */
const FRAME_BUDGET_MS = 33;
const LOW_POWER_FRAME_BUDGET_MS = 66;
const SPIN_DEGREES_PER_FRAME = 0.12;
const SHOWCASE_TRANSITION_MS = 1_500;
const SHOWCASE_HOLD_MS = 4_200;

const GERMANY_SPLIT_OWNERSHIP: Record<string, string> = Object.fromEntries([
  ...WEST_DE_REGION_CODES.map((code) => [code, "DE"]),
  ...EAST_DE_REGION_CODES.map((code) => [code, "DD"]),
  ...DD_SHARD_CODES.map((code) => [code, "DD"]),
]);

type ShowcaseMotion = {
  index: number;
  transitionStartedAt: number;
  startRotation: [number, number, number];
  endRotation: [number, number, number];
  startZoom: number;
  targetZoom: number;
  settled: boolean;
};

function nearestLongitudeRotation(start: number, target: number): number {
  const delta = ((((target - start + 180) % 360) + 360) % 360) - 180;
  return start + delta;
}

/**
 * Fill resolution is fully owned by the tier lookup on the landing globe, so
 * this stays a stable identity — no per-path closure work, no re-render churn.
 */
const passThroughCountryColor = (_id: string, def: string): string => def;

/** Legend row: the four canonical tiers, shown in `TIER_ORDER`. */
function TierLegendSwatch({ tier }: { tier: (typeof TIER_ORDER)[number] }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className="h-3 w-3 shrink-0 rounded-full border border-white/20"
        style={{ background: TIER_COLORS[tier] }}
      />
      <span>{TIER_LABELS[tier]}</span>
    </span>
  );
}

export function LandingGlobe({
  gameDate,
  theme = "default",
  countryAccess,
  hideLiveIndicator = false,
  enhanced = false,
  blocColoring = false,
  bare = false,
  initialRotation,
  initialZoom,
  geoUrl,
  wireframeColor,
  playerCounts,
  battlegroundFeatureIds,
  economicPowerFeatureIds,
  onShowcaseActiveChange,
  showcasePaused = false,
}: {
  gameDate?: string;
  theme?: "default" | "broadsheet";
  countryAccess?: LandingCountryAccess;
  /**
   * Suppress the pulsing dot and "Live" caption on the date strip. The in-game
   * date itself still renders (it is period flavor, not a live-status badge).
   * Defaults false so the existing broadsheet landing is unchanged.
   */
  hideLiveIndicator?: boolean;
  /** Next-level globe: atmosphere, arcs, hotspots, ease-to-center. Default false. */
  enhanced?: boolean;
  /** Color countries by 1979 Cold War bloc instead of access status. Default false. */
  blocColoring?: boolean;
  /** CRT phosphor wireframe color — overrides all country fills/strokes with dark-bg + bright-line style. */
  wireframeColor?: string;
  /**
   * Full-bleed, chrome-less mode: drop the card border/background, the date
   * header, and the legend footer so the globe can sit as a transparent
   * background layer that fills its container. The SVG, hover tooltip, and all
   * drag/zoom interaction are retained. Default false.
   */
  bare?: boolean;
  /** Initial rotation [lon→ -λ, lat→ -φ, γ]. Default [-35,-15,0]. */
  initialRotation?: [number, number, number];
  /** Initial zoom multiplier. Default 1. */
  initialZoom?: number;
  /** Override the geo topojson URL (e.g. CDN). Defaults to WORLD_GEO_URL. */
  geoUrl?: string;
  /** Live player count per playable country code, e.g. `{ US: 12, UK: 3 }`. */
  playerCounts?: Record<string, number>;
  /**
   * Map feature ids painted as Battleground Nations for this era. Sourced from
   * `battlegroundFeatureIdsForEra`, which mirrors the world entity manifest's
   * `simulationTier: "sphere-macro"` roster. Pass a stable reference — the tier
   * lookup is memoised on it.
   */
  battlegroundFeatureIds?: readonly string[];
  /**
   * Map feature ids painted as Economic Powers on top of whatever the era
   * `countryAccess` names. Mirrors the manifest's non-player
   * `simulationTier: "full-autonomous"` roster, which is what puts the Warsaw
   * Pact bloc in this tier. Pass a stable reference.
   */
  economicPowerFeatureIds?: readonly string[];
  /** Fires when the idle historical-crisis showcase starts/stops, so a parent
   *  hero overlay can fade its own text out of the way and back in. */
  onShowcaseActiveChange?: (active: boolean) => void;
  /**
   * Hold the idle historical-crisis showcase. Any showcase already running
   * stops on the next frame and the globe returns to plain idle spin. Used by
   * the landing hero while a timed promo owns the first viewport. Default
   * false, so normal behaviour resumes the moment the flag clears.
   */
  showcasePaused?: boolean;
}) {
  const resolveCountryName = useCountryDisplayName();
  const isBroadsheet = theme === "broadsheet";
  const router = useRouter();

  const [hovered, setHovered] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [paths, setPaths] = useState<Map<string, string | null>>(new Map());
  const [showcaseEntry, setShowcaseEntry] = useState<HistoricalCrisisShowcaseEntry | null>(null);
  /** True once the fixed background globe has scrolled out of the viewport. */
  const [globeScrolledAway, setGlobeScrolledAway] = useState(false);

  const cardRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pathRefsMap = useRef<Map<string, SVGPathElement>>(new Map());
  const playablePathRefsMap = useRef<Map<string, SVGPathElement>>(new Map());
  const sphereRef = useRef<SVGCircleElement>(null);
  const graticuleRef = useRef<SVGPathElement>(null);
  const warBorderPathRef = useRef<SVGPathElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const warBorderFeatureRef = useRef<any>(null);
  const warBorderInitialDRef = useRef<string>("");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const featuresRef = useRef<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graticuleDataRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d3Ref = useRef<any>(null);

  const viewModeRef = useRef<"map" | "globe">("globe");
  const rotationRef = useRef<[number, number, number]>(initialRotation ?? [-35, -15, 0]);
  const zoomRef = useRef(initialZoom ?? 1);
  const hoveredRef = useRef<string | null>(null);
  const isDraggingRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const autoRotateRef = useRef(0);
  const dragFrameRef = useRef(0);
  const isAnimatingRef = useRef(false);
  const isInViewRef = useRef(true);
  const lastFrameRef = useRef(0);
  const lastInteractionRef = useRef(0);
  const prefersReducedMotionRef = useRef(false);
  // Weak device: fewer stars and half the frame rate. Detected after mount so
  // the server markup stays identical for everyone.
  const [lowPower, setLowPower] = useState(false);
  const lowPowerRef = useRef(false);
  lowPowerRef.current = lowPower;
  const showcaseMotionRef = useRef<ShowcaseMotion | null>(null);

  const enhancedRef = useRef(enhanced);
  enhancedRef.current = enhanced;
  const blocColoringRef = useRef(blocColoring);
  blocColoringRef.current = blocColoring;
  const onShowcaseActiveChangeRef = useRef(onShowcaseActiveChange);
  onShowcaseActiveChangeRef.current = onShowcaseActiveChange;
  // Read inside the rAF loop, which is not re-created on prop changes.
  const showcasePausedRef = useRef(showcasePaused);
  showcasePausedRef.current = showcasePaused;
  const playableCountryIds = useMemo(
    () =>
      new Set(
        Object.entries(countryAccess ?? {})
          .filter(([, access]) => access?.enabledForPlayers)
          .map(([countryId]) => countryId)
      ),
    [countryAccess]
  );
  const shouldSplitGermany = Boolean(countryAccess?.DE && countryAccess?.DD);
  const highlightedCountryIds = useMemo(() => {
    const highlighted = new Set(playableCountryIds);
    if (showcaseEntry?.countryId) highlighted.add(showcaseEntry.countryId);
    return highlighted;
  }, [playableCountryIds, showcaseEntry]);

  const arcsData: ArcSpec[] = useMemo(() => buildArcs(), []);
  const hotspotsData: HotspotSpec[] = useMemo(() => buildHotspots(), []);
  // Starfield: deterministic seed, rendered before the sphere <circle> so the
  // opaque globe naturally paints over any star behind it — this tracks the
  // globe's actual current zoom for free. (A prior version pre-filtered stars
  // by a fixed zoom-1 radius, which drifted out of sync with the real radius
  // as soon as initialZoom/showcase zoom/pinch-zoom moved it off 1.)
  const starfieldData: StarSpec[] = useMemo(
    () =>
      buildStarfield({
        width: LANDING_SVG_W,
        height: LANDING_SVG_H,
        // Each star is a real SVG node behind a rotating globe; a low-end GPU
        // pays for all of them on every repaint.
        count: lowPower ? 90 : undefined,
      }),
    [lowPower]
  );
  const arcRefsMap = useRef<Map<string, SVGPathElement>>(new Map());
  const hotspotRefsMap = useRef<Map<string, SVGGElement>>(new Map());

  /**
   * Feature id → tier, built ONCE per era (not per render, and emphatically not
   * per path per frame the way the old `getCountryColor` callback was). Absent
   * key means Background Nations.
   */
  const tierLookup = useMemo(
    () =>
      countryAccess
        ? buildTierLookup(
            ISO_TO_COUNTRY_ID,
            countryAccess,
            battlegroundFeatureIds ?? [],
            economicPowerFeatureIds ?? []
          )
        : undefined,
    [countryAccess, battlegroundFeatureIds, economicPowerFeatureIds]
  );
  const tierLookupRef = useRef(tierLookup);
  tierLookupRef.current = tierLookup;

  const haloRef = useRef<SVGCircleElement>(null);

  const markInteraction = useCallback((at = performance.now()) => {
    lastInteractionRef.current = at;
    if (!showcaseMotionRef.current) return;
    showcaseMotionRef.current = null;
    setShowcaseEntry(null);
    onShowcaseActiveChangeRef.current?.(false);
  }, []);

  // Playable-country markers: HTML glass chips positioned imperatively per frame.
  const markersOverlayRef = useRef<HTMLDivElement>(null);
  const leadersSvgRef = useRef<SVGSVGElement>(null);
  const markerRefsMap = useRef<Map<string, HTMLDivElement>>(new Map());
  const leaderLineRefsMap = useRef<Map<string, SVGLineElement>>(new Map());
  const leaderDotRefsMap = useRef<Map<string, SVGCircleElement>>(new Map());
  const markerList = useMemo(
    () =>
      Object.entries(playerCounts ?? {})
        .filter(([id]) => LANDING_MARKERS[id])
        .map(([id, count]) => ({
          id,
          label: LANDING_MARKERS[id].label,
          lonLat: LANDING_MARKERS[id].lonLat,
          count,
        })),
    [playerCounts]
  );
  const markerListRef = useRef(markerList);
  markerListRef.current = markerList;

  const updateMarkers = useCallback(() => {
    const d3 = d3Ref.current;
    const overlay = markersOverlayRef.current;
    const svg = svgRef.current;
    const list = markerListRef.current;
    if (!d3 || !overlay || !svg || list.length === 0) return;

    const z = zoomRef.current;
    const rot = rotationRef.current;
    const proj = d3
      .geoOrthographic()
      .scale(LANDING_ORTHO_SCALE * z)
      .translate(LANDING_TRANSLATE)
      .rotate(rot)
      .clipAngle(90 + 1e-6);

    const sr = svg.getBoundingClientRect();
    const mr = overlay.getBoundingClientRect();
    if (leadersSvgRef.current) {
      leadersSvgRef.current.setAttribute("viewBox", `0 0 ${mr.width} ${mr.height}`);
    }
    const HALF = Math.PI / 2;
    const center: [number, number] = [-rot[0], -rot[1]];
    // The showcase card takes over the spotlight — fade the player-count
    // chips out of its way (they fade back in the instant showcase ends).
    const showcaseFade = showcaseMotionRef.current ? 0 : 1;

    type Vis = {
      id: string;
      chip: HTMLDivElement;
      px: number;
      py: number;
      op: number;
      tx: number;
      ty: number;
    };
    const vis: Vis[] = [];
    for (const m of list) {
      const chip = markerRefsMap.current.get(m.id);
      if (!chip) continue;
      const line = leaderLineRefsMap.current.get(m.id);
      const dot = leaderDotRefsMap.current.get(m.id);
      const dist = d3.geoDistance(m.lonLat, center);
      const pt = dist < HALF * 0.995 ? proj(m.lonLat) : null;
      if (!pt) {
        chip.style.opacity = "0";
        if (line) line.style.opacity = "0";
        if (dot) dot.style.opacity = "0";
        continue;
      }
      // Project into viewport coords, declutter there, then write overlay-local.
      const px = sr.left + (pt[0] / LANDING_SVG_W) * sr.width;
      const py = sr.top + (pt[1] / LANDING_SVG_H) * sr.height;
      const t = dist / HALF;
      const op = (t < 0.8 ? 1 : Math.max(0, 1 - (t - 0.8) / 0.19)) * showcaseFade;
      vis.push({ id: m.id, chip, px, py, op, tx: px, ty: py - MARKER_LIFT });
    }
    if (vis.length === 0) return;

    let cw = 112;
    let ch = 30;
    const r0 = vis[0].chip.getBoundingClientRect();
    if (r0.width) {
      cw = r0.width;
      ch = r0.height;
    }
    const vpLeft = cw / 2 + 6;
    const vpRight = window.innerWidth - cw / 2 - 6;
    const vpTop = 70; // clear the site nav
    const vpBottom = window.innerHeight - ch / 2 - 10;

    // Cluster chips whose pins bunch up (e.g. UK / East Germany / USSR in Europe),
    // then stack each cluster into a tidy column so labels never overlap.
    const byX = [...vis].sort((a, b) => a.px - b.px);
    const used = new Array(byX.length).fill(false);
    for (let a = 0; a < byX.length; a++) {
      if (used[a]) continue;
      const group = [byX[a]];
      used[a] = true;
      for (let b = a + 1; b < byX.length; b++) {
        if (!used[b] && Math.abs(byX[b].px - group[group.length - 1].px) < MARKER_CLUSTER_DX) {
          group.push(byX[b]);
          used[b] = true;
        }
      }
      if (group.length < 2) continue;
      const meanX = group.reduce((s, v) => s + v.px, 0) / group.length;
      const colx = Math.max(vpLeft, Math.min(vpRight, meanX));
      const rowH = Math.max(MARKER_ROW_H, ch + 8);
      const meanTy = group.reduce((s, v) => s + (v.py - MARKER_LIFT), 0) / group.length;
      let startY = meanTy - ((group.length - 1) / 2) * rowH;
      const minPin = Math.min(...group.map((v) => v.py));
      const bottom = startY + (group.length - 1) * rowH;
      if (bottom > minPin - 16) startY -= bottom - (minPin - 16);
      if (startY < vpTop) startY = vpTop;
      group.sort((p, q) => p.px - q.px);
      group.forEach((v, k) => {
        v.tx = colx;
        v.ty = startY + k * rowH;
      });
    }

    for (const v of vis) {
      v.tx = Math.max(vpLeft, Math.min(vpRight, v.tx));
      v.ty = Math.max(vpTop, Math.min(vpBottom, v.ty));
      v.chip.style.left = `${v.tx - mr.left}px`;
      v.chip.style.top = `${v.ty - mr.top}px`;
      v.chip.style.opacity = String(v.op);
      const line = leaderLineRefsMap.current.get(v.id);
      const dot = leaderDotRefsMap.current.get(v.id);
      if (line) {
        line.setAttribute("x1", String(v.tx - mr.left));
        line.setAttribute("y1", String(v.ty - mr.top + ch / 2 - 2));
        line.setAttribute("x2", String(v.px - mr.left));
        line.setAttribute("y2", String(v.py - mr.top));
        line.style.opacity = String(v.op * 0.85);
      }
      if (dot) {
        dot.setAttribute("cx", String(v.px - mr.left));
        dot.setAttribute("cy", String(v.py - mr.top));
        dot.style.opacity = String(v.op);
      }
    }
  }, []);

  // Historical-crisis showcase card: attached to its country like the
  // player-count chips above, via the same projection + leader line into
  // leadersSvgRef, instead of a fixed corner toast.
  const showcaseCardRef = useRef<HTMLDivElement>(null);
  const showcaseLeaderLineRef = useRef<SVGLineElement>(null);
  const showcaseLeaderDotRef = useRef<SVGCircleElement>(null);

  const updateShowcaseCard = useCallback(() => {
    const d3 = d3Ref.current;
    const svg = svgRef.current;
    const overlay = markersOverlayRef.current;
    const motion = showcaseMotionRef.current;
    const line = showcaseLeaderLineRef.current;
    const dot = showcaseLeaderDotRef.current;
    if (!d3 || !svg || !overlay || !motion) return;

    const entry = HISTORICAL_CRISIS_SHOWCASE[motion.index];
    const rot = rotationRef.current;
    const proj = d3
      .geoOrthographic()
      .scale(LANDING_ORTHO_SCALE * zoomRef.current)
      .translate(LANDING_TRANSLATE)
      .rotate(rot)
      .clipAngle(90 + 1e-6);

    const sr = svg.getBoundingClientRect();
    const mr = overlay.getBoundingClientRect();
    // Belt-and-suspenders: updateMarkers() usually owns this, but it no-ops
    // when there are no player-count chips, which would otherwise leave this
    // unset on a markerless page.
    if (leadersSvgRef.current) {
      leadersSvgRef.current.setAttribute("viewBox", `0 0 ${mr.width} ${mr.height}`);
    }
    const center: [number, number] = [-rot[0], -rot[1]];
    const visible = d3.geoDistance(entry.lonLat, center) < (Math.PI / 2) * 0.995;
    const pt = visible ? proj(entry.lonLat) : null;

    if (line) line.style.opacity = pt ? "0.85" : "0";
    if (dot) dot.style.opacity = pt ? "1" : "0";
    if (!pt) return;

    const px = sr.left + (pt[0] / LANDING_SVG_W) * sr.width;
    const py = sr.top + (pt[1] / LANDING_SVG_H) * sr.height;
    if (dot) {
      dot.setAttribute("cx", String(px - mr.left));
      dot.setAttribute("cy", String(py - mr.top));
    }

    const card = showcaseCardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const cw = rect.width || 320;
    const ch = rect.height || 170;
    const gap = 24;
    const navClearance = 76;
    const above = py - gap - ch >= navClearance;
    const cardTop = above ? py - gap - ch : Math.min(py + gap, window.innerHeight - ch - 16);
    const cardLeft = Math.max(cw / 2 + 12, Math.min(window.innerWidth - cw / 2 - 12, px));

    card.style.left = `${cardLeft}px`;
    card.style.top = `${Math.max(navClearance, cardTop)}px`;

    if (line) {
      line.setAttribute("x1", String(cardLeft - mr.left));
      line.setAttribute("y1", String((above ? cardTop + ch : cardTop) - mr.top));
      line.setAttribute("x2", String(px - mr.left));
      line.setAttribute("y2", String(py - mr.top));
    }
  }, []);

  const updateEnhancedOverlay = useCallback(() => {
    const d3 = d3Ref.current;
    if (!d3 || !featuresRef.current.length) return;
    const z = zoomRef.current;
    const proj = d3
      .geoOrthographic()
      .scale(LANDING_ORTHO_SCALE * z)
      .translate(LANDING_TRANSLATE)
      .rotate(rotationRef.current)
      .clipAngle(90 + 1e-6);
    const pathGen = d3.geoPath(proj);
    for (const arc of arcsData) {
      const el = arcRefsMap.current.get(arc.id);
      if (!el) continue;
      const interp = d3.geoInterpolate(arc.from, arc.to);
      const coords: [number, number][] = [];
      for (let t = 0; t <= 1; t += 1 / 48) coords.push(interp(t));
      const d = pathGen({ type: "LineString", coordinates: coords } as never);
      if (d) {
        el.setAttribute("d", d);
        el.style.opacity = "0.8";
      } else {
        el.style.opacity = "0";
      }
    }
    for (const h of hotspotsData) {
      const el = hotspotRefsMap.current.get(h.id);
      if (!el) continue;
      const xy = proj(h.lonLat);
      if (xy) {
        el.setAttribute("transform", `translate(${xy[0]},${xy[1]})`);
        el.style.opacity = "1";
      } else {
        el.style.opacity = "0";
      }
    }
  }, [arcsData, hotspotsData]);

  const imperativeUpdate = useCallback(() => {
    const d3 = d3Ref.current;
    if (!d3 || !featuresRef.current.length) return;

    const z = zoomRef.current;
    const proj = d3
      .geoOrthographic()
      .scale(LANDING_ORTHO_SCALE * z)
      .translate(LANDING_TRANSLATE)
      .rotate(rotationRef.current)
      .clipAngle(90 + 1e-6);

    const pathGen = d3.geoPath(proj);
    const lookup = tierLookupRef.current;
    // Background Nations are accumulated into ONE `d` string and written once,
    // instead of ~150 individual setAttribute calls every animation frame.
    let backgroundD = "";
    for (const feature of featuresRef.current) {
      const id = String(feature.id);
      const isBackground = lookup ? !isTierInteractive(lookup.get(id) ?? "background") : false;
      if (isBackground) {
        const d = pathGen(feature);
        if (d) backgroundD += d;
        continue;
      }
      const el = pathRefsMap.current.get(id);
      if (!el) continue;
      const d = pathGen(feature);
      if (d) {
        el.setAttribute("d", d);
        el.style.opacity = "1";
        const playableEl = playablePathRefsMap.current.get(id);
        if (playableEl) {
          playableEl.setAttribute("d", d);
          playableEl.style.opacity = "1";
        }
      } else {
        el.style.opacity = "0";
        const playableEl = playablePathRefsMap.current.get(id);
        if (playableEl) playableEl.style.opacity = "0";
      }
    }
    if (lookup) {
      const backgroundEl = pathRefsMap.current.get(BACKGROUND_LAYER_KEY);
      if (backgroundEl) backgroundEl.setAttribute("d", backgroundD);
    }

    if (graticuleRef.current && graticuleDataRef.current) {
      const gd = pathGen(graticuleDataRef.current);
      if (gd) graticuleRef.current.setAttribute("d", gd);
    }

    if (sphereRef.current) {
      sphereRef.current.setAttribute("r", String(LANDING_ORTHO_SCALE * z));
    }

    if (warBorderPathRef.current && warBorderFeatureRef.current) {
      const wd = pathGen(warBorderFeatureRef.current);
      if (wd) {
        warBorderPathRef.current.setAttribute("d", wd);
        warBorderPathRef.current.style.opacity = "1";
      } else {
        warBorderPathRef.current.style.opacity = "0";
      }
    }

    if (enhancedRef.current) updateEnhancedOverlay();
    updateMarkers();
    updateShowcaseCard();
  }, [updateEnhancedOverlay, updateMarkers, updateShowcaseCard]);

  const syncPathsState = useCallback(() => {
    const d3 = d3Ref.current;
    if (!d3 || !featuresRef.current.length) return;

    const z = zoomRef.current;
    const proj = d3
      .geoOrthographic()
      .scale(LANDING_ORTHO_SCALE * z)
      .translate(LANDING_TRANSLATE)
      .rotate(rotationRef.current)
      .clipAngle(90 + 1e-6);

    const pathGen = d3.geoPath(proj);
    const newPaths = new Map<string, string | null>();
    for (const feature of featuresRef.current) {
      newPaths.set(String(feature.id), pathGen(feature));
    }

    if (graticuleRef.current && graticuleDataRef.current) {
      graticuleRef.current.setAttribute("d", pathGen(graticuleDataRef.current) || "");
      graticuleRef.current.style.opacity = "0.3";
    }
    if (sphereRef.current) {
      sphereRef.current.style.opacity = "1";
      sphereRef.current.setAttribute("r", String(LANDING_ORTHO_SCALE * z));
    }
    for (const [id, el] of pathRefsMap.current) {
      if (el) el.style.opacity = newPaths.get(id) !== null ? "1" : "0";
    }

    if (warBorderPathRef.current && warBorderFeatureRef.current) {
      const d = pathGen(warBorderFeatureRef.current);
      if (d) {
        warBorderPathRef.current.setAttribute("d", d);
        warBorderPathRef.current.style.opacity = "1";
      } else {
        warBorderPathRef.current.style.opacity = "0";
      }
    }

    if (enhancedRef.current) updateEnhancedOverlay();
    updateMarkers();
    updateShowcaseCard();

    setPaths(newPaths);
  }, [updateEnhancedOverlay, updateMarkers, updateShowcaseCard]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const germanySplitPromise = shouldSplitGermany
        ? Promise.all([
            import("polygon-clipping"),
            fetch(GERMANY_GEO_URL).then((response) => response.json()),
            fetch(DD_GEO_URL).then((response) => response.json()),
          ]).catch(() => null)
        : Promise.resolve(null);
      const [d3, topojson, germanySplit] = await Promise.all([
        import("d3-geo"),
        import("topojson-client"),
        germanySplitPromise,
      ]);
      if (cancelled) return;
      d3Ref.current = d3;

      const resp = await fetch(geoUrl ?? WORLD_GEO_URL);
      const topo = await resp.json();
      if (cancelled) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const geojson = (topojson as any).feature(topo, topo.objects.countries);

      if (germanySplit) {
        const [pcMod, germanyGeo, eastBerlinGeo] = germanySplit;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const polygonClipping: any = (pcMod as any).default ?? pcMod;
        const { blobs } = computeRegionBlobs(
          [
            { baseCountryIds: ["DE"], features: germanyGeo.features ?? [] },
            { baseCountryIds: ["DE"], features: eastBerlinGeo.features ?? [] },
          ],
          GERMANY_SPLIT_OWNERSHIP,
          {},
          polygonClipping,
          true
        );

        geojson.features = geojson.features.filter(
          (feature: { id?: unknown }) => String(feature.id) !== "276"
        );
        for (const owner of ["DE", "DD"] as const) {
          const solid = blobs.get(owner);
          if (!solid) continue;
          const coordinates = solid.map((poly) =>
            poly.map((ring) =>
              d3.geoArea({ type: "Polygon", coordinates: [ring] }) > 2 * Math.PI
                ? [...ring].reverse()
                : ring
            )
          );
          geojson.features.push({
            type: "Feature",
            id: `bi:${owner}`,
            properties: { ownerCountryId: owner },
            geometry: { type: "MultiPolygon", coordinates },
          });
        }
      }
      featuresRef.current = geojson.features;

      graticuleDataRef.current = d3.geoGraticule10();

      const initProj = d3
        .geoOrthographic()
        .scale(LANDING_ORTHO_SCALE * zoomRef.current)
        .translate(LANDING_TRANSLATE)
        .rotate(rotationRef.current)
        .clipAngle(90 + 1e-6);
      const pathGen = d3.geoPath(initProj);
      const initialPaths = new Map<string, string | null>();
      for (const f of geojson.features) {
        initialPaths.set(String(f.id), pathGen(f));
      }
      setPaths(initialPaths);
      setIsLoaded(true);
    }

    load();

    return () => {
      cancelled = true;
      if (autoRotateRef.current) cancelAnimationFrame(autoRotateRef.current);
      if (dragFrameRef.current) cancelAnimationFrame(dragFrameRef.current);
    };
  }, [geoUrl, shouldSplitGermany]);

  // Weak-device detection, once on mount. Core count and device memory are the
  // only signals a browser gives before anything is rendered; both are coarse
  // and `deviceMemory` is Chromium-only, so this is a hint, not a measurement —
  // it degrades the globe, never disables it.
  useEffect(() => {
    const nav = navigator as Navigator & { deviceMemory?: number };
    const cores = nav.hardwareConcurrency ?? 8;
    const memory = nav.deviceMemory ?? 8;
    if (cores <= 4 || memory <= 4) setLowPower(true);
  }, []);

  // Pause when tab is hidden (applies to all uses of LandingGlobe).
  useEffect(() => {
    if (!isLoaded) return;
    const onVis = () => {
      if (document.hidden) {
        isInViewRef.current = false;
        markInteraction();
      } else {
        isInViewRef.current = !bare || window.scrollY < window.innerHeight * 0.88;
      }
    };
    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [isLoaded, bare, markInteraction]);

  // Pause auto-rotation when the globe has scrolled off screen (bare/fixed background mode).
  // Uses a passive scroll listener; 88 % of vh matches the -mt-[12vh] drawer overlap.
  //
  // The same signal drives `globeScrolledAway`, which hides the portalled tier
  // legend. The legend is `position: fixed` on document.body, so without this it
  // kept floating in the corner over the feature cards, the carousel, and the
  // "Learn the game" section, explaining a globe that was no longer on screen.
  useEffect(() => {
    if (!isLoaded || !bare) return;
    const check = () => {
      const inView = window.scrollY < window.innerHeight * 0.88;
      isInViewRef.current = inView;
      setGlobeScrolledAway((prev) => (prev === !inView ? prev : !inView));
      if (!inView) markInteraction();
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    return () => window.removeEventListener("scroll", check);
  }, [isLoaded, bare, markInteraction]);

  useEffect(() => {
    if (!isLoaded || !bare || !enhanced) return;
    lastInteractionRef.current = performance.now();
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => {
      prefersReducedMotionRef.current = media.matches;
      if (media.matches) markInteraction();
    };
    syncPreference();
    media.addEventListener("change", syncPreference);
    return () => media.removeEventListener("change", syncPreference);
  }, [isLoaded, bare, enhanced, markInteraction]);

  useEffect(() => {
    if (!isLoaded) return;

    const beginShowcaseEntry = (index: number, ts: number) => {
      const entry = HISTORICAL_CRISIS_SHOWCASE[index];
      const targetRotation: [number, number, number] = [-entry.lonLat[0], -entry.lonLat[1], 0];
      targetRotation[0] = nearestLongitudeRotation(rotationRef.current[0], targetRotation[0]);
      showcaseMotionRef.current = {
        index,
        transitionStartedAt: ts,
        startRotation: [...rotationRef.current],
        endRotation: targetRotation,
        startZoom: zoomRef.current,
        targetZoom: Math.min(1.35, (initialZoom ?? 1) * 1.14),
        settled: false,
      };
      hoveredRef.current = null;
      setHovered(null);
      setTooltipPos(null);
      setShowcaseEntry(entry);
      onShowcaseActiveChangeRef.current?.(true);
      syncPathsState();
    };

    const spin = (ts: number) => {
      const frameBudget = lowPowerRef.current ? LOW_POWER_FRAME_BUDGET_MS : FRAME_BUDGET_MS;
      const showcaseEnabled =
        bare && enhanced && !prefersReducedMotionRef.current && !showcasePausedRef.current;
      if (
        showcaseEnabled &&
        isInViewRef.current &&
        !isDraggingRef.current &&
        !showcaseMotionRef.current &&
        ts - lastInteractionRef.current >= SHOWCASE_IDLE_MS
      ) {
        beginShowcaseEntry(0, ts);
      }

      const showcaseMotion = showcaseMotionRef.current;
      if (showcaseMotion && (!showcaseEnabled || !isInViewRef.current)) {
        markInteraction(ts);
      } else if (showcaseMotion && !isDraggingRef.current) {
        const elapsed = ts - showcaseMotion.transitionStartedAt;
        if (elapsed >= SHOWCASE_TRANSITION_MS + SHOWCASE_HOLD_MS) {
          beginShowcaseEntry((showcaseMotion.index + 1) % HISTORICAL_CRISIS_SHOWCASE.length, ts);
        } else if (!showcaseMotion.settled && (!bare || ts - lastFrameRef.current >= frameBudget)) {
          lastFrameRef.current = ts;
          const progress = Math.min(1, elapsed / SHOWCASE_TRANSITION_MS);
          const eased = 1 - Math.pow(1 - progress, 3);
          rotationRef.current = [
            showcaseMotion.startRotation[0] +
              (showcaseMotion.endRotation[0] - showcaseMotion.startRotation[0]) * eased,
            showcaseMotion.startRotation[1] +
              (showcaseMotion.endRotation[1] - showcaseMotion.startRotation[1]) * eased,
            0,
          ];
          zoomRef.current =
            showcaseMotion.startZoom +
            (showcaseMotion.targetZoom - showcaseMotion.startZoom) * eased;
          imperativeUpdate();
          if (progress === 1) showcaseMotion.settled = true;
        }
      } else if (!isDraggingRef.current && !hoveredRef.current && isInViewRef.current) {
        // Cap the background globe's frame rate to bound the d3 path budget.
        if (!bare || ts - lastFrameRef.current >= frameBudget) {
          lastFrameRef.current = ts;
          rotationRef.current = [
            rotationRef.current[0] + SPIN_DEGREES_PER_FRAME * (frameBudget / FRAME_BUDGET_MS),
            rotationRef.current[1],
            0,
          ];
          imperativeUpdate();
        }
      }
      autoRotateRef.current = requestAnimationFrame(spin);
    };

    autoRotateRef.current = requestAnimationFrame(spin);
    return () => {
      if (autoRotateRef.current) cancelAnimationFrame(autoRotateRef.current);
    };
  }, [isLoaded, imperativeUpdate, syncPathsState, bare, enhanced, initialZoom, markInteraction]);

  // Position markers once the globe is ready / counts change, and on resize.
  // While the globe rotates, the spin loop keeps them updated via imperativeUpdate.
  useEffect(() => {
    if (!isLoaded) return;
    const raf = requestAnimationFrame(() => {
      updateMarkers();
      updateShowcaseCard();
    });
    const onResize = () => {
      updateMarkers();
      updateShowcaseCard();
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [isLoaded, markerList, updateMarkers, updateShowcaseCard]);

  useEffect(() => {
    const el = cardRef.current;
    if (!el || !isLoaded) return;

    const handler = (e: WheelEvent) => {
      markInteraction();
      // Bare mode remains page-scroll-only; the listener just cancels the tour.
      if (bare) return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.94 : 1.06;
      zoomRef.current = Math.max(0.8, Math.min(2.5, zoomRef.current * factor));
      imperativeUpdate();
    };

    el.addEventListener("wheel", handler, { passive: bare });
    return () => el.removeEventListener("wheel", handler);
  }, [isLoaded, imperativeUpdate, bare, markInteraction]);

  const handleMouseDown = (e: React.MouseEvent) => {
    markInteraction();
    const svg = svgRef.current;
    if (svg && svg.contains(e.target as Node)) {
      isDraggingRef.current = true;
      setIsDragging(true);
      lastPosRef.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handleMouseUp = () => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      setIsDragging(false);
      lastPosRef.current = null;
      syncPathsState();
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingRef.current && cardRef.current) {
      const rect = cardRef.current.getBoundingClientRect();
      setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }

    if (isDraggingRef.current && lastPosRef.current) {
      const dx = e.clientX - lastPosRef.current.x;
      const dy = e.clientY - lastPosRef.current.y;

      rotationRef.current = [
        rotationRef.current[0] + dx * 0.4,
        Math.max(-90, Math.min(90, rotationRef.current[1] - dy * 0.4)),
        0,
      ];

      lastPosRef.current = { x: e.clientX, y: e.clientY };

      if (!dragFrameRef.current) {
        dragFrameRef.current = requestAnimationFrame(() => {
          imperativeUpdate();
          dragFrameRef.current = 0;
        });
      }
    }
  };

  const lastTouchDistRef = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    markInteraction();
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastTouchDistRef.current = Math.sqrt(dx * dx + dy * dy);
      return;
    }
    const touch = e.touches[0];
    const svg = svgRef.current;
    if (svg) {
      isDraggingRef.current = true;
      setIsDragging(true);
      lastPosRef.current = { x: touch.clientX, y: touch.clientY };
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && lastTouchDistRef.current !== null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const factor = dist / lastTouchDistRef.current;
      zoomRef.current = Math.max(0.8, Math.min(2.5, zoomRef.current * factor));
      lastTouchDistRef.current = dist;
      imperativeUpdate();
      return;
    }

    if (!isDraggingRef.current || !lastPosRef.current) return;

    const touch = e.touches[0];
    const dx = touch.clientX - lastPosRef.current.x;
    const dy = touch.clientY - lastPosRef.current.y;

    rotationRef.current = [
      rotationRef.current[0] + dx * 0.4,
      Math.max(-90, Math.min(90, rotationRef.current[1] - dy * 0.4)),
      0,
    ];

    lastPosRef.current = { x: touch.clientX, y: touch.clientY };

    if (!dragFrameRef.current) {
      dragFrameRef.current = requestAnimationFrame(() => {
        imperativeUpdate();
        dragFrameRef.current = 0;
      });
    }
  };

  const handleTouchEnd = () => {
    lastTouchDistRef.current = null;
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      setIsDragging(false);
      lastPosRef.current = null;
      syncPathsState();
    }
  };

  const easeToCountry = useCallback(
    (id: string, target: string) => {
      const d3 = d3Ref.current;
      if (!d3) {
        router.push(target);
        return;
      }
      const feature = featuresRef.current.find((f) => String(f.id) === id);
      if (!feature) {
        router.push(target);
        return;
      }
      const [lon, lat] = d3.geoCentroid(feature);
      const startRot = rotationRef.current.slice() as [number, number, number];
      const endRot: [number, number, number] = [-lon, -lat, 0];
      const startTs = performance.now();
      isDraggingRef.current = true;
      const tick = (ts: number) => {
        const p = Math.min(1, (ts - startTs) / 600);
        const e = 1 - Math.pow(1 - p, 3);
        rotationRef.current = [
          startRot[0] + (endRot[0] - startRot[0]) * e,
          startRot[1] + (endRot[1] - startRot[1]) * e,
          0,
        ];
        imperativeUpdate();
        if (p < 1) {
          requestAnimationFrame(tick);
        } else {
          isDraggingRef.current = false;
          syncPathsState();
          router.push(target);
        }
      };
      requestAnimationFrame(tick);
    },
    [imperativeUpdate, router, syncPathsState]
  );

  const handleCountryClick = (id: string) => {
    markInteraction();
    if (id.startsWith("bi:")) {
      const owner = id.slice(3).split(":")[0] as CountryId;
      const access = countryAccess?.[owner];
      if (!access) return;
      const availability = resolveCountryAvailability(owner, access);
      if (!availability.preferredPath) return;
      if (enhancedRef.current) {
        easeToCountry(id, availability.preferredPath);
        return;
      }
      router.push(availability.preferredPath);
      return;
    }

    const mapped = WORLD_MAPPED_COUNTRIES[id];
    if (!mapped?.path) return;

    const countryId = ISO_TO_COUNTRY_ID[id];
    if (countryId && countryAccess?.[countryId]) {
      const availability = resolveCountryAvailability(
        countryId as CountryId,
        countryAccess[countryId]
      );
      if (availability.preferredPath) {
        if (enhancedRef.current) {
          easeToCountry(id, availability.preferredPath);
          return;
        }
        router.push(availability.preferredPath);
        return;
      }
    }

    if (enhancedRef.current) {
      easeToCountry(id, mapped.path);
      return;
    }
    router.push(mapped.path);
  };

  const hoveredOverlayCountryId = hovered?.startsWith("bi:")
    ? (hovered.slice(3).split(":")[0] as CountryId)
    : undefined;
  const hoveredMapped = hoveredOverlayCountryId
    ? {
        label: resolveCountryName(hoveredOverlayCountryId),
        status:
          COUNTRY_CONFIGS[hoveredOverlayCountryId].status === "coming-soon"
            ? ("planned" as const)
            : COUNTRY_CONFIGS[hoveredOverlayCountryId].status,
        path: COUNTRY_CONFIGS[hoveredOverlayCountryId].overviewPath,
      }
    : hovered
      ? WORLD_MAPPED_COUNTRIES[hovered]
      : null;
  const hoveredCountryId = hoveredOverlayCountryId ?? (hovered ? ISO_TO_COUNTRY_ID[hovered] : null);
  const hoveredCountryAccess =
    hoveredCountryId && countryAccess?.[hoveredCountryId]
      ? {
          [hoveredCountryId]: countryAccess[hoveredCountryId],
        }
      : undefined;
  const tooltipAccess =
    hoveredOverlayCountryId && countryAccess?.[hoveredOverlayCountryId]
      ? (() => {
          const availability = resolveCountryAvailability(
            hoveredOverlayCountryId,
            countryAccess[hoveredOverlayCountryId]
          );
          return {
            label: availability.label,
            tone: availability.tone,
            econOnly: availability.displayState === "econ-only" ? (true as const) : undefined,
          };
        })()
      : hovered
        ? getMapTooltipAccessDisplay(hovered, hoveredMapped?.status, hoveredCountryAccess)
        : null;
  const showLandingClickHint = Boolean(
    hoveredMapped?.path &&
    tooltipAccess &&
    (tooltipAccess.tone === "active" || tooltipAccess.tone === "beta" || tooltipAccess.econOnly)
  );

  return (
    <div
      className={
        bare
          ? "relative h-full w-full flex flex-col"
          : isBroadsheet
            ? "relative h-full min-h-[400px] flex flex-col"
            : "relative overflow-hidden rounded-2xl border-2 border-card-border bg-card shadow-lg h-full min-h-[400px] flex flex-col ring-1 ring-black/5"
      }
      style={isBroadsheet && !bare ? { background: "transparent", color: "#16161d" } : undefined}
    >
      {gameDate && !isBroadsheet && !bare && (
        <div className="flex items-center gap-2 border-b border-card-border px-4 py-2.5 bg-card/80">
          {!hideLiveIndicator && (
            <span className="relative flex h-1.5 w-1.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
            </span>
          )}
          <span className="text-xs font-semibold tracking-wide text-foreground">{gameDate}</span>
          {!hideLiveIndicator && (
            <span className="ml-auto text-[10px] uppercase tracking-widest text-muted font-medium">
              Live
            </span>
          )}
        </div>
      )}
      <div
        ref={cardRef}
        className={
          bare
            ? "flex-1 flex items-center justify-center"
            : isBroadsheet
              ? "flex-1 flex items-center justify-center p-3 sm:p-4"
              : "flex-1 flex items-center justify-center bg-card-muted/10 p-3 sm:p-4"
        }
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => {
          handleMouseUp();
          hoveredRef.current = null;
          setHovered(null);
          setTooltipPos(null);
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        style={{ cursor: isDragging ? "grabbing" : "grab", touchAction: "none" }}
      >
        {!isLoaded && (
          <div
            className="flex w-full items-center justify-center p-6"
            style={{ aspectRatio: `${LANDING_SVG_W}/${LANDING_SVG_H}` }}
          >
            <Skeleton className="aspect-square w-full max-w-[420px] rounded-full" />
          </div>
        )}

        {isLoaded && (
          <MapSVGContent
            layout={LANDING_LAYOUT}
            svgRef={svgRef}
            sphereRef={sphereRef}
            graticuleRef={graticuleRef}
            warBorderPathRef={warBorderPathRef}
            pathRefsMap={pathRefsMap}
            features={featuresRef.current}
            warBorderInitialD={warBorderInitialDRef.current}
            paths={paths}
            hovered={hovered}
            isAnimating={false}
            hasActiveFilter={!!countryAccess}
            isFullscreen={false}
            getCountryColor={passThroughCountryColor}
            tierLookup={tierLookup}
            enhanced={enhanced}
            wireframeColor={wireframeColor}
            arcs={enhanced && !bare ? arcsData : undefined}
            arcRefs={arcRefsMap}
            hotspots={enhanced && !bare ? hotspotsData : undefined}
            hotspotRefs={hotspotRefsMap}
            starfield={enhanced ? starfieldData : undefined}
            haloRef={haloRef}
            playableCountryIds={bare && enhanced ? highlightedCountryIds : undefined}
            playablePathRefs={playablePathRefsMap}
            crisisCountryId={showcaseEntry?.countryId}
            isAnimatingRef={isAnimatingRef}
            viewModeRef={viewModeRef}
            hoveredRef={hoveredRef}
            syncPathsState={syncPathsState}
            onHover={setHovered}
            onTooltipClear={() => setTooltipPos(null)}
            onCountryClick={handleCountryClick}
          />
        )}

        {isLoaded && (markerList.length > 0 || showcaseEntry) && (
          <div
            ref={markersOverlayRef}
            className="pointer-events-none absolute inset-0 overflow-visible"
          >
            <svg
              ref={leadersSvgRef}
              className="absolute inset-0 h-full w-full overflow-visible"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {markerList.map((m) => (
                <g key={m.id}>
                  <line
                    ref={(el) => {
                      if (el) leaderLineRefsMap.current.set(m.id, el);
                    }}
                    stroke="rgba(255,255,255,0.42)"
                    strokeWidth={1}
                    style={{ opacity: 0, transition: "opacity 0.7s ease-out" }}
                  />
                  <circle
                    ref={(el) => {
                      if (el) leaderDotRefsMap.current.set(m.id, el);
                    }}
                    r={2.6}
                    fill="#fff"
                    style={{
                      opacity: 0,
                      transition: "opacity 0.7s ease-out",
                      filter: "drop-shadow(0 0 5px rgba(255,255,255,0.7))",
                    }}
                  />
                </g>
              ))}
              {showcaseEntry && (
                <g>
                  <line
                    ref={showcaseLeaderLineRef}
                    stroke="var(--warning)"
                    strokeWidth={1.2}
                    style={{ opacity: 0 }}
                  />
                  <circle
                    ref={showcaseLeaderDotRef}
                    r={3}
                    fill="var(--warning)"
                    style={{ opacity: 0, filter: "drop-shadow(0 0 6px rgba(0,0,0,0.6))" }}
                  />
                </g>
              )}
            </svg>
            {markerList.map((m) => (
              <div
                key={m.id}
                ref={(el) => {
                  if (el) markerRefsMap.current.set(m.id, el);
                }}
                className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-center"
                style={{ left: 0, top: 0, opacity: 0, transition: "opacity 0.25s linear" }}
              >
                <div className="flex flex-col gap-px rounded-[11px] border border-white/25 bg-white/10 px-3 py-1.5 shadow-[0_10px_24px_-10px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.32)] backdrop-blur-md">
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.55)]">
                    {m.label}
                  </span>
                  <span className="text-[11px] text-white/80">
                    <b className="font-bold tabular-nums text-white">{m.count}</b> playing
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {bare ? null : isBroadsheet ? (
        <>
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: 18,
              padding: "10px 4px 4px",
              fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
              fontSize: 11,
              color: "#3a3a44",
              flexWrap: "wrap",
            }}
          >
            {TIER_ORDER.map((tier) => (
              <div key={tier} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: TIER_COLORS[tier],
                    display: "inline-block",
                  }}
                />
                {TIER_LABELS[tier]}
              </div>
            ))}
          </div>
          <div
            style={{
              padding: "4px 4px 0",
              fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
              fontSize: 10.5,
              color: "#6b6b75",
              textAlign: "center",
              letterSpacing: 0.3,
            }}
          >
            Drag to rotate. Scroll to zoom. Click a country to enter.
          </div>
        </>
      ) : (
        <div className="border-t border-card-border bg-card/50 p-4 backdrop-blur-sm">
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs text-muted">
            {TIER_ORDER.map((tier) => (
              <TierLegendSwatch key={tier} tier={tier} />
            ))}
          </div>
        </div>
      )}

      {hoveredMapped && tooltipPos && tooltipAccess && (
        <MapTooltip
          countryLabel={hoveredMapped.label}
          position={tooltipPos}
          access={tooltipAccess}
          showClickHint={showLandingClickHint}
        />
      )}
      {/* Bare mode has no card chrome to hang a legend on, so the four tiers
          get a small fixed key portalled to the body. Four labels are worth
          naming now that Background Nations is an explicit tier. */}
      {bare &&
        isLoaded &&
        tierLookup &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="pointer-events-none fixed bottom-4 right-4 z-20 hidden flex-col gap-1.5 rounded-lg border border-white/10 bg-black/35 px-3 py-2.5 backdrop-blur-sm transition-opacity duration-500 sm:flex"
            style={{ opacity: showcaseEntry || globeScrolledAway ? 0 : 0.85 }}
            aria-hidden="true"
          >
            {TIER_ORDER.map((tier) => (
              <span key={tier} className="inline-flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                  style={{
                    background: wireframeColor
                      ? tierWireframeFill(tier, wireframeColor)
                      : TIER_COLORS[tier],
                    outline: wireframeColor ? `1px solid ${wireframeColor}` : undefined,
                  }}
                />
                <span
                  className="font-mono text-[10px] uppercase tracking-[0.12em]"
                  style={{ color: wireframeColor ?? "rgba(255,255,255,0.72)" }}
                >
                  {TIER_LABELS[tier]}
                </span>
              </span>
            ))}
          </div>,
          document.body
        )}

      {showcaseEntry &&
        typeof document !== "undefined" &&
        createPortal(
          <aside
            ref={showcaseCardRef}
            key={showcaseEntry.id}
            className="pointer-events-none fixed z-20 w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 animate-in fade-in slide-in-from-bottom-2 duration-500 motion-reduce:animate-none"
            style={{ left: "50%", top: "50%" }}
            aria-live="polite"
            aria-labelledby={`showcase-${showcaseEntry.id}`}
          >
            <div className="overflow-hidden rounded-xl border border-card-border bg-card/90 shadow-2xl backdrop-blur-md">
              <div className="relative h-20 w-full overflow-hidden">
                <Image
                  src={cdnStatic("landing", showcaseEntry.imageSlug ?? "newsroom")}
                  alt=""
                  fill
                  sizes="352px"
                  unoptimized={bypassNextImageOptimization(
                    cdnStatic("landing", showcaseEntry.imageSlug ?? "newsroom")
                  )}
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                  className="object-cover object-center"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-card/95 via-transparent to-black/10" />
              </div>
              <div className="p-4 pt-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <Badge color="warning" variant="tag">
                    Historical crisis
                  </Badge>
                  <span className="font-mono text-body-xs tabular-nums text-muted">
                    {showcaseEntry.year}
                  </span>
                </div>
                <h2
                  id={`showcase-${showcaseEntry.id}`}
                  className="text-heading-sm font-semibold text-foreground"
                >
                  {showcaseEntry.title}
                </h2>
                <p className="mt-1.5 text-body-sm leading-relaxed text-muted">
                  {showcaseEntry.description}
                </p>
              </div>
            </div>
          </aside>,
          document.body
        )}
    </div>
  );
}
