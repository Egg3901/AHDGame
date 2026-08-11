// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { GeoFeature } from "@/components/maps/RegionalGeoMap";
import type { ConflictView } from "../useCombatState";

/** Four equal squares in a row, west to east — the shape a shard carries. */
const FEATURES: GeoFeature[] = [1, 2, 3, 4].map(
  (i) =>
    ({
      properties: { regionCode: `R${i}` },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [i, 0],
            [i + 1, 0],
            [i + 1, 1],
            [i, 1],
            [i, 0],
          ],
        ],
      },
    }) as GeoFeature
);

let geometry: { features: GeoFeature[] | null } = { features: FEATURES };
vi.mock("@/lib/maps/useRegionGeometry", () => ({
  useRegionGeometry: () => geometry,
}));

// The shared map component is exercised by its own tests; here we assert the
// HANDOFF — that FrontMap turns control% into the right per-region colours.
let lastProps: { regionCodes: string[]; regionData: Record<string, { color: string }> } | null =
  null;
vi.mock("@/components/maps/RegionalGeoMap", () => ({
  RegionalGeoMap: (p: { regionCodes: string[]; regionData: Record<string, { color: string }> }) => {
    lastProps = p;
    return <div data-testid="regional-geo-map" />;
  },
}));

const { FrontMap } = await import("./FrontMap");

const conflict: ConflictView = {
  id: "afghan",
  name: "Central Asian Front",
  hostCountry: "CN",
  control: 75,
  sideALabel: "NATO",
  sideBLabel: "PLA",
  occupier: "A",
  occupierCountry: "US",
  hostRegionCodes: ["R1", "R2", "R3", "R4"],
};

afterEach(() => {
  cleanup();
  geometry = { features: FEATURES };
  lastProps = null;
});

describe("FrontMap", () => {
  it("shows the occupied percentage of the host", () => {
    render(<FrontMap conflict={conflict} />);
    // Side A occupies 25% — control 75 is side B's share.
    expect(screen.getByText(/25%/)).toBeTruthy();
  });

  it("names the occupier and the host", () => {
    render(<FrontMap conflict={conflict} />);
    expect(screen.getByText(/NATO/)).toBeTruthy();
    expect(screen.getAllByText(/CN/).length).toBeGreaterThan(0);
  });

  it("hands the shared map every host region", () => {
    render(<FrontMap conflict={conflict} />);
    expect(screen.getByTestId("regional-geo-map")).toBeTruthy();
    expect(lastProps!.regionCodes).toEqual(["R1", "R2", "R3", "R4"]);
    expect(Object.keys(lastProps!.regionData).sort()).toEqual(["R1", "R2", "R3", "R4"]);
  });

  it("colours the occupied share differently from the held remainder", () => {
    render(<FrontMap conflict={conflict} />);
    const colors = Object.values(lastProps!.regionData).map((c) => c.color);
    const distinct = new Set(colors);
    expect(distinct.size).toBe(2);
    // 25% of four equal regions → exactly one taken.
    const taken = colors.filter((c) => c === colors[0]).length;
    expect(Math.min(taken, 4 - taken)).toBe(1);
  });

  it("takes the regions nearest the invader first", () => {
    render(<FrontMap conflict={conflict} />);
    // The US anchor is far west, so R1 (westmost) falls before R4.
    expect(lastProps!.regionData.R1.color).not.toBe(lastProps!.regionData.R4.color);
    const advancing = lastProps!.regionData.R1.color;
    expect(Object.values(lastProps!.regionData).filter((c) => c.color === advancing).length).toBe(
      1
    );
  });

  it("renders the meter alone when the host has no mapped geometry", () => {
    geometry = { features: [] };
    render(<FrontMap conflict={{ ...conflict, hostRegionCodes: [] }} />);
    expect(screen.getByText(/25%/)).toBeTruthy();
    expect(screen.getByText(/no mapped territory/i)).toBeTruthy();
    expect(screen.queryByTestId("regional-geo-map")).toBeNull();
  });

  it("says it is plotting while the shard loads", () => {
    geometry = { features: null };
    render(<FrontMap conflict={conflict} />);
    expect(screen.getByText(/plotting the front/i)).toBeTruthy();
  });

  it("reports an uncontested host with no occupier", () => {
    render(
      <FrontMap conflict={{ ...conflict, occupier: null, occupierCountry: null, control: 50 }} />
    );
    expect(screen.getByText(/contested/i)).toBeTruthy();
  });
});
