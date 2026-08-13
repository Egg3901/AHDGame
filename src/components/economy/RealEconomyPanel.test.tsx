/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RealEconomyPanel } from "./RealEconomyPanel";

const realEconomy = {
  wageGrowth: 1.8,
  tradeGrowth: -0.4,
  householdPriceIndex: 1.25,
  unemployment: { value: 4.6, trend: -0.2 },
  medianIncome: { value: 74_200, trend: 1.1 },
  realMedianIncome: 59_360,
  population: 151_300_000,
};

describe("RealEconomyPanel", () => {
  it("renders the rows with values and one-hop source links", () => {
    render(
      <RealEconomyPanel
        countryId="US"
        realEconomy={realEconomy}
        gdpPerCapita={2600}
        formatIncome={(v) => `$${v}`}
      />
    );
    expect(screen.getByText("Wage growth")).toBeTruthy();
    expect(screen.getByText("+1.8%")).toBeTruthy();
    expect(screen.getByText("Trade growth")).toBeTruthy();
    expect(screen.getByText("-0.4%")).toBeTruthy();
    expect(screen.getByText("Unemployment")).toBeTruthy();
    expect(screen.getByText("4.6%")).toBeTruthy();
    expect(screen.getByText("Median income")).toBeTruthy();
    expect(screen.getByText("$74200")).toBeTruthy();
    expect(screen.getByText("Real median income")).toBeTruthy();
    expect(screen.getByText("$59360")).toBeTruthy();
    expect(screen.getByText("Household prices")).toBeTruthy();
    expect(screen.getByText("125.0")).toBeTruthy();
    // SP6 statistics-home rows
    expect(screen.getByText("GDP per capita")).toBeTruthy();
    expect(screen.getByText("$2600")).toBeTruthy();
    expect(screen.getByText("Population")).toBeTruthy();
    expect(screen.getByText("151.3M")).toBeTruthy();

    const budgetLink = screen.getByRole("link", { name: /National Budget/ });
    expect(budgetLink.getAttribute("href")).toBe("/country/us/budget");
    const tradeLink = screen.getByRole("link", { name: /Tariffs & trade/ });
    expect(tradeLink.getAttribute("href")).toBe("/country/us/policy");
  });

  it("SP6: playables drop the rankings link (their /metrics redirects to the registry)", () => {
    render(
      <RealEconomyPanel
        countryId="US"
        realEconomy={realEconomy}
        gdpPerCapita={2600}
        formatIncome={(v) => `$${v}`}
      />
    );
    expect(screen.queryByRole("link", { name: /State rankings/ })).toBeNull();
  });

  it("non-playables keep the metric ranking links", () => {
    render(
      <RealEconomyPanel
        countryId="JP"
        realEconomy={realEconomy}
        gdpPerCapita={2600}
        formatIncome={(v) => `¥${v}`}
      />
    );
    const rankingLinks = screen.getAllByRole("link", { name: /rankings/ });
    expect(rankingLinks[0].getAttribute("href")).toBe("/country/jp/metrics");
  });

  it("encodes polarity, not bare direction: falling unemployment reads good", () => {
    render(
      <RealEconomyPanel
        countryId="US"
        realEconomy={realEconomy}
        gdpPerCapita={2600}
        formatIncome={(v) => `$${v}`}
      />
    );
    // unemployment trend −0.2 → ▼ glyph with success tone
    const chip = screen.getByText(/-0\.2pp/);
    expect(chip.textContent).toContain("▼");
    expect(chip.className).toContain("text-success");
    // negative trade growth → ▼ with error tone
    const tradeChip = screen.getByText(/-0\.4%.*▼/);
    expect(tradeChip.className).toContain("text-error");
  });

  it("renders dashes for missing values", () => {
    render(
      <RealEconomyPanel
        countryId="US"
        realEconomy={{
          wageGrowth: null,
          tradeGrowth: null,
          householdPriceIndex: 1,
          unemployment: { value: null, trend: null },
          medianIncome: { value: null, trend: null },
          realMedianIncome: null,
          population: null,
        }}
        gdpPerCapita={null}
        formatIncome={(v) => `$${v}`}
      />
    );
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(6);
  });
});
