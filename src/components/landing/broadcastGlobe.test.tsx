/**
 * @vitest-environment happy-dom
 *
 * The broadcast globe's frame writer against real DOM: satellites move, a
 * beam lands on one of the crawl's datelines and names it, reduced motion
 * parks everything, and the dissolved state's borders follow the globe.
 */
import { describe, expect, it } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import {
  BroadcastOverlay,
  BroadcastUnderlay,
  useBroadcastGlobeLayers,
  type BroadcastView,
} from "./broadcastGlobe";
import { ERA_CONFIGS } from "./eraThemes";

const TRANSLATE: [number, number] = [320, 184];
const RADIUS = 152;
const TICKER = ERA_CONFIGS["1991"].broadcast!.ticker;

// Turns the globe so central Europe faces the viewer, as the 1991 hero opens.
const rotate = ([lon, lat]: [number, number]): [number, number] => [lon - 30, lat - 45];

type Layers = ReturnType<typeof useBroadcastGlobeLayers>;

function mount() {
  let layers: Layers | null = null;
  function Harness() {
    const value = useBroadcastGlobeLayers({
      translate: TRANSLATE,
      globeRadius: RADIUS,
      ticker: TICKER,
    });
    layers = value;
    return (
      <svg>
        <BroadcastUnderlay translate={TRANSLATE} globeRadius={RADIUS} zoom={1} bind={value.bind} />
        <circle data-testid="sphere" r={RADIUS} />
        <BroadcastOverlay
          translate={TRANSLATE}
          globeRadius={RADIUS}
          zoom={1}
          bind={value.bind}
          orbitLabel="MIR"
        />
      </svg>
    );
  }
  const view = render(<Harness />);
  return { ...view, layers: () => layers! };
}

const frame = (overrides: Partial<BroadcastView> = {}): BroadcastView => ({
  rotate,
  zoom: 1,
  // One second in: Mir is on the near side and the first beam is live.
  now: 1000,
  animate: true,
  ...overrides,
});

describe("broadcast globe frame writer", () => {
  it("keeps every layer out of the way of the globe's pointer events", () => {
    const { container } = mount();
    const layers = [...container.querySelectorAll("svg > g")];
    expect(layers.length).toBe(2);
    for (const layer of layers) {
      expect((layer as SVGGElement).style.pointerEvents).toBe("none");
      expect(layer.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("paints the far side under the sphere and the near side over it", () => {
    const { container, getByTestId } = mount();
    const sphere = getByTestId("sphere");
    const [under, over] = [...container.querySelectorAll("svg > g")];
    expect(under.compareDocumentPosition(sphere) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(over.compareDocumentPosition(sphere) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it("moves the satellites and draws their trails", () => {
    const { container, layers } = mount();
    layers().render(frame());
    // A satellite is the group holding its solar-panel bar; four of them, each
    // drawn once per side of its orbit.
    const satellites = [...container.querySelectorAll("rect")]
      .map((panel) => panel.parentElement!)
      .filter((parent) => parent.tagName.toLowerCase() === "g");
    expect(satellites.length).toBe(8);
    for (const sat of satellites) expect(sat.getAttribute("transform")).toMatch(/^translate\(/);
    const trails = [...container.querySelectorAll("path")].filter((p) =>
      (p.getAttribute("stroke") ?? "").startsWith("url(#ahd-bc-trail-")
    );
    expect(trails.length).toBe(8);
    for (const trail of trails) expect(trail.getAttribute("d")).toMatch(/^M/);
  });

  it("beams down to a crawl dateline and labels it with the crawl's date", () => {
    const { container, layers } = mount();
    layers().render(frame());
    const beam = container.querySelector("polygon")!.parentElement!;
    expect(Number(beam.getAttribute("opacity"))).toBeGreaterThan(0);

    const [place, date] = [...container.querySelectorAll("tspan")].map((t) => t.textContent);
    const filed = TICKER.filter((item) => item.place?.name.toUpperCase() === place);
    expect(filed.length).toBeGreaterThan(0);
    expect(filed.map((item) => item.date.toUpperCase())).toContain(date);

    // The satellite doing the transmitting swells.
    const halos = [...container.querySelectorAll("circle")].filter(
      (c) => c.getAttribute("fill") === "#ffffff" && Number(c.getAttribute("r")) >= 2.6
    );
    expect(halos.some((c) => Number(c.getAttribute("r")) > 2.6)).toBe(true);
  });

  it("goes quiet between beams", () => {
    const { container, layers } = mount();
    // 3.0 s is inside the rest after the first 2.8 s beam.
    layers().render(frame({ now: 3000 }));
    const beam = container.querySelector("polygon")!.parentElement!;
    expect(beam.getAttribute("opacity")).toBe("0");
  });

  it("holds the beams while the crisis tour has the stage", () => {
    const { container, layers } = mount();
    layers().render(frame({ beams: false }));
    const beam = container.querySelector("polygon")!.parentElement!;
    expect(beam.getAttribute("opacity")).toBe("0");
  });

  it("parks the satellites and drops the beams under reduced motion", () => {
    const { container, layers } = mount();
    layers().render(frame({ animate: false }));
    const beam = container.querySelector("polygon")!.parentElement!;
    expect(beam.getAttribute("opacity")).toBe("0");
    const trails = [...container.querySelectorAll("path")].filter((p) =>
      (p.getAttribute("stroke") ?? "").startsWith("url(#ahd-bc-trail-")
    );
    for (const trail of trails) expect(trail.getAttribute("d")).toBe("");
  });

  it("redraws the dissolved state's borders only when the globe moved", () => {
    const { container, layers } = mount();
    const api = layers();
    api.geometry.current = {
      outline: { type: "MultiLineString", coordinates: [] },
      seams: { type: "MultiLineString", coordinates: [] },
    };
    const outline = container.querySelector("path.ahd-bc-ghost")!;
    api.render(frame());
    expect(outline.getAttribute("d")).toBeNull();
    api.render(frame({ pathGen: () => "M0 0L1 1" }));
    expect(outline.getAttribute("d")).toBe("M0 0L1 1");
  });

  it("rescales the art with the globe's zoom", () => {
    const { container, layers } = mount();
    layers().render(frame({ zoom: 1.3 }));
    const zoomed = [...container.querySelectorAll("g")].filter((g) =>
      (g.getAttribute("transform") ?? "").includes("scale(1.3)")
    );
    expect(zoomed.length).toBe(3);
  });
});
