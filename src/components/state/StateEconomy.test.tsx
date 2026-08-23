/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StateEconomy } from "./StateEconomy";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

const payload = {
  stateId: "TX",
  stateName: "Texas",
  stateGdp: 1_820_000,
  macro: { stateGdpGrowth: 1.9, nationalGdpGrowth: 2.1 },
  nationalSectorTotals: { energy: 28_900_000, financial: 48_200_000 },
  sectorSpecializations: {
    primary: "energy",
    primaryLabel: "Energy",
    primaryBonus: 10,
    secondary: "technology",
    secondaryLabel: "Technology",
    secondaryBonus: 5,
  },
  totalMarketPerSector: 5_000_000,
  sectors: [
    {
      type: "energy",
      label: "Energy",
      totalMarket: 4_820_000,
      ownedRevenue: 3_760_000,
      unownedRevenue: 1_060_000,
      unownedPercent: 22,
      splitCost: 96_400,
      estimatedCapture: 184_000,
      estimatedCapturePercent: 3.8,
      owners: [
        {
          sectorId: "sec1",
          corporationId: "corp1",
          corporationName: "Lone Star Petroleum",
          corporationSequentialId: 1,
          ceoName: "M. Calloway",
          ceoSequentialId: 11,
          revenue: 1_640_000,
          marketShare: 34,
          workers: 1200,
          targetGrowthRate: 6,
          currentGrowthRate: 5,
          productionLevel: 12,
        },
      ],
    },
    {
      type: "financial",
      label: "Financial",
      totalMarket: 3_940_000,
      ownedRevenue: 0,
      unownedRevenue: 3_940_000,
      unownedPercent: 100,
      splitCost: 350_000,
      estimatedCapture: 400_000,
      estimatedCapturePercent: 10,
      owners: [],
    },
  ],
  userCorporationId: null,
  userCorporationSectorType: null,
  userMarketingStrength: 0,
  splitMsCost: 12,
  stateResources: null,
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => payload }));
});

describe("StateEconomy", () => {
  it("renders the macro header and a sector-board tile per sector", async () => {
    render(<StateEconomy stateId="TX" countryId="US" />);
    await waitFor(() => expect(screen.getByText("$1.82T")).toBeTruthy());
    expect(screen.getByText(/State Economy · Texas/)).toBeTruthy();
    const tiles = document.querySelectorAll("[data-sector]");
    expect(tiles.length).toBe(2);
    // top sector chip reflects the largest market
    expect(screen.getByText(/Top sector/)).toBeTruthy();
    // sector-board tiles show average CURRENT growth (energy's lone corp is at +5)
    expect(screen.getAllByText("Avg. Growth").length).toBe(2);
    expect(screen.getByText("+5.00%")).toBeTruthy();
  });

  it("offers a sector dropdown (mobile selector) that switches the detail", async () => {
    render(<StateEconomy stateId="TX" countryId="US" />);
    await waitFor(() => expect(screen.getByText("$1.82T")).toBeTruthy());
    const select = screen.getByRole("combobox", { name: /select sector/i });
    expect(select).toBeTruthy();
    fireEvent.change(select, { target: { value: "financial" } });
    await waitFor(() => expect(screen.getByText(/No market activity|Unowned Market/)).toBeTruthy());
  });

  it("switches the sector detail when a board tile is clicked", async () => {
    render(<StateEconomy stateId="TX" countryId="US" />);
    await waitFor(() => expect(screen.getByText("$1.82T")).toBeTruthy());
    // financial is empty → switching to it shows the empty state
    const financialTile = document.querySelector('[data-sector="financial"]');
    expect(financialTile).toBeTruthy();
    fireEvent.click(financialTile!);
    await waitFor(() => expect(screen.getByText(/No market activity|Unowned Market/)).toBeTruthy());
  });

  it("shows the national-context cross-link for the selected sector", async () => {
    render(<StateEconomy stateId="TX" countryId="US" />);
    await waitFor(() => expect(screen.getByText("$1.82T")).toBeTruthy());
    // energy 4.82M of 28.9M national ≈ 16.7%
    expect(screen.getByText(/≈16\.7%/)).toBeTruthy();
    const link = screen.getByRole("link", { name: /National Energy view/ });
    expect(link.getAttribute("href")).toBe("/country/us/economy");
  });

  it("shows the production level on participant cards", async () => {
    render(<StateEconomy stateId="TX" countryId="US" />);
    await waitFor(() =>
      expect(screen.getAllByText("Lone Star Petroleum").length).toBeGreaterThan(0)
    );
    expect(screen.getByText("Production")).toBeTruthy();
    expect(screen.getByText("+12%")).toBeTruthy();
  });

  it("never offers Split unowned under plants mode", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ...payload,
          plantsMode: true,
          userCorporationId: "corp-me",
          userMarketingStrength: 40,
          splitMsCost: 0,
          sectors: payload.sectors.map((s) => ({
            ...s,
            splitCost: 0,
            estimatedCapture: 0,
            estimatedCapturePercent: 0,
            headroomUnits: 50_000,
          })),
        }),
      })
    );
    render(<StateEconomy stateId="TX" countryId="US" />);
    await waitFor(() => expect(screen.getByText("Untapped Market")).toBeTruthy());
    expect(screen.queryByText("Split strength")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Split/ })).toBeNull();
    const buildHere = screen.getByRole("link", { name: /Build here/i });
    expect(buildHere.getAttribute("href")).toBe(
      "/corporation/corp-me?tab=sectors&expand=1&state=TX&sectorType=energy"
    );
  });

  it("shows the attack MS cost even when unowned splits are retired under plants", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ...payload,
          plantsMode: true,
          userCorporationId: "corp-me",
          userMarketingStrength: 36,
          splitMsCost: 0,
          attackMsCost: 128,
          sectors: payload.sectors.map((sector) => ({
            ...sector,
            owners: sector.owners.map((owner) => ({
              ...owner,
              attackCost: 147_000,
              attackEstimatedCapture: 155_000,
            })),
          })),
        }),
      })
    );

    render(<StateEconomy stateId="TX" countryId="US" />);

    const attack = await screen.findByRole("button", { name: "Attack" });
    expect(screen.getByText("128 MS")).toBeTruthy();
    expect(attack.hasAttribute("disabled")).toBe(true);
  });
});

