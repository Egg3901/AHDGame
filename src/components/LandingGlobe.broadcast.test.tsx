/**
 * @vitest-environment happy-dom
 *
 * The broadcast globe is opt-in per era: 1991 hands the shared renderer its
 * sphere colours and art layers, 1953 hands it nothing and keeps its CRT look.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { render, waitFor } from "@testing-library/react";
import { ERA_CONFIGS } from "@/components/landing/eraThemes";
import { BROADCAST_SPHERE_FILL } from "@/components/landing/broadcastGlobe";
import {
  battlegroundFeatureIdsForEra,
  economicPowerFeatureIdsForEra,
} from "@/components/landing/countryTierRosters";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const mapSvgProps: Record<string, unknown>[] = [];
vi.mock("@/app/world/components/MapSVGContent", () => ({
  __esModule: true,
  BACKGROUND_LAYER_KEY: "__tier_background__",
  BACKGROUND_MACRO_LAYER_KEY: "__tier_background_macro__",
  default: (props: Record<string, unknown>) => {
    mapSvgProps.push(props);
    return <svg data-testid="map-svg" />;
  },
}));

// Minimal, valid topology: one square "country" whose id is the US feature id.
const TOPOLOGY = {
  type: "Topology",
  arcs: [
    [
      [0, 0],
      [1000, 0],
      [0, 1000],
      [-1000, 0],
      [0, -1000],
    ],
  ],
  transform: { scale: [0.01, 0.01], translate: [-100, 30] },
  objects: {
    countries: {
      type: "GeometryCollection",
      geometries: [{ type: "Polygon", id: "840", arcs: [[0]] }],
    },
  },
};

beforeEach(() => {
  mapSvgProps.length = 0;
  global.fetch = vi.fn().mockResolvedValue({
    json: async () => TOPOLOGY,
  }) as unknown as typeof fetch;
});

async function renderEra(era: "1953" | "1991", extra: Record<string, unknown> = {}) {
  const { LandingGlobe } = await import("@/components/LandingGlobe");
  const config = ERA_CONFIGS[era];
  const view = render(
    <LandingGlobe
      bare
      enhanced
      countryAccess={config.accessMap}
      battlegroundFeatureIds={battlegroundFeatureIdsForEra(era)}
      economicPowerFeatureIds={economicPowerFeatureIdsForEra(era)}
      wireframeColor={config.wireframeColor ?? undefined}
      broadcast={config.broadcast}
      geoUrl="/geo/test.json"
      {...extra}
    />
  );
  await waitFor(() => expect(mapSvgProps.length).toBeGreaterThan(0));
  return { view, props: mapSvgProps[mapSvgProps.length - 1] };
}

describe("LandingGlobe broadcast wiring", () => {
  it("gives the 1991 globe its sphere, its art layers and no corner legend", async () => {
    const { props } = await renderEra("1991", { hideTierLegend: true });
    expect(props.sphereFill).toBe(BROADCAST_SPHERE_FILL);
    expect(props.sphereStroke).toEqual(expect.any(String));
    expect(props.graticuleStroke).toEqual(expect.any(String));
    expect(React.isValidElement(props.underlay)).toBe(true);
    expect(React.isValidElement(props.overlay)).toBe(true);
    expect(document.body.textContent).not.toContain("Player Nations");
  });

  it("hands the renderer the era's macro-simulated background as a set", async () => {
    const { props } = await renderEra("1991", { backgroundMacroFeatureIds: ["004", "024"] });
    const set = props.backgroundMacroFeatureIds as ReadonlySet<string>;
    expect([...set]).toEqual(["004", "024"]);
  });

  it("passes no macro layer when the page has no roster", async () => {
    const { props } = await renderEra("1953");
    expect(props.backgroundMacroFeatureIds).toBeUndefined();
  });

  it("leaves the 1953 globe exactly as it was", async () => {
    const { props } = await renderEra("1953");
    expect(props.wireframeColor).toBe("#00e676");
    expect(props.sphereFill).toBeUndefined();
    expect(props.sphereStroke).toBeUndefined();
    expect(props.graticuleStroke).toBeUndefined();
    expect(props.underlay).toBeUndefined();
    expect(props.overlay).toBeUndefined();
    // The corner key is still there for the CRT globe.
    expect(document.body.textContent).toContain("Player Nations");
  });
});
