/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MarketsStrip } from "./MarketsStrip";

const markets = {
  chairName: "J. Whitmore",
  stockMarketCap: 4_200_000_000_000,
  exchangeName: "NYSE",
  forexRate: 1.042,
  surplus: -800_000_000_000,
  deficitToGdp: -3.1,
};

describe("MarketsStrip", () => {
  it("renders the Stock Market and Forex handoff cards", () => {
    render(<MarketsStrip countryId="US" markets={markets} />);

    const stock = screen.getByRole("link", { name: /Stock Market/ });
    expect(stock.getAttribute("href")).toBe("/country/us/stockmarket");
    expect(stock.textContent).toContain("$4.20T");
    expect(stock.textContent).toContain("NYSE");

    const forex = screen.getByRole("link", { name: /Forex/ });
    expect(forex.getAttribute("href")).toBe("/country/us/forex");
    // the single deliberate anchor-unit appearance, matching the Forex page
    expect(forex.textContent).toContain("₳1 = $1.04");
  });

  it("does not duplicate the Central Bank or National Budget cards (those live in the pulse strip)", () => {
    render(<MarketsStrip countryId="US" markets={markets} />);
    expect(screen.queryByRole("link", { name: /Central Bank/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /National Budget/ })).toBeNull();
  });

  it("renders dashes when market stats are missing", () => {
    render(
      <MarketsStrip
        countryId="US"
        markets={{
          chairName: null,
          stockMarketCap: null,
          exchangeName: null,
          forexRate: null,
          surplus: null,
          deficitToGdp: null,
        }}
      />
    );
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });
});
