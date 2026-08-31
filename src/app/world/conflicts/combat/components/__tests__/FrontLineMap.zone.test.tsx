// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { FrontLineMap } from "../FrontLineMap";

/**
 * The conflict ZONE, not the anchor.
 *
 * A war is fought over `hostEntities`. The front line is placed as a share of the
 * land the map can project, so projecting only the anchor measured the line
 * against half a two-host theatre: the German Question widens its war to both
 * Germanies, and a line meant to sit on the border between them landed deep
 * inside East Germany instead.
 *
 * Both hosts here are HISTORICAL territories, deliberately. Vietnam would prove
 * nothing: `staticHostGeometry` already answers a Vietnam host with both halves as
 * a special case, so a two-host Vietnam zone drew correctly before this change and
 * a test built on it would pass either way. Each historical id resolves to itself
 * alone, so only a zone-wide union puts both on the map.
 */
const feature = (code: string, west: number, east: number) => ({
  type: "Feature",
  id: code,
  properties: { regionCode: code, name: code },
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [west, 10],
        [east, 10],
        [east, 20],
        [west, 20],
        [west, 10],
      ],
    ],
  },
});

// Two adjacent territories, side by side, equal in area.
const WEST = feature("SAAR", 100, 106);
const EAST = feature("FTT", 106, 112);

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      String(url).includes("historical")
        ? { ok: true, json: async () => ({ features: [WEST, EAST] }) }
        : { ok: true, json: async () => ({ features: [] }) }
    )
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetModules();
});

const props = {
  hostCountry: "SAAR",
  hostRegionCodes: [] as string[],
  control: 50,
  sideACountries: ["US"],
  sideBCountries: ["RU"],
  sideALabel: "Allies",
  sideBLabel: "Pact",
};

/**
 * Silhouette paths the map drew, which is one per projected region — and so one
 * per host, since each host here contributes a single feature.
 */
function drawnRegions(container: HTMLElement): number {
  return container.querySelectorAll("clipPath path").length;
}

describe("FrontLineMap conflict zone", () => {
  it("projects every host in the zone, not just the anchor", async () => {
    const { container } = render(<FrontLineMap {...props} hostEntities={["SAAR", "FTT"]} />);
    await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());
    // Both halves are on the map. Before this, the anchor's own silhouette was the
    // whole picture and the other host was simply absent.
    await waitFor(() => expect(drawnRegions(container)).toBeGreaterThan(1));
  });

  it("falls back to the anchor alone when the zone is absent", async () => {
    // A page rendered before this shipped serialises no `hostEntities`. The map has
    // to draw the anchor rather than throw on a missing array — the same fallback
    // `hostEntitiesOf` makes on the server.
    const { container } = render(<FrontLineMap {...props} />);
    await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());
    expect(drawnRegions(container)).toBeGreaterThan(0);
  });

  it("treats an empty zone as the anchor alone", async () => {
    const { container } = render(<FrontLineMap {...props} hostEntities={[]} />);
    await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());
    expect(drawnRegions(container)).toBeGreaterThan(0);
  });
});
