/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    scope: "region" as const,
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

  it("keeps the masthead's three figures reconcilable", async () => {
    // 67.6 renders as 68 and 70.0 as 70, so the delta beside them must read -2.
    // Differencing the exact values would print -2.4 next to "68" and "70".
    mockFetch(payload({ overall: 67.6, nationalOverall: 70 }));
    renderTab();
    await screen.findByText(/situation registry/);
    expect(screen.getByText(/STABLE · 68\/100/)).toBeTruthy();
    expect(screen.getByText(/national 70/)).toBeTruthy();
    expect(screen.getByText("(-2)")).toBeTruthy();
    expect(screen.queryByText("(-2.4)")).toBeNull();
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

  it("shows the governance-style card scored from the region's own board", async () => {
    mockFetch(
      payload({
        governanceStyle: {
          name: "Governance Style",
          variant: "liberal-democracy",
          leftRight: { value: 66, label: "Centre-right" },
          democraticHealth: { value: 64, label: "Functioning democracy" },
          competition: null,
        },
      })
    );
    renderTab();
    await screen.findByText(/situation registry/);
    // The label appears twice by design: the card heading and the gauge.
    expect(screen.getAllByText("Centre-right").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Functioning democracy").length).toBeGreaterThan(0);
  });

  it("omits the card for a country where the score has no meaning", async () => {
    // A one-party state: the loader sends no governanceStyle at all.
    mockFetch(payload({ governanceStyle: undefined }));
    renderTab();
    await screen.findByText(/situation registry/);
    expect(screen.queryByText("Centre-right")).toBeNull();
  });

  it("links onward to the national registry the region aggregates into", async () => {
    mockFetch(payload());
    renderTab();
    await screen.findByText(/situation registry/);
    const link = screen.getByRole("link", { name: /United States registry/ });
    expect(link.getAttribute("href")).toBe("/country/us/political-metrics");
  });

  it("marks a country-scope statistic as national inside a region view", async () => {
    // Prime rate and inflation are set for the whole country. Listing them
    // unmarked under a Georgia heading would read as Georgia's own numbers.
    const withEvidence = payload();
    withEvidence.categories[0].metrics[0].evidence = [
      {
        id: "unemploymentRate",
        label: "Unemployment",
        value: 9,
        trend: null,
        format: { suffix: "%" },
        scope: "region",
      },
      {
        id: "primeRate",
        label: "Prime rate",
        value: 4,
        trend: null,
        format: { suffix: "%" },
        scope: "national",
      },
    ] as never;
    mockFetch(withEvidence);
    renderTab();
    await screen.findByText(/situation registry/);

    // Drill in: category card, then the metric.
    fireEvent.click(screen.getByRole("button", { name: /Economy & Labor, score 68/ }));
    fireEvent.click(await screen.findByText(withEvidence.categories[0].metrics[0].displayName));

    expect(await screen.findByText("Prime rate")).toBeTruthy();
    expect(screen.getByText("national")).toBeTruthy();
  });

  it("offers a retry rather than a blank tab when the registry cannot be reached", async () => {
    mockFetch(null, false);
    renderTab();
    await waitFor(() => expect(screen.getByText("Registry data unavailable")).toBeTruthy());
    expect(screen.getByRole("button", { name: /Retry retrieval/ })).toBeTruthy();
  });
});

describe("RegionRegistryTab compare view", () => {
  it("compares against a sibling region without issuing another fetch", async () => {
    mockFetch(payload());
    renderTab();
    await screen.findByText(/situation registry/);
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const callsBefore = fetchMock.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: /Compare/ }));
    expect(await screen.findByText("Compare against")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New York" }));

    // Every sibling's value already rides in each metric's `regions` array, so
    // the comparison must not cost a round trip.
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
    // New York now appears as a column header as well as a peer button.
    expect(screen.getAllByText("New York").length).toBeGreaterThan(1);
  });

  it("scores the home column the same way as the peer columns", async () => {
    // Home used to read `category.score` (derived from unrounded metric values)
    // while peers were averaged from the rounded values in `regions` — two
    // columns of one table doing different arithmetic.
    mockFetch(payload());
    renderTab();
    await screen.findByText(/situation registry/);
    fireEvent.click(screen.getByRole("button", { name: /Compare/ }));
    fireEvent.click(screen.getByRole("button", { name: "New York" }));

    // Every metric is 68 for GA and 72 for NY, so every category row must read
    // exactly that in both columns.
    expect(screen.getAllByText("68").length).toBe(9);
    expect(screen.getAllByText("72").length).toBe(9);
  });

  it("names the region plural from the country config, not by appending an s", async () => {
    mockFetch(payload({ regionLabel: "Republic", regionLabelPlural: "Republics" }));
    renderTab();
    await screen.findByText(/situation registry/);
    fireEvent.click(screen.getByRole("button", { name: /Compare/ }));
    expect(await screen.findByText(/up to 3 republics/)).toBeTruthy();
  });
});
