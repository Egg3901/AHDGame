/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import CommoditiesTab from "./CommoditiesTab";

vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({ formatAmount: (amount: number) => `$${Math.round(amount)}` }),
}));

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        clearingEnabled: true,
        ledgerEnabled: true,
        supplyAgreementsEnabled: true,
        commodities: [
          {
            commodity: "energy",
            label: "Energy",
            icon: "EN",
            color: "bg-yellow-500",
            unit: "MWh",
            outputUnits: 0,
            consumptionUnits: 100,
            netUnits: -100,
            market: {
              price: 50,
              stockUnits: null,
              coverTurns: null,
              spoiledUnits: null,
              surplusUnits: null,
              unmetDemandUnits: null,
            },
            privateSupply: {
              contractedUnits: 80,
              deliveredUnits: 60,
              consumptionCoveredUnits: 60,
              coveragePercent: 60,
              turn: 296,
            },
          },
        ],
        regions: [],
        marketShare: [],
      }),
    })
  );
});

describe("CommoditiesTab private supply", () => {
  it("shows the buyer how much consumption its agreements actually delivered", async () => {
    render(<CommoditiesTab corpId="buyer" isCeo />);

    await waitFor(() => expect(screen.getByText("Energy")).toBeTruthy());
    expect(screen.getByText("Private supply")).toBeTruthy();
    expect(screen.getByText(/60 MWh delivered on turn 296/)).toBeTruthy();
    expect(screen.getByText(/60% of consumption covered/)).toBeTruthy();
    expect(screen.getByText(/Contracted cap: 80 MWh/)).toBeTruthy();
    expect(screen.getByText(/Scarce supplier output is divided proportionally/)).toBeTruthy();
    expect(
      screen.getByText(/Net is this corporation's own output minus its input use/)
    ).toBeTruthy();
  });

  it("links supply-deal actions to the Structure tab where the form lives", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        clearingEnabled: true,
        supplyAgreementsEnabled: true,
        commodities: [
          {
            commodity: "freight",
            label: "Freight",
            icon: "FR",
            color: "bg-sky-500",
            unit: "units",
            outputUnits: 100,
            consumptionUnits: 0,
            netUnits: 100,
            market: {},
          },
        ],
        regions: [],
        marketShare: [],
      }),
    } as Response);

    render(<CommoditiesTab corpId="604" isCeo />);

    const link = await screen.findByRole("link", { name: "Supply deal" });
    expect(link.getAttribute("href")).toBe("/corporation/604?tab=ownership&sub=structure");
    expect(screen.getByRole("link", { name: "Structure" }).getAttribute("href")).toBe(
      "/corporation/604?tab=ownership&sub=structure"
    );
  });
});
