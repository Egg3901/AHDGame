/**
 * @vitest-environment happy-dom
 *
 * What bloc mode actually puts in the DOM on /world: East/West/Non-Aligned
 * fills over the interactive tiers, Background Nations untouched in their one
 * merged inert layer, and no extra colors leaking in.
 */
import { describe, expect, it } from "vitest";
import React from "react";
import MapSVGContent, { BACKGROUND_LAYER_KEY } from "./components/MapSVGContent";
import { render } from "@testing-library/react";
import { buildTierLookup, isTierInteractive, TIER_COLORS } from "@/components/landing/countryTiers";
import { getWorldEntityMapSnapshot } from "@/lib/world/worldEntityMap";
import { WORLD_COUNTRY_ISO_TO_ID } from "@/lib/worldCountryRegistry";
import { buildBlocLookup, BLOC_COLORS } from "./worldBlocs";

import topo from "../../../public/geo/countries-110m.json";

const FEATURE_IDS: string[] = (topo as any).objects.countries.geometries.map((g: any) =>
  String(g.id)
);

const FEATURES: any[] = FEATURE_IDS.map((id) => ({
  type: "Feature",
  id,
  properties: { name: id },
  geometry: null,
}));
const PATHS = new Map<string, string | null>(FEATURE_IDS.map((id) => [id, "M0,0L1,1L2,0Z"]));

const SNAPSHOT = getWorldEntityMapSnapshot("1953-default");
const ECONOMIC: string[] = [];
const BATTLEGROUND: string[] = [];
for (const [featureId, item] of Object.entries(SNAPSHOT.byFeatureId)) {
  if (item.simulationTier === "full-autonomous") ECONOMIC.push(featureId);
  else if (item.simulationTier === "sphere-macro") BATTLEGROUND.push(featureId);
}

const ACCESS = {
  US: { enabledForPlayers: true, economyPreview: false },
  UK: { enabledForPlayers: true, economyPreview: false },
  RU: { enabledForPlayers: true, economyPreview: false },
};

const TIER_LOOKUP = buildTierLookup(WORLD_COUNTRY_ISO_TO_ID, ACCESS, BATTLEGROUND, ECONOMIC);
const BLOC_LOOKUP = buildBlocLookup({
  presetId: "1953-default",
  membership: { US: "west", UK: "west", FR: "west", RU: "east", PL: "east", DD: "east" },
  interactiveFeatureIds: [...BATTLEGROUND, ...ECONOMIC],
});

function renderMap(overrides: Record<string, unknown> = {}) {
  // Held outside `props` so a test can inspect which features were drawn as
  // their own path — the key is the feature id, and `key=` never reaches the DOM.
  const pathRefsMap = { current: new Map<string, SVGPathElement>() };
  const props = {
    layout: { svgW: 500, svgH: 500, translate: [250, 250] as [number, number], orthoScale: 200 },
    svgRef: React.createRef<SVGSVGElement>(),
    sphereRef: React.createRef<SVGCircleElement>(),
    graticuleRef: React.createRef<SVGPathElement>(),
    pathRefsMap,
    features: FEATURES,
    paths: PATHS,
    hovered: null,
    isAnimating: false,
    hasActiveFilter: false,
    isFullscreen: false,
    getCountryColor: (_id: string, def: string) => def,
    isAnimatingRef: { current: false },
    viewModeRef: { current: "globe" as const },
    hoveredRef: { current: null as string | null },
    syncPathsState: () => {},
    onHover: () => {},
    onTooltipClear: () => {},
    onCountryClick: () => {},
    tierLookup: TIER_LOOKUP,
    blocLookup: BLOC_LOOKUP,
    ...overrides,
  };

  const utils = render(<MapSVGContent {...(props as any)} />);
  const svg = utils.container.querySelector("svg");
  if (!svg) throw new Error("no svg rendered");
  return { svg, paths: Array.from(svg.querySelectorAll("path")), pathRefsMap };
}

function fillsOf(paths: Element[]): Set<string> {
  return new Set(
    paths
      .map((p) => p.getAttribute("fill"))
      // `fill !== null` rather than `Boolean(fill)`: only the former narrows the
      // type, so `.startsWith` below typechecks.
      .filter((fill): fill is string => fill !== null && fill !== "none" && !fill.startsWith("url"))
  );
}

