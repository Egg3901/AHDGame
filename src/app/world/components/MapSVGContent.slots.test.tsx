/**
 * @vitest-environment happy-dom
 *
 * The era-art seams on the shared globe renderer: an underlay that paints
 * behind the sphere, an overlay that paints over everything, and sphere colour
 * overrides. /world passes none of them and must render exactly as before.
 */
import { describe, expect, it } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import MapSVGContent, { BACKGROUND_LAYER_KEY, BACKGROUND_MACRO_LAYER_KEY } from "./MapSVGContent";
import { BACKGROUND_MACRO_COLOR, TIER_COLORS } from "@/components/landing/countryTiers";

const FEATURES = ["840", "124", "076"].map((id) => ({
  type: "Feature",
  id,
  properties: { name: id },
  geometry: null,
}));
const PATHS = new Map<string, string | null>([
  ["840", "M0,0L1,1L2,0Z"],
  ["124", "M5,5L6,6L7,5Z"],
  ["076", "M9,9L10,10L11,9Z"],
]);

function renderGlobe(overrides: Record<string, unknown> = {}) {
  const props = {
    layout: { svgW: 500, svgH: 500, translate: [250, 250] as [number, number], orthoScale: 200 },
    svgRef: React.createRef<SVGSVGElement>(),
    sphereRef: React.createRef<SVGCircleElement>(),
    graticuleRef: React.createRef<SVGPathElement>(),
    pathRefsMap: { current: new Map<string, SVGPathElement>() },
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
    enhanced: true,
    ...overrides,
  };
  const utils = render(<MapSVGContent {...(props as any)} />);
  const svg = utils.container.querySelector("svg")!;
  return { ...utils, props, svg };
}

describe("MapSVGContent era slots", () => {
  it("renders exactly as before when no era art is passed", () => {
    const { props, svg } = renderGlobe();
    const sphere = props.sphereRef.current!;
    expect(sphere.getAttribute("fill")).toBe("url(#globe-ocean-enhanced)");
    expect(sphere.getAttribute("stroke")).toBe("#1a6b9f");
    expect(props.graticuleRef.current!.getAttribute("stroke")).toBe("#5bb8f5");
    expect(svg.querySelector("[data-testid]")).toBeNull();
  });

  it("paints the underlay behind the sphere and the overlay over everything", () => {
    const { props, svg } = renderGlobe({
      underlay: <g data-testid="under" />,
      overlay: <g data-testid="over" />,
    });
    const sphere = props.sphereRef.current!;
    const under = svg.querySelector("[data-testid='under']")!;
    const over = svg.querySelector("[data-testid='over']")!;
    expect(under.compareDocumentPosition(sphere) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(svg.lastElementChild).toBe(over);
  });

  it("takes the era's sphere and graticule colours", () => {
    const { props } = renderGlobe({
      sphereFill: "url(#era-ocean)",
      sphereStroke: "#abcdef",
      graticuleStroke: "#123456",
    });
    expect(props.sphereRef.current!.getAttribute("fill")).toBe("url(#era-ocean)");
    expect(props.sphereRef.current!.getAttribute("stroke")).toBe("#abcdef");
    expect(props.graticuleRef.current!.getAttribute("stroke")).toBe("#123456");
  });

  it("keeps the CRT wireframe in charge of the sphere when both are set", () => {
    const { props } = renderGlobe({ wireframeColor: "#00e676", sphereFill: "url(#era-ocean)" });
    expect(props.sphereRef.current!.getAttribute("fill")).toBe("#000800");
    expect(props.sphereRef.current!.getAttribute("stroke")).toBe("#00e676");
  });
});

describe("MapSVGContent background macro layer", () => {
  // The US is a player tier; Canada and Brazil are Background Nations.
  const tierLookup = new Map([["840", "player" as const]]);

  it("keeps one grey background layer when no macro roster is passed", () => {
    const { props } = renderGlobe({ tierLookup });
    expect(props.pathRefsMap.current.get(BACKGROUND_MACRO_LAYER_KEY)).toBeUndefined();
    const grey = props.pathRefsMap.current.get(BACKGROUND_LAYER_KEY)!;
    expect(grey.getAttribute("d")).toBe("M5,5L6,6L7,5ZM9,9L10,10L11,9Z");
  });

  it("draws macro-simulated background apart from unsimulated land, both inert", () => {
    const { props } = renderGlobe({ tierLookup, backgroundMacroFeatureIds: new Set(["076"]) });
    const grey = props.pathRefsMap.current.get(BACKGROUND_LAYER_KEY)!;
    const macro = props.pathRefsMap.current.get(BACKGROUND_MACRO_LAYER_KEY)!;
    expect(grey.getAttribute("d")).toBe("M5,5L6,6L7,5Z");
    expect(grey.getAttribute("fill")).toBe(TIER_COLORS.background);
    expect(macro.getAttribute("d")).toBe("M9,9L10,10L11,9Z");
    expect(macro.getAttribute("fill")).toBe(BACKGROUND_MACRO_COLOR);
    expect(macro.style.pointerEvents).toBe("none");
  });

  it("gives macro background its own phosphor level in CRT mode", () => {
    const { props } = renderGlobe({
      tierLookup,
      backgroundMacroFeatureIds: new Set(["076"]),
      wireframeColor: "#00e676",
    });
    const grey = props.pathRefsMap.current.get(BACKGROUND_LAYER_KEY)!;
    const macro = props.pathRefsMap.current.get(BACKGROUND_MACRO_LAYER_KEY)!;
    expect(macro.getAttribute("fill")).toMatch(/^#00e676/);
    expect(macro.getAttribute("fill")).not.toBe(grey.getAttribute("fill"));
  });
});
