/**
 * @vitest-environment happy-dom
 *
 * Does LandingGlobe actually build the tier lookup once per era, and hand it to
 * the SVG instead of a per-path colour callback? Rendering the real component
 * is the only way to answer that.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { render, waitFor } from "@testing-library/react";
import { ERA_CONFIGS } from "@/components/landing/eraThemes";
import {
  battlegroundFeatureIdsForEra,
  economicPowerFeatureIdsForEra,
} from "@/components/landing/countryTierRosters";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const buildTierLookupCalls = vi.fn();
vi.mock("@/components/landing/countryTiers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/landing/countryTiers")>();
  return {
    ...actual,
    buildTierLookup: (...args: Parameters<typeof actual.buildTierLookup>) => {
      buildTierLookupCalls(...args);
      return actual.buildTierLookup(...args);
    },
  };
});

const mapSvgProps: Record<string, unknown>[] = [];
vi.mock("@/app/world/components/MapSVGContent", () => ({
  __esModule: true,
  BACKGROUND_LAYER_KEY: "__tier_background__",
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
  buildTierLookupCalls.mockClear();
  mapSvgProps.length = 0;
  global.fetch = vi.fn().mockResolvedValue({
    json: async () => TOPOLOGY,
  }) as unknown as typeof fetch;
});

async function renderGlobe() {
  const { LandingGlobe } = await import("@/components/LandingGlobe");
  return render(
    <LandingGlobe
      countryAccess={ERA_CONFIGS["1953"].accessMap}
      battlegroundFeatureIds={battlegroundFeatureIdsForEra("1953")}
      economicPowerFeatureIds={economicPowerFeatureIdsForEra("1953")}
      geoUrl="/geo/test.json"
    />
  );
}

describe("LandingGlobe tier wiring", () => {
  it("builds the tier lookup once, not once per render", async () => {
    const { rerender } = await renderGlobe();
    await waitFor(() => expect(mapSvgProps.length).toBeGreaterThan(0));

    const callsAfterMount = buildTierLookupCalls.mock.calls.length;
    expect(callsAfterMount).toBe(1);

    const { LandingGlobe } = await import("@/components/LandingGlobe");
    for (let i = 0; i < 5; i++) {
      rerender(
        <LandingGlobe
          countryAccess={ERA_CONFIGS["1953"].accessMap}
          battlegroundFeatureIds={battlegroundFeatureIdsForEra("1953")}
          economicPowerFeatureIds={economicPowerFeatureIdsForEra("1953")}
          geoUrl="/geo/test.json"
        />
      );
    }
    expect(buildTierLookupCalls.mock.calls.length).toBe(callsAfterMount);
  });

  it("passes one shared lookup instance to the SVG, and a colour callback that does no work", async () => {
    await renderGlobe();
    await waitFor(() => expect(mapSvgProps.length).toBeGreaterThan(0));

    const lookups = new Set(mapSvgProps.map((props) => props.tierLookup));
    expect(lookups.size).toBe(1);
    const lookup = mapSvgProps[0].tierLookup as Map<string, string>;
    expect(lookup.get("840")).toBe("player");
    expect(lookup.get("616")).toBe("economic"); // Poland — Warsaw Pact
    expect(lookup.get("408")).toBe("battleground"); // North Korea
    expect(lookup.has("124")).toBe(false); // Canada — Background, never stored

    // The old per-path getCountryColor is now an identity pass-through.
    const getCountryColor = mapSvgProps[0].getCountryColor as (id: string, def: string) => string;
    expect(getCountryColor("124", "sentinel")).toBe("sentinel");
    // …and it is a stable reference, so it never invalidates a memo.
    const colourCallbacks = new Set(mapSvgProps.map((props) => props.getCountryColor));
    expect(colourCallbacks.size).toBe(1);
  });
});
