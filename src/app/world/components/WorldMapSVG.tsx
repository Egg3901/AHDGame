"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  WORLD_GEO_URL,
  SVG_W,
  SVG_H,
  TRANSLATE,
  ORTHO_SCALE,
  ANIM_DURATION,
  MAP_COLORS,
  easeInOutCubic,
} from "../worldConstants";
import { WORLD_COUNTRY_ISO_TO_ID, WORLD_MAPPED_COUNTRIES } from "@/lib/worldCountryRegistry";
import MapControls from "./MapControls";
import MapTooltip from "./MapTooltip";
import MapSVGContent, { BACKGROUND_LAYER_KEY } from "./MapSVGContent";
import { buildTierLookup, isTierInteractive } from "@/components/landing/countryTiers";
import { buildBlocLookup, hasBlocData, BLOC_LABELS } from "../worldBlocs";
import type { BlocMembership } from "@/lib/world/blocMembership";
import { REGION_SHARDS } from "@/lib/maps/regionManifest";
import { computeRegionBlobs, selectStructuralOverlayShards } from "@/lib/maps/regionOverlay";
import { WORLD_OVERLAY_OWNER_FOLD } from "@/lib/maps/germanyGeometry";
import { VIETNAM_BASE_FEATURE_ID, VIETNAM_GEO_URL } from "@/lib/maps/vietnamGeometry";
import { HISTORICAL_GEO_URL } from "@/lib/maps/historicalGeometry";
import { simplifyForGlobe } from "@/lib/maps/simplifyForGlobe";
import GlobeMetricPanel from "./GlobeMetricPanel";
import type { CountryAccessMap } from "../page";
import { useWorldMetricFilter } from "../WorldMetricFilterContext";
import {
  getCategoryAverageLabel,
  getMapTooltipAccessDisplay,
  getMetricFilterHighlight,
  ISO_TO_COUNTRY_ID,
} from "../worldMetricHighlight";
import { getCountryDisplayName, type CountryId } from "@/lib/constants/countries";
import { useActivePreset } from "@/contexts/RegisteredCountriesContext";
import type { WorldEntityMapSnapshot } from "@/lib/world/worldEntityMap";

