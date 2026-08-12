/**
 * @vitest-environment happy-dom
 *
 * Wiring tests for the four-tier landing globe: what actually reaches the DOM,
 * and what the render loop is allowed to spend per render.
 */
import { describe, expect, it, beforeEach } from "vitest";
import React from "react";
import { render, fireEvent } from "@testing-library/react";
import MapSVGContent, { BACKGROUND_LAYER_KEY } from "@/app/world/components/MapSVGContent";
import { buildTierLookup, TIER_COLORS } from "./countryTiers";
import { battlegroundFeatureIdsForEra, economicPowerFeatureIdsForEra } from "./countryTierRosters";
import { ERA_CONFIGS } from "./eraThemes";
import { WORLD_COUNTRY_ISO_TO_ID } from "@/lib/worldCountryRegistry";
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

const TIER_LOOKUP = buildTierLookup(
  WORLD_COUNTRY_ISO_TO_ID,
  ERA_CONFIGS["1953"].accessMap,
  battlegroundFeatureIdsForEra("1953"),
  economicPowerFeatureIdsForEra("1953")
);

let clicks = 0;
let hovers = 0;

beforeEach(() => {
  clicks = 0;
  hovers = 0;
});

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    layout: { svgW: 500, svgH: 500, translate: [250, 250] as [number, number], orthoScale: 200 },
    svgRef: React.createRef<SVGSVGElement>(),
    sphereRef: React.createRef<SVGCircleElement>(),
    graticuleRef: React.createRef<SVGPathElement>(),
    pathRefsMap: { current: new Map<string, SVGPathElement>() },
    features: FEATURES,
    paths: PATHS,
    hovered: null,
    isAnimating: false,
    hasActiveFilter: true,
    isFullscreen: false,
    getCountryColor: (_id: string, def: string) => def,
    isAnimatingRef: { current: false },
    viewModeRef: { current: "globe" as const },
    hoveredRef: { current: null as string | null },
    syncPathsState: () => {},
    onHover: () => {
      hovers += 1;
    },
    onTooltipClear: () => {},
    onCountryClick: () => {
      clicks += 1;
    },
    enhanced: true,
    tierLookup: TIER_LOOKUP,
    ...overrides,
  };
}

function renderGlobe(overrides: Record<string, unknown> = {}) {
  const props = makeProps(overrides);

  const utils = render(<MapSVGContent {...(props as any)} />);
  const svg = utils.container.querySelector("svg");
  if (!svg) throw new Error("no svg rendered");
  return { ...utils, props, svg, paths: Array.from(svg.querySelectorAll("path")) };
}

describe("landing globe — four fills and nothing else", () => {
  it("paints exactly the four tier fills", () => {
    const { paths } = renderGlobe();
    const fills = new Set(
      paths
        .map((p) => p.getAttribute("fill"))
        .filter((fill): fill is string => Boolean(fill) && fill !== "none")
    );
    expect(fills).toEqual(new Set(Object.values(TIER_COLORS)));
  });

  it("keeps four fills while a country is hovered (hover moves the stroke, not the fill)", () => {
    const { paths } = renderGlobe({ hovered: "840" });
    const fills = new Set(
      paths
        .map((p) => p.getAttribute("fill"))
        .filter((fill): fill is string => Boolean(fill) && fill !== "none")
    );
    expect(fills).toEqual(new Set(Object.values(TIER_COLORS)));
  });

  it("derives four phosphor fills in CRT wireframe mode instead of one flat black", () => {
    const { paths } = renderGlobe({ wireframeColor: "#00e676" });
    const fills = new Set(
      paths
        .map((p) => p.getAttribute("fill"))
        .filter((fill): fill is string => Boolean(fill) && fill !== "none")
    );
    expect(fills.size).toBe(4);
    for (const fill of fills) expect(fill.startsWith("#00e676")).toBe(true);
  });
});

describe("landing globe — Background Nations are inert", () => {
  it("collapses every background country into one handler-free layer", () => {
    const { props, paths } = renderGlobe();
    const backgroundEl = props.pathRefsMap.current.get(BACKGROUND_LAYER_KEY);
    expect(backgroundEl).toBeTruthy();
    expect(backgroundEl?.getAttribute("fill")).toBe(TIER_COLORS.background);
    // One merged path, holding many countries' subpaths.
    const subpaths = (backgroundEl?.getAttribute("d") ?? "").split("M").length - 1;
    expect(subpaths).toBeGreaterThan(100);
    // It must not be hoverable, clickable or tooltip-bearing.
    expect(backgroundEl?.style.pointerEvents).toBe("none");
    for (const el of paths) fireEvent.click(el);
    for (const el of paths) fireEvent.mouseOver(el);
    // Every handler that fired belongs to an interactive tier, never background.
    const interactive = paths.filter((el) => el.style.cursor === "pointer");
    expect(clicks).toBe(interactive.length);
    expect(hovers).toBe(interactive.length);
    expect(interactive).not.toContain(backgroundEl);
  });

  it("cuts interactive paths from one-per-country to only the named tiers", () => {
    const before = renderGlobe({ tierLookup: undefined, hasActiveFilter: false });
    const beforeInteractive = before.paths.filter((el) => el.getAttribute("d")).length;
    before.unmount();

    const after = renderGlobe();
    const afterInteractive = after.paths.filter((el) => el.style.cursor === "pointer").length;

    expect(beforeInteractive).toBeGreaterThan(FEATURE_IDS.length - 5);
    // A loose bound on purpose: the point is that most of the globe goes to the
    // non-interactive background layer, not the exact fraction. The battleground
    // roster grows whenever a decolonisation theatre gains geometry — Congo,
    // Somalia and South Yemen took it past a literal third — and the exact-roster
    // assertion below is the real check on what survives.
    expect(afterInteractive).toBeLessThan(beforeInteractive / 2);
    // Sanity: what is left is exactly the named roster (plus nothing else).
    expect(afterInteractive).toBe(
      FEATURE_IDS.filter((id) => TIER_LOOKUP.has(id) && TIER_LOOKUP.get(id) !== "background").length
    );
  });
});

describe("landing globe — the tier lookup is not rebuilt per render", () => {
  it("keeps the merged background layer stable across a hover re-render", () => {
    // Hovering an interactive country re-renders the SVG. The background layer
    // is memoised on [features, paths, tierLookup], none of which changed, so
    // it must come back byte-identical rather than being re-concatenated.
    const props = makeProps();

    const { rerender, container } = render(<MapSVGContent {...(props as any)} />);
    const firstD = container.querySelector("path[aria-hidden='true']")?.getAttribute("d");
    expect(firstD).toBeTruthy();

    rerender(<MapSVGContent {...(props as any)} hovered="840" />);
    const secondD = container.querySelector("path[aria-hidden='true']")?.getAttribute("d");
    expect(secondD).toBe(firstD);
  });

  it("hands the globe stable roster references, so the memo can hold", () => {
    // LandingGlobe memoises the lookup on
    // [countryAccess, battlegroundFeatureIds, economicPowerFeatureIds].
    // That memo is only worth anything if all three are stable per era.
    expect(battlegroundFeatureIdsForEra("1953")).toBe(battlegroundFeatureIdsForEra("1953"));
    expect(economicPowerFeatureIdsForEra("1953")).toBe(economicPowerFeatureIdsForEra("1953"));
    expect(ERA_CONFIGS["1953"].accessMap).toBe(ERA_CONFIGS["1953"].accessMap);
  });
});