describe("StateEconomy market control under plants (ticket #1162)", () => {
  /**
   * Under plants the route forces unownedPercent to 0 for every sector (#1145
   * took the unowned pool out of the market-share denominator), so the old
   * `100 - unownedPercent` read 100% on all 867 US cells including the 546 with
   * no corporation in them at all.
   */
  const plantsPayload = {
    ...payload,
    plantsMode: true,
    sectors: payload.sectors.map((s) => ({ ...s, unownedPercent: 0, headroomUnits: 1000 })),
  };

  const stubPlants = (overrides: Record<string, unknown> = {}) =>
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({ ...plantsPayload, ...overrides }) })
    );

  it("labels the per-sector stat Largest Share rather than Market Control", async () => {
    stubPlants();
    render(<StateEconomy stateId="TX" countryId="US" />);
    await waitFor(() => expect(screen.getByText("$1.82T")).toBeTruthy());

    expect(screen.getByText("Largest Share")).toBeTruthy();
    expect(screen.queryByText("Market Control")).toBeNull();
  });

  it("shows the leading corporation's share for an occupied sector", async () => {
    stubPlants();
    render(<StateEconomy stateId="TX" countryId="US" />);
    // Energy is selected first and its lone corp holds 34 percent.
    await waitFor(() => expect(screen.getByText("34.0%")).toBeTruthy());
  });

  it("shows Empty instead of 100% for a sector nobody operates in", async () => {
    stubPlants();
    render(<StateEconomy stateId="TX" countryId="US" />);
    await waitFor(() => expect(screen.getByText("$1.82T")).toBeTruthy());

    // Financial has owners: [] and, under plants, unownedPercent 0.
    fireEvent.change(screen.getByRole("combobox", { name: /select sector/i }), {
      target: { value: "financial" },
    });

    await waitFor(() => expect(screen.getByText("Empty")).toBeTruthy());
    expect(screen.queryByText("100.0%")).toBeNull();
  });

  it("summarises the state as a count of sectors anyone operates in", async () => {
    stubPlants();
    render(<StateEconomy stateId="TX" countryId="US" />);
    await waitFor(() => expect(screen.getByText("Active Sectors")).toBeTruthy());
    // One of the two fixture sectors has an owner. Read the tile itself rather
    // than a bare "1", which matches growth figures elsewhere on the board.
    const tile = screen.getByText("Active Sectors").parentElement!;
    expect(tile.textContent).toContain("1");
    expect(tile.textContent).toContain("of 2");
  });
});
