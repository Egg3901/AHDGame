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
            status: "pending",
            proposedByCorpId: "supplier",
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
    expect(screen.getByRole("link", { name: /Gridworks \(GRID\)/ })).toBeTruthy();
    expect(screen.getByText(/60 MWh on turn 296/)).toBeTruthy();
  });

  it("shows the buyer name on the supplier's agreement card", async () => {
    render(<SupplyAgreementsSection corpId="supplier" />);

    await waitFor(() => expect(screen.getByText("As supplier")).toBeTruthy());
    expect(screen.getByRole("link", { name: /Buyer Industries \(BUY\)/ })).toBeTruthy();
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
});
