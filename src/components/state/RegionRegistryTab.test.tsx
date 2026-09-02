/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { RegionRegistryTab } from "./RegionRegistryTab";
import { POLITICAL_METRIC_CATEGORIES, FAMILY_SLUGS } from "@/lib/politicalMetrics/types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A full nine-category payload, so the views render the way they will live. */
function payload(overrides: Record<string, unknown> = {}) {
  const categories = POLITICAL_METRIC_CATEGORIES.map((cat) => ({
    id: cat.id,
    displayName: cat.displayName,
    score: 68,
    status: "Stable",
    nationalScore: 70,
    metrics: FAMILY_SLUGS[cat.id].map((slug, i) => ({
      id: `${cat.id}.${slug}`,
      lean: [-5, -3, -1, 0, 1, 3, 5][i],
      leanLabel: "Centrist",
      displayName: `${cat.displayName} ${slug}`,
      description: "A description.",
      pos: [],
      neg: [],
      indicators: [],
      value: 68,
      national: 70,
      status: "Stable",
      legislation: null,
      history: [],
      modifiers: {
        laws: [],
        regionalLaws: [],
        residual: 0,
        cabinet: 0,
        labour: 0,
        cabinetBySource: [],
        cabinetAtCap: false,
        cabinetCap: 8,
        driftHalfLifeTurns: 34,
        target: 68,
        direction: "flat",
      },
      evidence: [],
      regions: [
        { regionId: "GA", name: "Georgia", value: 68 },
        { regionId: "NY", name: "New York", value: 72 },
      ],
    })),
  }));

  return {
    countryId: "US",
    countryDisplayName: "United States",
    regionId: "GA",
    regionName: "Georgia",
    regionLabel: "State",
    regionLabelPlural: "States",
    year: 1963,
    turn: 575,
    historyCadenceTurns: 24,
    overall: 68,
    overallStatus: "Stable",
    nationalOverall: 70,
    categories,
    ...overrides,
  };
}

function mockFetch(body: unknown, ok = true) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok, json: () => Promise.resolve(body) }));
}

function renderTab() {
  render(<RegionRegistryTab countryId="US" regionId="GA" regionName="Georgia" />);
}

describe("RegionRegistryTab", () => {
  it("heads the registry with the region, not the country", async () => {
    mockFetch(payload());
    renderTab();
    expect(await screen.findByText(/Georgia · State situation registry/)).toBeTruthy();
  });

  it("shows the region's score with the national figure to compare against", async () => {
    mockFetch(payload());
    renderTab();
    await screen.findByText(/situation registry/);
    expect(screen.getByText(/STABLE · 68\/100/)).toBeTruthy();
    // 68 against a national 70, so a two-point deficit.
    expect(screen.getByText(/national 70/)).toBeTruthy();
    expect(screen.getByText("(-2)")).toBeTruthy();
  });

  it("captions the category subtitle with the REGION name", async () => {
    // `countryDisplayName` on the region payload is the country, and the shared
    // views print it as their subtitle — passing it straight through captioned
    // every Georgia page "United States".
    mockFetch(payload());
    renderTab();
    await screen.findByText(/situation registry/);
    expect(screen.queryByText(/· United States$/)).toBeNull();
  });

  it("omits the governance-style card, which has no regional analogue", async () => {
    mockFetch(payload());
    renderTab();
    await screen.findByText(/situation registry/);
    expect(screen.queryByText("Governance Style")).toBeNull();
  });

  it("links onward to the national registry the region aggregates into", async () => {
    mockFetch(payload());
    renderTab();
    await screen.findByText(/situation registry/);
    const link = screen.getByRole("link", { name: /United States registry/ });
    expect(link.getAttribute("href")).toBe("/country/us/political-metrics");
  });

  it("offers a retry rather than a blank tab when the registry cannot be reached", async () => {
    mockFetch(null, false);
    renderTab();
    await waitFor(() => expect(screen.getByText("Registry data unavailable")).toBeTruthy());
    expect(screen.getByRole("button", { name: /Retry retrieval/ })).toBeTruthy();
  });
});
