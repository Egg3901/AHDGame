/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import CommoditiesPanel from "./CommoditiesPanel";
import type { CommoditiesData, CommodityFlow } from "../types";

// Mirrors the real corp 777 (copper mining, electricity input at 38% global
// availability) that prompted the "do I have to have all that supply IN
// that state?" question — this fixture reproduces the exact scenario.
const electricityDemand: CommodityFlow = {
  commodity: "electricity",
  label: "Electricity",
  icon: "kW",
  colors: "border-warning",
  unit: "MWh",
  units: 388_600,
  rate: 1,
  basePrice: 90,
  globalPrice: 88.76,
  nationalPrice: 68.59,
  regionalPrice: 88.77,
  marketPrice: 88.76,
  weight: 35.7,
  priceImpact: -9.68,
  inputAvailability: 0.38,
};

const commodities: CommoditiesData = {
  supplies: [],
  demands: [electricityDemand],
  commodityMarginModifier: -14.8,
};

describe("CommoditiesPanel — input availability scope labeling", () => {
  it("labels the shortage badge as global, not state/regional", () => {
    render(
      <CommoditiesPanel
        commodities={commodities}
        countryId="CN"
        forexEnabled={false}
        exchangeRates={{}}
      />
    );

    expect(screen.getByText("38% available globally (input-limited)")).toBeTruthy();
    // The old, ambiguous label must be gone.
    expect(screen.queryByText("38% available (input-limited)")).toBeNull();
  });

  it("tooltip explicitly disclaims a state/region-specific sourcing requirement", () => {
    render(
      <CommoditiesPanel
        commodities={commodities}
        countryId="CN"
        forexEnabled={false}
        exchangeRates={{}}
      />
    );

    const badge = screen.getByText("38% available globally (input-limited)");
    expect(badge.getAttribute("title")).toMatch(
      /global shortage, not something about your state or region/
    );
    expect(badge.getAttribute("title")).toMatch(/not something about your state or region/);
  });
});