describe("/world bloc mode", () => {
  it("paints only the three bloc fills plus the background grey", () => {
    const { paths } = renderMap();
    const allowed = new Set([
      BLOC_COLORS.west,
      BLOC_COLORS.east,
      BLOC_COLORS.nonAligned,
      TIER_COLORS.background,
    ]);
    for (const fill of fillsOf(paths)) {
      expect(allowed.has(fill)).toBe(true);
    }
  });

  it("uses all three blocs, so the map is not a two-color world", () => {
    const fills = fillsOf(renderMap().paths);
    expect(fills.has(BLOC_COLORS.west)).toBe(true);
    expect(fills.has(BLOC_COLORS.east)).toBe(true);
    expect(fills.has(BLOC_COLORS.nonAligned)).toBe(true);
  });

  it("still collapses Background Nations into one inert layer", () => {
    const { svg, paths } = renderMap();
    const background = paths.filter((p) => p.getAttribute("fill") === TIER_COLORS.background);
    expect(background).toHaveLength(1);
    expect(background[0].getAttribute("pointer-events") ?? background[0].style.pointerEvents).toBe(
      "none"
    );
    // The globe's ~175 features collapse to the 53 interactive ones + 1 merged
    // background layer + the graticule/sphere furniture.
    expect(svg.querySelectorAll("path").length).toBeLessThan(FEATURE_IDS.length);
  });

  it("registers the merged background layer under its stable ref key", () => {
    const pathRefsMap = { current: new Map<string, SVGPathElement>() };
    renderMap({ pathRefsMap });
    expect(pathRefsMap.current.has(BACKGROUND_LAYER_KEY)).toBe(true);
  });

  it("falls back to tier fills when the preset has no blocs at all", () => {
    const { paths } = renderMap({
      blocLookup: buildBlocLookup({
        presetId: "2019-default",
        membership: {},
        interactiveFeatureIds: [],
      }),
    });
    const fills = fillsOf(paths);
    expect(fills.has(BLOC_COLORS.west)).toBe(false);
    expect(fills.has(TIER_COLORS.player)).toBe(true);
  });
});

describe("bloc mode draws an alliance at its real size", () => {
  // Canada (124) is a NATO member and a BACKGROUND entity — no CountryConfig, no
  // manifest tier. Eight of NATO's fourteen are like that (Canada, the Benelux,
  // Norway, Denmark, Portugal, Iceland), as is Albania in the Warsaw Pact. They
  // were being merged into the single inert grey layer, so bloc mode drew the
  // alliance at two-thirds of its size with nothing to indicate the loss.
  const withBackgroundMember = buildBlocLookup({
    presetId: "1953-default",
    membership: { US: "west", CA: "west", RU: "east" },
    interactiveFeatureIds: [...BATTLEGROUND, ...ECONOMIC],
  });

  const canada = (paths: Element[]) =>
    paths.find((p) => p.getAttribute("d") !== null && p.getAttribute("fill") === BLOC_COLORS.west);

  it("paints a background nation that belongs to a bloc", () => {
    const { pathRefsMap } = renderMap({ blocLookup: withBackgroundMember });
    // 124 is Canada. Present in the ref map means it was drawn as its own path
    // rather than swallowed by the merged layer.
    expect(pathRefsMap.current.has("124")).toBe(true);
    expect(pathRefsMap.current.get("124")!.getAttribute("fill")).toBe(BLOC_COLORS.west);
  });

  it("leaves that nation inert — there is no country page behind Luxembourg", () => {
    const { pathRefsMap } = renderMap({ blocLookup: withBackgroundMember });
    expect(pathRefsMap.current.get("124")!.style.pointerEvents).toBe("none");
  });

  it("does not ALSO leave the member in the merged layer", () => {
    // Drawing it twice is the other half of the bug: the promoted path is
    // repainted every frame while the merged layer's copy is not, so the two
    // separate as the globe turns and the country appears to smear. Canada gets
    // a distinguishable `d` so the merged string can be searched for it.
    const CANADA_D = "M9,9L8,8L7,9Z";
    const { pathRefsMap } = renderMap({
      blocLookup: withBackgroundMember,
      paths: new Map([...PATHS, ["124", CANADA_D]]),
    });
    const merged = pathRefsMap.current.get(BACKGROUND_LAYER_KEY)?.getAttribute("d") ?? "";
    expect(merged).not.toContain(CANADA_D);
    expect(pathRefsMap.current.get("124")!.getAttribute("d")).toBe(CANADA_D);
  });

  it("still merges background NON-members into the one inert layer", () => {
    // The perf win this protects: ~150 background countries as a single node.
    // Only the bloc members are promoted out of it.
    //
    // The subject is CHOSEN, not assumed — my first attempt used Sweden, which
    // is full-autonomous in 1953 and therefore interactive, so the test proved
    // nothing about the merged layer.
    const backgroundNonMember = FEATURE_IDS.find(
      (id) =>
        !isTierInteractive(TIER_LOOKUP.get(id) ?? "background") && !withBackgroundMember.get(id)
    );
    expect(backgroundNonMember, "no background non-member in the fixture").toBeTruthy();

    const { pathRefsMap, paths } = renderMap({ blocLookup: withBackgroundMember });
    expect(pathRefsMap.current.has(BACKGROUND_LAYER_KEY)).toBe(true);
    expect(pathRefsMap.current.has(backgroundNonMember!)).toBe(false);
    expect(canada(paths)).toBeTruthy();
  });
});
