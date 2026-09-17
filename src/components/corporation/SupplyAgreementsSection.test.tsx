/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import SupplyAgreementsSection from "./SupplyAgreementsSection";
import enCorporations from "../../../messages/en/corporations.json";

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

function render(ui: React.ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enCorporations}>
      {ui}
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        agreements: [
          {
            _id: "agreement-1",
            supplierCorpId: "supplier",
            supplierCorpName: "Gridworks",
            supplierCorpTicker: "GRID",
            buyerCorpId: "buyer",
            buyerCorpName: "Buyer Industries",
            buyerCorpTicker: "BUY",
            commodity: "energy",
            volumeCap: 80,
            pricePremium: 0,
            status: "active",
            proposedByCorpId: "supplier",
            lastDeliveryTurn: 296,
            lastDeliveredUnits: 60,
            lastAchievableUnits: 70,
            lastCreditedProductionUnits: 60,
            lastShortfallUnits: 10,
            lastShortfallPenaltyAnchor: 250,
            lastSupplierCashDelta: -250,
            lastSupplierCashCurrency: "USD",
          },
          {
            _id: "agreement-2",
            supplierCorpId: "supplier",
            supplierCorpName: "Gridworks",
            supplierCorpTicker: "GRID",
            buyerCorpId: "buyer2",
            buyerCorpName: "Lone Star Mining",
            buyerCorpTicker: "LSM",
            commodity: "freight",
            stateId: "TX",
            volumeCap: 120,
            pricePremium: 0.05,
            exclusive: false,
            status: "pending",
            proposedByCorpId: "supplier",
            currentOffer: {
              revision: 2,
              proposedByCorpId: "supplier",
              volumeCap: 120,
              pricePremium: 0.05,
              exclusive: false,
              proposedAt: "2026-09-12T00:00:00.000Z",
            },
            offers: [
              {
                revision: 1,
                proposedByCorpId: "buyer2",
                volumeCap: 100,
                pricePremium: 0,
                exclusive: false,
                proposedAt: "2026-09-11T00:00:00.000Z",
              },
              {
                revision: 2,
                proposedByCorpId: "supplier",
                volumeCap: 120,
                pricePremium: 0.05,
                exclusive: false,
                proposedAt: "2026-09-12T00:00:00.000Z",
              },
            ],
          },
          {
            _id: "agreement-3",
            supplierCorpId: "supplier",
            supplierCorpName: "Gridworks",
            supplierCorpTicker: "GRID",
            buyerCorpId: "buyer",
            buyerCorpName: "Buyer Industries",
            buyerCorpTicker: "BUY",
            commodity: "steel",
            volumeCap: 100,
            pricePremium: -0.05,
            exclusive: false,
            status: "pending",
            proposedByCorpId: "supplier",
            currentOffer: {
              revision: 2,
              proposedByCorpId: "supplier",
              volumeCap: 100,
              pricePremium: -0.05,
              exclusive: false,
              proposedAt: "2026-09-12T00:00:00.000Z",
            },
            offers: [
              {
                revision: 1,
                proposedByCorpId: "buyer",
                volumeCap: 100,
                pricePremium: 0,
                exclusive: false,
                proposedAt: "2026-09-11T00:00:00.000Z",
              },
              {
                revision: 2,
                proposedByCorpId: "supplier",
                volumeCap: 100,
                pricePremium: -0.05,
                exclusive: false,
                proposedAt: "2026-09-12T00:00:00.000Z",
              },
            ],
          },
        ],
        capacityByCommodity: {
          energy: {
            currentCapacityUnits: 75,
            achievableUnits: 70,
            maxContractUnits: 90,
          },
        },
        capacityByState: {
          freight: {
            TX: {
              stateName: "Texas",
              currentCapacityUnits: 400,
              achievableUnits: 380,
              maxContractUnits: 480,
            },
          },
        },
      }),
    })
  );
});

