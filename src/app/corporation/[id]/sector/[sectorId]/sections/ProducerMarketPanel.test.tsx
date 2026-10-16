/** @vitest-environment happy-dom */
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { producerSectorView } from "@/lib/market/producerMarket/sectorViewRules";
import { sectorReceipt } from "@/lib/market/producerMarket/__fixtures__/sectorReceipt";
import ProducerMarketPanel from "./ProducerMarketPanel";

vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({
    formatAmount: (value: number) => `M${value}`,
    formatPrice: (value: number) => `P${value}`,
    toDisplay: (value: number) => value * 2,
    toInternal: (value: number) => value / 2,
    inputSymbol: "USD",
  }),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function show(isCeo = true) {
  const market = producerSectorView({
    receipt: sectorReceipt(),
    commodities: ["financial_services"],
    policies: {},
    canManage: isCeo,
  });
  render(
    <ProducerMarketPanel corporationId="corp" sectorId="sector" isCeo={isCeo} market={market} />
  );
}

describe("producer market controls", () => {
  it("offers the same pricing policies to finance and shows its loss despite full sales", () => {
    show();
    expect(screen.getByRole("button", { name: "Cost + markup" })).toBeTruthy();
    expect(screen.getAllByText("M-14")).toHaveLength(2);
    expect(screen.getByText(/100% of offered output sold/)).toBeTruthy();
    expect(screen.getByText(/Produced 2 from 100 active capacity/)).toBeTruthy();
  });

  it("saves a fixed per-unit price in anchor money after display-currency conversion", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", request);
    show();
    fireEvent.click(screen.getByRole("button", { name: "Fixed price" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: /asking price/ }), {
      target: { value: "8" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save pricing" }));
    await waitFor(() => expect(request).toHaveBeenCalled());
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({
      quotes: { financial_services: { kind: "manual", unitPrice: 4 } },
    });
    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
  });

  it("publishes prices without exposing owner costs or edit controls to a visitor", () => {
    show(false);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText("Operating profit")).toBeNull();
    expect(screen.getAllByText("P3")).toHaveLength(2);
  });
});
