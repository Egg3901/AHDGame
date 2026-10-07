/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import messages from "../../../messages/en/corporations.json";
import { BondHoldingsPanel } from "./BondHoldingsPanel";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) =>
    messages.corporations.fundBondHoldings[
      key.split(".")[1] as keyof typeof messages.corporations.fundBondHoldings
    ],
}));
afterEach(cleanup);

describe("BondHoldingsPanel", () => {
  it("shows purchased bond units and market value with a link to the issuer", () => {
    render(
      <BondHoldingsPanel
        holdings={[
          {
            bondId: "series-1",
            corporationId: "issuer-1",
            sequentialId: 5,
            issuerType: "corporation",
            issuerName: "Example issuer",
            countryId: null,
            units: 5000,
            couponRate: 6,
            marketPrice: 0.9,
            maturityTurn: 100,
            valueAnchor: 2_250_000,
          },
        ]}
        formatAmount={(n) => `value:${n}`}
        ccy="USD"
      />
    );
    expect(screen.getByRole("link", { name: "Example issuer" }).getAttribute("href")).toBe(
      "/corporation/5"
    );
    expect(screen.getByText("5,000")).toBeTruthy();
    expect(screen.getByText("value:2250000")).toBeTruthy();
    expect(screen.getByText("6.00%")).toBeTruthy();
    expect(screen.queryByText("No active bond holdings.")).toBeNull();
  });

  it("shows an explicit empty state when the fund owns no active bonds", () => {
    render(<BondHoldingsPanel holdings={[]} formatAmount={String} ccy="USD" />);
    expect(screen.getByText("No active bond holdings.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
