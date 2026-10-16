/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en/profile.json";
import { StockHoldingsView } from "./StockHoldingsView";
import type { Holding } from "./HoldingsTables";
vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({
    formatAmount: (value: number) => `value:${value}`,
    formatPrice: (value: number) => `price:${value}`,
    toInternalFrom: (value: number, currency: string) => (currency === "GBP" ? value / 2 : value),
  }),
}));
vi.mock("@/components/corporation/CorporationLogo", () => ({ CorporationLogo: () => null }));
afterEach(cleanup);
const holding: Holding = {
  corporationId: "corp",
  corporationName: "Sample Corp",
  shares: 10,
  sharePrice: 10,
  totalValue: 100,
  currencyCode: "GBP",
  holdingTurn: 147,
  holdingTerms: {
    longTermShares: 4,
    longTermCostBasisAnchor: 8,
    shortTermLots: [{ acquiredTurn: 100, shares: 6, costBasisAnchor: 12 }],
  },
};
function show(holdings: Holding[]) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <StockHoldingsView holdings={holdings} />
    </NextIntlClientProvider>
  );
}
describe("stock holding view", () => {
  it("shows combined and bucket values with currency normalization, and filters the table", () => {
    show([holding]);
    expect(screen.getAllByText("value:50").length).toBeGreaterThan(0);
    expect(screen.getAllByText("value:30").length).toBeGreaterThan(0);
    expect(screen.getAllByText("value:20").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Sample Corp" })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Short Term Holdings" }));
    expect(screen.getAllByRole("link", { name: "Sample Corp" })).toHaveLength(1);
    expect(screen.getByText(/Bought on turn 100/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Long Term Holdings" }));
    expect(screen.queryByText(/Bought on turn 100/)).toBeNull();
    expect(screen.getAllByRole("link", { name: "Sample Corp" })).toHaveLength(1);
  });
  it("matures displayed values and rows at 48 turns", () => {
    show([{ ...holding, holdingTurn: 148 }]);
    expect(screen.getByText("value:0")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Short Term Holdings" }));
    expect(screen.queryByRole("link", { name: "Sample Corp" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Long Term Holdings" }));
    expect(screen.getByRole("link", { name: "Sample Corp" })).toBeTruthy();
  });
});
