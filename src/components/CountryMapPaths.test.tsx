/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CountryMapPaths, countryHasMap, getMappableRegions } from "./CountryMapPaths";

vi.mock("@/components/USAMapPaths", () => ({
  USAMapPaths: () => <div data-testid="usa-paths" />,
}));
vi.mock("@/components/UKMapPaths", () => ({
  UKMapPaths: () => <div data-testid="uk-paths" />,
}));
vi.mock("@/components/JapanMapPaths", () => ({
  JapanMapPaths: () => <div data-testid="jp-paths" />,
}));
vi.mock("@/components/GermanyMapPaths", () => ({
  GermanyMapPaths: () => <div data-testid="de-paths" />,
}));

describe("getMappableRegions", () => {
  it("returns the region ids for countries with geometry", () => {
    expect(getMappableRegions("US").has("NE")).toBe(true);
    expect(getMappableRegions("UK").has("LON")).toBe(true);
    expect(getMappableRegions("DE").has("BW")).toBe(true);
  });

  it("excludes the national pseudo-region used by presidential races", () => {
    expect(getMappableRegions("US").has("US")).toBe(false);
  });

  it("returns an empty set for countries without geometry", () => {
    expect(getMappableRegions("NG").size).toBe(0);
    expect(getMappableRegions("BR").size).toBe(0);
  });

  it("returns a stable cached set for repeat calls", () => {
    expect(getMappableRegions("US")).toBe(getMappableRegions("US"));
  });
});

describe("countryHasMap", () => {
  it("is true only for countries with geometry", () => {
    expect(countryHasMap("US")).toBe(true);
    expect(countryHasMap("UK")).toBe(true);
    expect(countryHasMap("JP")).toBe(true);
    expect(countryHasMap("DE")).toBe(true);
    expect(countryHasMap("NG")).toBe(false);
  });
});

describe("CountryMapPaths", () => {
  const regionData = { NE: { color: "#ff0000", label: "NE" } };

  // The paths components load via next/dynamic, so the first paint is the
  // loading fallback — these must be async. (No other test in this repo renders
  // a next/dynamic component; PrimaryElectoralMap imports USAMapPaths directly,
  // which is why its assertions can be synchronous.)
  it("renders the country's own map component", async () => {
    const { rerender } = render(<CountryMapPaths countryId="US" regionData={regionData} />);
    expect(await screen.findByTestId("usa-paths")).toBeTruthy();

    rerender(<CountryMapPaths countryId="UK" regionData={regionData} />);
    expect(await screen.findByTestId("uk-paths")).toBeTruthy();

    rerender(<CountryMapPaths countryId="JP" regionData={regionData} />);
    expect(await screen.findByTestId("jp-paths")).toBeTruthy();

    rerender(<CountryMapPaths countryId="DE" regionData={regionData} />);
    expect(await screen.findByTestId("de-paths")).toBeTruthy();
  });

  it("renders nothing for a country without geometry", () => {
    // Returns null before reaching any dynamic import, so this stays synchronous.
    const { container } = render(<CountryMapPaths countryId="NG" regionData={regionData} />);
    expect(container.innerHTML).toBe("");
  });
});