describe("SupplyAgreementsSection delivery outcome", () => {
  it("shows the buyer the agreement's latest physical delivery", async () => {
    render(<SupplyAgreementsSection corpId="buyer" />);

    await waitFor(() => expect(screen.getByText("As buyer")).toBeTruthy());
    expect(screen.getAllByRole("link", { name: /Gridworks \(GRID\)/ }).length).toBeGreaterThan(0);
    expect(screen.getByText(/60 MWh on turn 296/)).toBeTruthy();
  });

  it("shows the buyer name on the supplier's agreement card", async () => {
    render(<SupplyAgreementsSection corpId="supplier" />);

    await waitFor(() => expect(screen.getByText("As supplier")).toBeTruthy());
    expect(
      screen.getAllByRole("link", { name: /Buyer Industries \(BUY\)/ }).length
    ).toBeGreaterThan(0);
    expect(screen.getByText("Shortfall damages")).toBeTruthy();
    expect(screen.getByText("Chargeable shortfall")).toBeTruthy();
    expect(screen.getByText("Damages assessed")).toBeTruthy();
    expect(screen.getByText("Net contract cash")).toBeTruthy();
  });

  it("shows capacity and the penalty before the supplier proposes a commitment", async () => {
    render(<SupplyAgreementsSection corpId="supplier" />);

    await waitFor(() => expect(screen.getByText("As supplier")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Propose agreement" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "energy" } });

    expect(screen.getByText("Current contract capacity")).toBeTruthy();
    expect(screen.getByText("Latest achievable output")).toBeTruthy();
    expect(screen.getByText("Maximum legal commitment")).toBeTruthy();
    expect(screen.getByText(/50% of the market value/)).toBeTruthy();
  });

  it("asks for the fulfilling state when freight is selected", async () => {
    render(<SupplyAgreementsSection corpId="supplier" />);

    await waitFor(() => expect(screen.getByText("As supplier")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Propose agreement" }));
    fireEvent.change(screen.getAllByRole("combobox")[0]!, { target: { value: "freight" } });

    expect(screen.getByText("Fulfilled from state")).toBeTruthy();
    expect(screen.getByRole("option", { name: "Texas (TX)" })).toBeTruthy();
    fireEvent.change(screen.getAllByRole("combobox")[1]!, { target: { value: "TX" } });
    expect(screen.getByText("Current contract capacity")).toBeTruthy();
    expect(screen.getByText(/Freight is haulage capacity based in one state/)).toBeTruthy();
  });

  it("shows the state on a freight agreement card", async () => {
    render(<SupplyAgreementsSection corpId="supplier" />);

    await waitFor(() => expect(screen.getByText("As supplier")).toBeTruthy());
    expect(screen.getByText(/· TX/)).toBeTruthy();
  });

  it("lets the receiving CEO open a counter-offer and keeps the revision history visible", async () => {
    render(<SupplyAgreementsSection corpId="buyer" />);

    await waitFor(() => expect(screen.getByText("As buyer")).toBeTruthy());
    expect(screen.getByText("Revision 2 from the counterparty")).toBeTruthy();
    expect(screen.getByText("Offer history (2 revisions)")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Counter-offer" }));
    fireEvent.change(screen.getByLabelText("Volume cap per turn"), {
      target: { value: "110" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send counter-offer" }));

    await waitFor(() =>
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        "/api/corporations/buyer/supply-agreements/agreement-3",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            action: "counter",
            volumeCap: 110,
            pricePremium: -0.05,
            exclusive: false,
          }),
        })
      )
    );
  });

  it("lets the buyer CEO open an offer to a searched supplier", async () => {
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("buyer-search")) {
        return {
          ok: true,
          json: async () => ({
            results: [{ id: "supplier", name: "Gridworks", ticker: "GRID", countryId: "US" }],
          }),
        } as Response;
      }
      if (init?.method === "POST") {
        return { ok: true, json: async () => ({ success: true }) } as Response;
      }
      return {
        ok: true,
        json: async () => ({ agreements: [], capacityByCommodity: {}, capacityByState: {} }),
      } as Response;
    });

    render(<SupplyAgreementsSection corpId="buyer" />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Propose agreement" })).toBeTruthy()
    );
    fireEvent.click(screen.getByRole("button", { name: "Propose agreement" }));
    fireEvent.click(screen.getByRole("button", { name: "I need supply" }));
    fireEvent.change(screen.getByPlaceholderText("Search corporations by name…"), {
      target: { value: "Grid" },
    });
    await waitFor(() => expect(screen.getByRole("button", { name: /Gridworks/ })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Gridworks/ }));
    fireEvent.change(screen.getByPlaceholderText("e.g. 5000"), { target: { value: "200" } });
    fireEvent.click(screen.getByRole("button", { name: "Send opening offer" }));

    await waitFor(() =>
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        "/api/corporations/buyer/supply-agreements",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"supplierCorpId":"supplier"'),
        })
      )
    );
  });
});