export default function WorldMapSVG({
  countryAccess,
  worldEntities,
  blocMembership,
}: {
  countryAccess: CountryAccessMap;
  worldEntities: WorldEntityMapSnapshot;
  blocMembership: BlocMembership;
}) {
  const router = useRouter();
  const preset = useActivePreset();
  const { metricFilter, setMetricFilter, worldMetrics, partyData, corpsData, countryIdToIso } =
    useWorldMetricFilter();

  // --- React state ---
  const [viewMode, setViewMode] = useState<"map" | "globe">("globe");
  const [hovered, setHovered] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [paths, setPaths] = useState<Map<string, string | null>>(new Map());
  const [isFullscreen, setIsFullscreen] = useState(false);

  // --- Four-tier / bloc coloring -------------------------------------------
  // Tier rosters come straight from the era's world-entity manifest snapshot
  // (already fetched server-side for this page), so /world never maintains a
  // second hand-written list the way the landing bundle has to.
  const { economicPowerFeatureIds, battlegroundFeatureIds } = useMemo(() => {
    const economic: string[] = [];
    const battleground: string[] = [];
    for (const [featureId, item] of Object.entries(worldEntities.byFeatureId)) {
      if (item.simulationTier === "full-autonomous") economic.push(featureId);
      else if (item.simulationTier === "sphere-macro") battleground.push(featureId);
    }
    return { economicPowerFeatureIds: economic, battlegroundFeatureIds: battleground };
  }, [worldEntities]);

  /**
   * Feature id → tier, built once per era rather than per path per frame. An
   * absent key means Background Nations, which are drawn as a single inert
   * merged path instead of ~120 interactive ones.
   */
  const tierLookup = useMemo(
    () =>
      buildTierLookup(
        ISO_TO_COUNTRY_ID,
        countryAccess,
        battlegroundFeatureIds,
        economicPowerFeatureIds
      ),
    [countryAccess, battlegroundFeatureIds, economicPowerFeatureIds]
  );

  /**
   * Bloc colours come from the live roll, scoped to what the globe already draws
   * as interactive — so a country the era names but no alliance has claimed
   * reads as non-aligned, while a background non-member stays out of it.
   */
  const blocLookup = useMemo(
    () =>
      buildBlocLookup({
        presetId: preset,
        membership: blocMembership,
        interactiveFeatureIds: [...tierLookup]
          .filter(([, tier]) => isTierInteractive(tier))
          .map(([featureId]) => featureId),
      }),
    [preset, blocMembership, tierLookup]
  );

  /**
   * Tier rendering owns the map in the two "structural" modes. The data
   * heatmaps (overall / category / metric / party / corps) still need every
   * feature individually paintable, so they fall back to the legacy path.
   */
  const useTierRendering = metricFilter.type === "none" || metricFilter.type === "blocs";
  const activeTierLookup = useTierRendering ? tierLookup : undefined;
  const activeBlocLookup = metricFilter.type === "blocs" ? blocLookup : undefined;
  const tierLookupRef = useRef(activeTierLookup);
  tierLookupRef.current = activeTierLookup;
  // Mirrored into a ref for the same reason as the tier lookup: the per-frame
  // updater below runs outside React and must not close over a stale value.
  const blocLookupRef = useRef(activeBlocLookup);
  blocLookupRef.current = activeBlocLookup;

  /** Convert a 0-100 score to a heatmap color (red→yellow→green) */
  const scoreToColor = (score: number): string => {
    // 0 = deep red, 50 = yellow-orange, 100 = green
    if (score >= 75) {
      // green range
      const t = (score - 75) / 25;
      return `rgba(34, ${160 + Math.round(t * 40)}, ${80 + Math.round(t * 20)}, 0.85)`;
    }
    if (score >= 50) {
      // yellow-green
      const t = (score - 50) / 25;
      return `rgba(${180 - Math.round(t * 146)}, ${140 + Math.round(t * 20)}, ${40 + Math.round(t * 40)}, 0.85)`;
    }
    if (score >= 25) {
      // orange-yellow
      const t = (score - 25) / 25;
      return `rgba(${220 - Math.round(t * 40)}, ${80 + Math.round(t * 60)}, 30, 0.8)`;
    }
    // red range
    const t = score / 25;
    return `rgba(${160 + Math.round(t * 60)}, ${30 + Math.round(t * 50)}, 30, 0.75)`;
  };

  /** Convert corps count to intensity color (light → dark blue) */
  const corpsCountToColor = (count: number, maxCount: number): string => {
    if (maxCount <= 0) return "rgba(59, 130, 246, 0.2)";
    const t = Math.min(1, count / maxCount);
    // Light blue (low) → deep blue (high)
    const r = Math.round(219 - t * 160);
    const g = Math.round(234 - t * 130);
    const b = Math.round(254 - t * 40);
    const alpha = 0.4 + t * 0.55;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  const getCountryColor = useCallback(
    (id: string, defaultColor: string) => {
      // Econ-only tint when no filter is active.
      if (metricFilter.type === "none") {
        const countryId = ISO_TO_COUNTRY_ID[id];
        if (countryId && countryAccess[countryId]) {
          // Every country in `countryAccess` is registered, so "not enabled for
          // players" is exactly the econ-only tier. Intentionally NOT gated on
          // `status` — a "beta" country can sit here too.
          if (!countryAccess[countryId].enabledForPlayers) {
            return MAP_COLORS.econOnly;
          }
        }
        return defaultColor;
      }

      if (metricFilter.type === "party") {
        return partyData[id]?.partyColor || defaultColor;
      }

      if (metricFilter.type === "corps") {
        const entry = corpsData?.countries[id];
        if (!entry) return defaultColor;
        return corpsCountToColor(entry.count, corpsData?.maxCount ?? 1);
      }

      // All other filters require world metrics data
      const country = worldMetrics?.countries[id];
      if (!country?.hasData) return defaultColor;

      if (metricFilter.type === "overall") {
        if (country.overallScore === null) return defaultColor;
        return scoreToColor(country.overallScore);
      }

      if (metricFilter.type === "category") {
        const catScore = country.categoryScores[metricFilter.categoryId];
        if (catScore === null || catScore === undefined) return defaultColor;
        return scoreToColor(catScore);
      }

      if (metricFilter.type === "metric") {
        const metricEntry = country.categories[metricFilter.categoryId]?.[metricFilter.metricId];
        if (metricEntry?.score === null || metricEntry?.score === undefined) return defaultColor;
        return scoreToColor(metricEntry.score);
      }

      return defaultColor;
    },
    [metricFilter, worldMetrics, partyData, corpsData, countryAccess]
  );

  // --- Refs (no re-renders) ---
  const cardRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pathRefsMap = useRef<Map<string, SVGPathElement>>(new Map());
  /**
   * The `d` string most recently WRITTEN to each path by the imperative loop.
   *
   * React state (`paths`) goes stale the moment the globe rotates, because
   * rotation updates the DOM directly and deliberately skips React. Without
   * this, any re-render — a hover, a tooltip — would repaint every country from
   * the stale state and snap the globe back to where it was at the last sync,
   * which is why hover used to force a full `syncPathsState()` reprojection.
   */
  const livePathsRef = useRef<Map<string, string | null>>(new Map());
  const sphereRef = useRef<SVGCircleElement>(null);
  const graticuleRef = useRef<SVGPathElement>(null);
  const warBorderPathRef = useRef<SVGPathElement>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const warBorderFeatureRef = useRef<any>(null);
  const warBorderInitialDRef = useRef<string>("");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const featuresRef = useRef<any[]>([]);
  const centroidsRef = useRef<Map<string, [number, number]>>(new Map());
  // Countries whose landmass is fully drawn by a region-overlay `bi:` blob — their
  // base countries-110m feature is hidden so its internal borders (e.g. the
  // UK↔Republic line across Ireland) don't bleed through the overlay. (The `bi:`
  // id prefix is historical — originally British Isles, now any manifest shard.)
  const biCoveredRef = useRef<Set<string>>(new Set());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graticuleDataRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d3Ref = useRef<any>(null);
  const eeScaleRef = useRef(148);

  const viewModeRef = useRef<"map" | "globe">("globe");
  const rotationRef = useRef<[number, number, number]>([0, 0, 0]);
  const mapPanRef = useRef<[number, number]>([0, 0]);
  const zoomRef = useRef(1);
  const hoveredRef = useRef<string | null>(null);
  const isDraggingRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const isAnimatingRef = useRef(false);
  const animFrameRef = useRef(0);
  const dragFrameRef = useRef(0);
  const autoRotateRef = useRef(0);

  // --- Imperative path update for current viewMode (drag, zoom, auto-rotate) ---
  const imperativeUpdate = useCallback(() => {
    const d3 = d3Ref.current;
    if (!d3 || !featuresRef.current.length) return;

    const z = zoomRef.current;
    let proj;
    if (viewModeRef.current === "map") {
      proj = d3
        .geoEqualEarth()
        .scale(eeScaleRef.current * z)
        .translate([TRANSLATE[0] + mapPanRef.current[0], TRANSLATE[1] + mapPanRef.current[1]]);
    } else {
      proj = d3
        .geoOrthographic()
        .scale(ORTHO_SCALE * z)
        .translate(TRANSLATE)
        .rotate(rotationRef.current)
        .clipAngle(90 + 1e-6);
    }

    const pathGen = d3.geoPath(proj);
    const lookup = tierLookupRef.current;
    const blocs = blocLookupRef.current;
    // Background Nations are accumulated into ONE `d` string written once,
    // instead of ~120 individual setAttribute calls every animation frame.
    //
    // A background nation that belongs to a BLOC is excluded here, exactly as it
    // is excluded from the merged layer in MapSVGContent. The two rules have to
    // agree: when only the renderer knew about bloc members, they were drawn
    // once at mount and then never reprojected — so Canada and the Benelux sat
    // frozen in place while the globe turned under them, AND their geometry went
    // into the merged layer as well, drawing them twice.
    let backgroundD = "";
    for (const feature of featuresRef.current) {
      const id = String(feature.id);
      if (lookup && !isTierInteractive(lookup.get(id) ?? "background") && !blocs?.get(id)) {
        const d = pathGen(feature);
        // Recorded like any other feature: `commitLivePaths` re-derives the
        // merged layer from these, so hovering must not blank the background.
        livePathsRef.current.set(id, d);
        if (d) backgroundD += d;
        continue;
      }
      const el = pathRefsMap.current.get(id);
      if (!el) continue;
      const d = pathGen(feature);
      // Remember the geometry this frame actually drew, so a re-render caused by
      // hover can repaint at the CURRENT rotation without reprojecting the world
      // (see commitLivePaths).
      livePathsRef.current.set(id, d);
      if (d) {
        el.setAttribute("d", d);
        el.style.opacity = "1";
      } else {
        el.style.opacity = "0";
      }
    }
    if (lookup) {
      const backgroundEl = pathRefsMap.current.get(BACKGROUND_LAYER_KEY);
      if (backgroundEl) backgroundEl.setAttribute("d", backgroundD);
    }

    if (graticuleRef.current && graticuleDataRef.current) {
      const d = pathGen(graticuleDataRef.current);
      if (d) graticuleRef.current.setAttribute("d", d);
    }

    if (sphereRef.current && viewModeRef.current === "globe") {
      sphereRef.current.setAttribute("r", String(ORTHO_SCALE * z));
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
  }, []);

  /**
   * Publish the geometry the imperative loop already drew into React state,
   * WITHOUT reprojecting anything.
   *
   * This is what hover and drag-release use. Both used to call
   * `syncPathsState()`, which re-ran `d3.geoPath` over every feature — a full
   * world reprojection per mouse-enter, on top of the re-render — even though
   * neither changes the projection at all. Hover only changes a stroke.
   */
  const commitLivePaths = useCallback(() => {
    if (!livePathsRef.current.size) return;
    setPaths(new Map(livePathsRef.current));
  }, []);

  // --- Sync React paths state with current projection (view/zoom changes) ---
  const syncPathsState = useCallback(() => {
    const d3 = d3Ref.current;
    if (!d3 || !featuresRef.current.length) return;

    const z = zoomRef.current;
    let proj;
    if (viewModeRef.current === "map") {
      proj = d3
        .geoEqualEarth()
        .scale(eeScaleRef.current * z)
        .translate([TRANSLATE[0] + mapPanRef.current[0], TRANSLATE[1] + mapPanRef.current[1]]);
    } else {
      proj = d3
        .geoOrthographic()
        .scale(ORTHO_SCALE * z)
        .translate(TRANSLATE)
        .rotate(rotationRef.current)
        .clipAngle(90 + 1e-6);
    }

    const pathGen = d3.geoPath(proj);
    const newPaths = new Map<string, string | null>();
    for (const feature of featuresRef.current) {
      newPaths.set(String(feature.id), pathGen(feature));
    }
    livePathsRef.current = new Map(newPaths);

    if (graticuleRef.current && graticuleDataRef.current) {
      graticuleRef.current.setAttribute("d", pathGen(graticuleDataRef.current) || "");
      graticuleRef.current.style.opacity = viewModeRef.current === "globe" ? "0.3" : "0";
    }
    if (sphereRef.current) {
      sphereRef.current.style.opacity = viewModeRef.current === "globe" ? "1" : "0";
      if (viewModeRef.current === "globe") {
        sphereRef.current.setAttribute("r", String(ORTHO_SCALE * z));
      }
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

    setPaths(newPaths);
  }, []);

  // --- Load d3-geo + topojson data on mount ---
  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [d3, topojson] = await Promise.all([import("d3-geo"), import("topojson-client")]);
      if (cancelled) return;
      d3Ref.current = d3;

      const resp = await fetch(WORLD_GEO_URL);
      const topo = await resp.json();
      if (cancelled) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const geojson = (topojson as any).feature(topo, topo.objects.countries);

      // The two Vietnams. Static features rather than a region shard, because
      // the shard machinery resolves owners from `states` and neither is a full
      // country (see vietnamGeometry). Unified Vietnam's 704 is dropped: it does
      // not exist in 1953, and leaving it would draw an uncoloured background
      // country underneath both halves.
      try {
        const vnResp = await fetch(VIETNAM_GEO_URL, { cache: "no-store" });
        if (vnResp.ok) {
          const vn = await vnResp.json();
          if (vn?.features?.length) {
            geojson.features = geojson.features.filter(
              (f: { id?: unknown }) => String(f.id) !== VIETNAM_BASE_FEATURE_ID
            );
            geojson.features.push(...vn.features);
          }
        }
      } catch {
        // Best-effort, exactly like the region overlay: without it Vietnam draws
        // as one unified background country rather than not at all.
      }

      featuresRef.current = geojson.features;

      const centroids = new Map<string, [number, number]>();
      for (const f of geojson.features) {
        centroids.set(String(f.id), d3.geoCentroid(f));
      }

      // Region overlay: geometrically UNION each owning country's regions into one
      // blob so it reads as a single nation — one national outline, no internal
      // region lines — and a region that changes country (NI reunifying; the
      // eastern Länder under DD in 1979) moves between blobs, the internal border
      // vanishing as they fuse. A true union (not an arc merge) is required because
      // some source regions come from independently-digitized datasets whose shared
      // borders don't share vertices; an arc merge leaves those as coincident lines.
      // Structural shards feed this loop (splits + multi-base silhouettes). Pure
      // homeland-detail shards keep their countries-110m base. Region codes are
      // globally disjoint, so each owner's blob falls out (UK/IE, DE/DD, USSR, …).
      // Appended AFTER the country features so they draw on top.
      //
      // A source is only overlaid when EVERY one of its regions is owned. Hiding a
      // base country polygon (biCovered) but leaving part of it un-blobbed would
      // show the hidden background through the gap — e.g. mid-reset, before East
      // Germany's Länder seed, the west is DE-owned but the east is ownerless, which
      // would render East Germany as ocean. A partially-owned source is skipped so
      // its base polygon (e.g. unified Germany) draws normally until seeding
      // completes. The British Isles is always fully seeded; Germany can be
      // transiently partial mid-reset (same for any future split shard).
      try {
        // Only overlay shards flagged mergeable — a shard whose regions don't union
        // cleanly (Brazil) keeps its clean base polygon (manifest worldOverlay:false).
        // Ownership is fetched FIRST so we can skip downloading homeland-detail
        // shards that structural mode will not overlay — that download+parse was
        // the main first-open hitch on mobile (USA/France/Japan/… GeoJSON).
        const candidateShards = REGION_SHARDS.filter((s) => s.worldOverlay !== false);
        const [pcMod, ownResp] = await Promise.all([
          import("polygon-clipping"),
          fetch("/api/maps/region-ownership", { cache: "no-store" }).then((r) => r.json()),
        ]);
        const ownership: Record<string, string> = ownResp?.ownership ?? {};
        const overlayShards = selectStructuralOverlayShards(candidateShards, ownership);
        const shardGeos = cancelled
          ? []
          : await Promise.all(
              overlayShards.map((s) => fetch(s.url, { cache: "no-store" }).then((r) => r.json()))
            );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sources: any[] = shardGeos;
        if (!cancelled && sources.some((s) => s?.features?.length)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const polygonClipping: any = (pcMod as any).default ?? pcMod;
          // Structural overlays only: splits (DE/DD) and multi-base silhouettes
          // (USSR, YU, …). Single-homeland detail shards (USA/France/Japan/…) stay
          // on their countries-110m polygons — at globe scale the extra coastline
          // is invisible, and projecting it every frame was ~30× slower than the
          // landing globe. No homeland fusion: an acquirer's blob sits adjacent
          // to its base polygon in the same colour.
          const { blobs, coveredBases } = computeRegionBlobs(
            overlayShards.map((s, i) => ({
              baseCountryIds: s.baseCountryIds,
              features: sources[i]?.features ?? [],
            })),
            ownership,
            WORLD_OVERLAY_OWNER_FOLD,
            polygonClipping,
            "structural"
          );
          for (const [owner, solidCW] of blobs) {
            const coordinates = simplifyForGlobe(
              solidCW.map((poly) =>
                poly.map((ring) => {
                  // Re-wrap any unwrapped (>180) longitudes back into −180..180 — the
                  // soviet-union shard is authored unwrapped (Far East past the
                  // antimeridian) for the flat nation map; the union is clean in that
                  // continuous space, but d3's antimeridian clipping needs standard
                  // coords to render the blob on the globe + flat world map.
                  const wrapped = ring.map(([lon, lat]) => [lon > 180 ? lon - 360 : lon, lat]);
                  // Orient each ring so its spherical interior is the SMALLER region —
                  // d3 then fills the blob as land (a ring whose winding makes the
                  // interior the whole sphere would otherwise flood the globe).
                  return d3.geoArea({ type: "Polygon", coordinates: [wrapped] }) > 2 * Math.PI
                    ? [...wrapped].reverse()
                    : wrapped;
                })
              )
            );
            if (!coordinates.length) continue;
            const blob = {
              type: "Feature",
              id: `bi:${owner}`,
              properties: { ownerCountryId: owner },
              geometry: { type: "MultiPolygon", coordinates },
            };
            geojson.features.push(blob);
            centroids.set(`bi:${owner}`, d3.geoCentroid(blob));
          }
          biCoveredRef.current = coveredBases;
          // Covered bases are not mounted in the DOM — drop them from the
          // projection loop so we don't pay geoPath for geometry nobody draws.
          if (coveredBases.size) {
            geojson.features = geojson.features.filter(
              (f: { id?: unknown; properties?: { name?: string } }) => {
                const id = String(f.id);
                if (id.startsWith("bi:")) return true;
                const countryId = WORLD_COUNTRY_ISO_TO_ID[id];
                const featureName = f.properties?.name;
                return (
                  !coveredBases.has(id) &&
                  !(countryId && coveredBases.has(countryId)) &&
                  !(featureName && coveredBases.has(featureName))
                );
              }
            );
            featuresRef.current = geojson.features;
          }
        }
      } catch {
        // overlay is best-effort — the base country map still renders without it
      }

      // The historical territories — protectorates, trust territories and
      // international zones that sit INSIDE a modern country and so have no ISO
      // numeric of their own. Unlike Vietnam these do NOT replace a base feature:
      // the Saar is drawn on top of Germany and Zanzibar on top of Tanzania, and
      // dropping the host would erase a country that very much exists in 1953.
      //
      // ⚠️ Appended LAST — after the region-overlay blobs, not merely after the base
      // countries. d3 draws in array order, so appending earlier buried the two whose
      // host HAS a region shard (the Saar is one of Germany's Länder; Trieste sits
      // inside Italy's macro-regions) under their host's blob, and they disappeared.
      // Every step above this point only appends to `geojson.features` or replaces it
      // wholesale, so this is the one position nothing later can cover or filter out.
      //
      // Placed AFTER the overlay's try/catch rather than inside it: that block
      // swallows its own failures, so control reaches here whether or not the
      // overlay rendered, and a failed overlay must not also cost us these.
      //
      // This ordering bites in the HEATMAP modes. In the structural modes these are
      // background-tier and merged into one silhouette drawn before every individual
      // path, so they are not separately visible there at any position — see the
      // tier note in historicalGeometry.
      try {
        const histResp = await fetch(HISTORICAL_GEO_URL, { cache: "no-store" });
        if (histResp.ok) {
          const hist = await histResp.json();
          for (const f of hist?.features ?? []) {
            geojson.features.push(f);
            // The centroid pass ran before these existed, so each one is set here —
            // without it every label and zoom-to lookup misses these territories.
            centroids.set(String(f.id), d3.geoCentroid(f));
          }
          featuresRef.current = geojson.features;
        }
      } catch {
        // Best-effort: without it those territories are simply not drawn, which is
        // the behaviour that shipped before they existed.
      }

      centroidsRef.current = centroids;

      const eeProj = d3.geoEqualEarth().fitSize([SVG_W, SVG_H], { type: "Sphere" });
      eeScaleRef.current = eeProj.scale();

      graticuleDataRef.current = d3.geoGraticule10();

      // Default to globe projection
      const initProj = d3
        .geoOrthographic()
        .scale(ORTHO_SCALE)
        .translate(TRANSLATE)
        .rotate(rotationRef.current)
        .clipAngle(90 + 1e-6);
      const pathGen = d3.geoPath(initProj);
      const initialPaths = new Map<string, string | null>();
      for (const f of geojson.features) {
        initialPaths.set(String(f.id), pathGen(f));
      }
      livePathsRef.current = new Map(initialPaths);
      setPaths(initialPaths);
      setIsLoaded(true);
    }

    load();

    return () => {
      cancelled = true;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (dragFrameRef.current) cancelAnimationFrame(dragFrameRef.current);
      if (autoRotateRef.current) cancelAnimationFrame(autoRotateRef.current);
    };
  }, []);

  // --- Auto-rotation loop (runs only while the globe is on screen and idle) ---
  useEffect(() => {
    if (!isLoaded) return;
    const card = cardRef.current;

    // The loop reprojects the world every frame, so it must not run for a globe
    // nobody is looking at. Scrolling the map out of view or backgrounding the
    // tab previously kept a full-rate d3 reprojection running forever.
    let onScreen = true;
    const observer =
      card && typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(
            (entries) => {
              onScreen = entries.some((entry) => entry.isIntersecting);
            },
            { threshold: 0 }
          )
        : null;
    observer?.observe(card as Element);

    // Cap idle spin at ~30fps. Drag/zoom still call imperativeUpdate directly
    // at full rate; this only throttles the background autorotate that nobody
    // is steering.
    const SPIN_FRAME_MS = 1000 / 30;
    let lastSpinAt = 0;
    const spin = (now: number) => {
      if (
        onScreen &&
        !document.hidden &&
        viewModeRef.current === "globe" &&
        !isDraggingRef.current &&
        !isAnimatingRef.current &&
        !hoveredRef.current &&
        now - lastSpinAt >= SPIN_FRAME_MS
      ) {
        lastSpinAt = now;
        // Two 60fps ticks' worth of rotation per 30fps frame so angular speed
        // matches the previous 0.12°/raf cadence.
        rotationRef.current = [rotationRef.current[0] + 0.24, rotationRef.current[1], 0];
        imperativeUpdate();
      }
      autoRotateRef.current = requestAnimationFrame(spin);
    };

    autoRotateRef.current = requestAnimationFrame(spin);
    return () => {
      observer?.disconnect();
      if (autoRotateRef.current) cancelAnimationFrame(autoRotateRef.current);
    };
  }, [isLoaded, imperativeUpdate]);

  /**
   * Switching between a structural view (Blocs / Tiers) and a data heatmap
   * changes WHICH features get their own path element — Background Nations are
   * merged into one inert layer in tier mode and split back out otherwise. The
   * newly mounted paths would otherwise take their `d` from stale React state
   * and snap the globe back to wherever it was at the last sync.
   */
  useEffect(() => {
    if (!isLoaded) return;
    commitLivePaths();
  }, [useTierRendering, isLoaded, commitLivePaths]);

  // --- Wheel zoom (native listener for passive:false) ---
  useEffect(() => {
    const el = cardRef.current;
    if (!el || !isLoaded) return;

    const handler = (e: WheelEvent) => {
      e.preventDefault();
      if (isAnimatingRef.current) return;
      const factor = e.deltaY > 0 ? 0.94 : 1.06;
      zoomRef.current = Math.max(0.8, Math.min(3, zoomRef.current * factor));
      imperativeUpdate();
    };

    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [isLoaded, imperativeUpdate]);

  // --- Animated projection transition ---
  const startTransition = useCallback(
    (target: "map" | "globe") => {
      if (isAnimatingRef.current || viewModeRef.current === target) return;
      const d3 = d3Ref.current;
      if (!d3) return;

      isAnimatingRef.current = true;
      setIsAnimating(true);

      const eeRaw = d3.geoEqualEarthRaw;
      const orthoRaw = d3.geoOrthographicRaw;
      const eeScale = eeScaleRef.current;
      const zoom = zoomRef.current;

      const isToGlobe = target === "globe";
      const startT = isToGlobe ? 0 : 1;
      const endT = isToGlobe ? 1 : 0;

      // Preserve rotation: globe remembers where user was looking
      const globeRot: [number, number, number] = [...rotationRef.current];
      const mapRot: [number, number, number] = [0, 0, 0];
      const startRot = isToGlobe ? mapRot : globeRot;
      const endRot = isToGlobe ? globeRot : mapRot;

      const startTime = performance.now();

      const animate = (now: number) => {
        const progress = Math.min((now - startTime) / ANIM_DURATION, 1);
        const eased = easeInOutCubic(progress);
        const t = startT + (endT - startT) * eased;

        const rot: [number, number, number] = [
          startRot[0] + (endRot[0] - startRot[0]) * eased,
          startRot[1] + (endRot[1] - startRot[1]) * eased,
          0,
        ];

        const s = ((1 - t) * eeScale + t * ORTHO_SCALE) * zoom;
        const proj = d3
          .geoProjection((lambda: number, phi: number) => {
            const [ex, ey] = eeRaw(lambda, phi);
            const [ox, oy] = orthoRaw(lambda, phi);
            const eeS = eeScale * zoom;
            const orthoS = ORTHO_SCALE * zoom;
            return [
              ((1 - t) * ex * eeS + t * ox * orthoS) / s,
              ((1 - t) * ey * eeS + t * oy * orthoS) / s,
            ] as [number, number];
          })
          .scale(s)
          .translate(TRANSLATE)
          .rotate(rot)
          .precision(0.5);

        const pathGen = d3.geoPath(proj);

        for (const feature of featuresRef.current) {
          const id = String(feature.id);
          const el = pathRefsMap.current.get(id);
          if (!el) continue;

          const d = pathGen(feature);
          if (d) {
            el.setAttribute("d", d);

            if (t > 0.3) {
              const centroid = centroidsRef.current.get(id);
              if (centroid) {
                const [lon, lat] = centroid;
                const cosAngle =
                  Math.cos(((lon + rot[0]) * Math.PI) / 180) * Math.cos((lat * Math.PI) / 180);
                if (cosAngle < 0) {
                  const fade = Math.min(1, (t - 0.3) / 0.5);
                  el.style.opacity = String(Math.max(0, 1 - fade));
                } else {
                  el.style.opacity = "1";
                }
              }
            } else {
              el.style.opacity = "1";
            }
          } else {
            el.style.opacity = "0";
          }
        }

        if (sphereRef.current) {
          sphereRef.current.style.opacity = String(t);
          sphereRef.current.setAttribute("r", String(ORTHO_SCALE * zoom));
        }

        if (graticuleRef.current && graticuleDataRef.current) {
          const gd = pathGen(graticuleDataRef.current);
          if (gd) {
            graticuleRef.current.setAttribute("d", gd);
            graticuleRef.current.style.opacity = String(t * 0.3);
          }
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

        if (progress < 1) {
          animFrameRef.current = requestAnimationFrame(animate);
        } else {
          viewModeRef.current = target;
          setViewMode(target);
          // Don't reset rotationRef - preserve globe position for future transitions
          isAnimatingRef.current = false;
          setIsAnimating(false);
          syncPathsState();
        }
      };

      animFrameRef.current = requestAnimationFrame(animate);
    },
    [syncPathsState]
  );

  // --- Mouse handlers ---
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!isAnimatingRef.current) {
      const svg = svgRef.current;
      if (svg && svg.contains(e.target as Node)) {
        isDraggingRef.current = true;
        setIsDragging(true);
        lastPosRef.current = { x: e.clientX, y: e.clientY };
      }
    }
  };

  const handleMouseUp = () => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      setIsDragging(false);
      lastPosRef.current = null;
      // The drag loop already projected this exact frame — publish it, don't
      // recompute it.
      commitLivePaths();
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isAnimatingRef.current && !isDraggingRef.current && cardRef.current) {
      const rect = cardRef.current.getBoundingClientRect();
      setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }

    if (isDraggingRef.current && lastPosRef.current) {
      const dx = e.clientX - lastPosRef.current.x;
      const dy = e.clientY - lastPosRef.current.y;

      if (viewModeRef.current === "globe") {
        rotationRef.current = [
          rotationRef.current[0] + dx * 0.4,
          Math.max(-90, Math.min(90, rotationRef.current[1] - dy * 0.4)),
          0,
        ];
      } else {
        mapPanRef.current = [mapPanRef.current[0] + dx, mapPanRef.current[1] + dy];
      }

      lastPosRef.current = { x: e.clientX, y: e.clientY };

      if (!dragFrameRef.current) {
        dragFrameRef.current = requestAnimationFrame(() => {
          imperativeUpdate();
          dragFrameRef.current = 0;
        });
      }
    }
  };

  // --- Touch handlers ---
  const lastTouchDistRef = useRef<number | null>(null);
  const touchMovedRef = useRef(false);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (isAnimatingRef.current) return;

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
      touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };
      touchMovedRef.current = false;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && lastTouchDistRef.current !== null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const factor = dist / lastTouchDistRef.current;
      zoomRef.current = Math.max(0.8, Math.min(3, zoomRef.current * factor));
      lastTouchDistRef.current = dist;
      imperativeUpdate();
      return;
    }

    if (!isDraggingRef.current || !lastPosRef.current) return;

    const touch = e.touches[0];
    const dx = touch.clientX - lastPosRef.current.x;
    const dy = touch.clientY - lastPosRef.current.y;

    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      touchMovedRef.current = true;
    }

    if (viewModeRef.current === "globe") {
      rotationRef.current = [
        rotationRef.current[0] + dx * 0.4,
        Math.max(-90, Math.min(90, rotationRef.current[1] - dy * 0.4)),
        0,
      ];
    } else {
      mapPanRef.current = [mapPanRef.current[0] + dx, mapPanRef.current[1] + dy];
    }

    lastPosRef.current = { x: touch.clientX, y: touch.clientY };

    if (!dragFrameRef.current) {
      dragFrameRef.current = requestAnimationFrame(() => {
        imperativeUpdate();
        dragFrameRef.current = 0;
      });
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    lastTouchDistRef.current = null;

    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      setIsDragging(false);
      lastPosRef.current = null;
      commitLivePaths();

      // If tap (no significant movement), navigate to country at touch point
      if (!touchMovedRef.current && touchStartPosRef.current && e.changedTouches.length > 0) {
        const touch = e.changedTouches[0];
        const el = document.elementFromPoint(touch.clientX, touch.clientY);
        if (el) {
          const pathEl = el.closest("path");
          if (pathEl) {
            pathEl.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          }
        }
      }
    }
    touchStartPosRef.current = null;
  };

  const handleCountryClick = (id: string) => {
    if (isAnimatingRef.current) return;
    // Region-overlay feature → its live owner's country map (any manifest shard).
    // Id is `bi:<owner>:<regionCode>` (or legacy `bi:<owner>`) — take the owner.
    if (id.startsWith("bi:")) {
      const owner = id.slice(3).split(":")[0];
      if (owner) router.push(`/country/${owner.toLowerCase()}/map`);
      return;
    }
    const mapped = WORLD_MAPPED_COUNTRIES[id];
    if (!mapped?.path) return;

    // Every registered country is reachable: playable ones to act in, econ-only
    // ones to browse read-only. Unregistered countries render on the globe (via
    // WORLD_COUNTRY_ISO_TO_ID) but are absent from `countryAccess`, so they stay
    // unclickable.
    const slug = mapped.path.split("/").pop()?.toUpperCase();
    if (slug && !(slug in countryAccess)) return;

    router.push(mapped.path);
  };

  // Close fullscreen on Escape key
  useEffect(() => {
    if (!isFullscreen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullscreen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isFullscreen]);

  // Trigger re-render of paths when entering/exiting fullscreen
  useEffect(() => {
    if (isLoaded) {
      // Small delay to let the container resize, then sync paths
      const id = requestAnimationFrame(() => syncPathsState());
      return () => cancelAnimationFrame(id);
    }
  }, [isFullscreen, isLoaded, syncPathsState]);

  // A region-overlay blob is `bi:<ownerCountryId>` — resolve it to the owner's base
  // ISO so the tooltip shows the OWNING country (hovering the USSR's acquired
  // Länder reads "Soviet Union", not nothing).
  const hoveredIso = hovered
    ? hovered.startsWith("bi:")
      ? countryIdToIso(hovered.slice(3).split(":")[0] as CountryId)
      : hovered
    : undefined;
  const hoveredMapped = hoveredIso ? WORLD_MAPPED_COUNTRIES[hoveredIso] : null;
  const hoveredIsoCountryId = hoveredIso ? ISO_TO_COUNTRY_ID[hoveredIso] : undefined;
  // Era-aware tooltip label (e.g. "West Germany" in 1979) when the hovered base
  // country maps to a CountryId; otherwise fall back to the static registry label.
  const hoveredLabel =
    hoveredIsoCountryId && hoveredMapped
      ? getCountryDisplayName(hoveredIsoCountryId, preset)
      : (hoveredMapped?.label ?? "");

  const tooltipAccess = hovered
    ? getMapTooltipAccessDisplay(hovered, hoveredMapped?.status, countryAccess)
    : null;

  // In bloc mode the tooltip answers the question the map is asking — whose
  // side is this? — rather than a metric value.
  const hoveredBloc = hovered ? blocLookup.get(hovered) : undefined;

  const tooltipFilterHighlight =
    metricFilter.type === "blocs"
      ? hoveredBloc
        ? { label: "Bloc", value: BLOC_LABELS[hoveredBloc] }
        : null
      : hoveredIsoCountryId && metricFilter.type !== "none"
        ? getMetricFilterHighlight(
            metricFilter,
            hoveredIsoCountryId,
            countryIdToIso(hoveredIsoCountryId),
            worldMetrics,
            partyData,
            corpsData
          )
        : null;

  const mergedTooltipHighlight =
    metricFilter.type === "category" && tooltipFilterHighlight
      ? {
          label: getCategoryAverageLabel(metricFilter.categoryId),
          value: tooltipFilterHighlight.value,
        }
      : tooltipFilterHighlight;

  const showTooltipClickHint = Boolean(
    hoveredMapped?.path &&
    hoveredIsoCountryId &&
    // Latent world-map countries (e.g. RU) render on the globe via
    // WORLD_COUNTRY_ISO_TO_ID but are absent from the registered countryAccess
    // map — guard so hovering them doesn't throw.
    hoveredIsoCountryId in countryAccess
  );

  // Only the DATA heatmaps count as an active filter. Blocs and Tiers are
  // structural views handled by tierLookup/blocLookup, not by getCountryColor.
  const hasActiveFilter = metricFilter.type !== "none" && metricFilter.type !== "blocs";

  return (
    <div
      ref={cardRef}
      className={
        isFullscreen
          ? "fixed inset-0 z-[60] bg-background overflow-hidden"
          : "relative overflow-hidden rounded-xl border border-card-border bg-card shadow-lg"
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
      <MapControls
        viewMode={viewMode}
        isAnimating={isAnimating}
        isFullscreen={isFullscreen}
        onViewChange={startTransition}
        onFullscreenToggle={() => setIsFullscreen((v) => !v)}
        zoomRef={zoomRef}
        imperativeUpdate={imperativeUpdate}
        syncPathsState={syncPathsState}
      />

      {/* Grid Background */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_800px_at_50%_50%,var(--primary-dark)_0%,transparent_100%)] opacity-5 pointer-events-none" />

      {!isLoaded && (
        <div
          className={`w-full flex items-center justify-center text-muted text-sm ${isFullscreen ? "h-full" : ""}`}
          style={isFullscreen ? undefined : { aspectRatio: `${SVG_W}/${SVG_H}` }}
        >
          Loading map...
        </div>
      )}

      {isLoaded && (
        <MapSVGContent
          svgRef={svgRef}
          sphereRef={sphereRef}
          graticuleRef={graticuleRef}
          warBorderPathRef={warBorderPathRef}
          pathRefsMap={pathRefsMap}
          features={featuresRef.current}
          warBorderInitialD={warBorderInitialDRef.current}
          paths={paths}
          hovered={hovered}
          isAnimating={isAnimating}
          hasActiveFilter={hasActiveFilter}
          isFullscreen={isFullscreen}
          getCountryColor={getCountryColor}
          isAnimatingRef={isAnimatingRef}
          viewModeRef={viewModeRef}
          hoveredRef={hoveredRef}
          // Hover repaints at the geometry already on screen. It must NOT
          // reproject — that was the single biggest source of map lag.
          syncPathsState={commitLivePaths}
          tierLookup={activeTierLookup}
          blocLookup={activeBlocLookup}
          onHover={setHovered}
          onTooltipClear={() => setTooltipPos(null)}
          onCountryClick={handleCountryClick}
          countryAccess={countryAccess}
          worldEntities={worldEntities}
          biCoveredCountries={biCoveredRef.current}
        />
      )}

      {hoveredMapped && tooltipPos && tooltipAccess && !isAnimating && (
        <MapTooltip
          countryLabel={hoveredLabel}
          position={tooltipPos}
          access={tooltipAccess}
          filterHighlight={mergedTooltipHighlight}
          corpsCount={
            hovered && metricFilter.type === "corps"
              ? corpsData?.countries[hovered]?.count
              : undefined
          }
          showClickHint={showTooltipClickHint}
        />
      )}

      {/* Metric filter panel — normal and fullscreen map */}
      <GlobeMetricPanel
        filter={metricFilter}
        onFilterChange={setMetricFilter}
        availableCategories={worldMetrics?.availableCategories ?? []}
        availableMetrics={worldMetrics?.availableMetrics ?? {}}
        blocsAvailable={hasBlocData(preset)}
      />
    </div>
  );
}
