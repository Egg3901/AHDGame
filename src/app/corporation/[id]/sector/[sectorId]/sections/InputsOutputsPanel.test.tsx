/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import InputsOutputsPanel from "./InputsOutputsPanel";
import type { CommoditiesData, CommodityFlow, PlantsData } from "../types";

function flow(
  partial: Pick<CommodityFlow, "commodity" | "label" | "icon"> & Partial<CommodityFlow>
): CommodityFlow {
  return {
    colors: "border-card-border",
    unit: "u",
    units: 0.1,
    rate: 1,
    basePrice: 100,
    globalPrice: 100,
    nationalPrice: 100,
    regionalPrice: 100,
    marketPrice: 100,
    weight: 10,
    priceImpact: 0,
    ...partial,
  };
}

const commodities: CommoditiesData = {
  supplies: [
    flow({
      commodity: "advertising",
      label: "Advertising & Media",
      icon: "Ad",
      units: 1.2,
      marketPrice: 3.36,
    }),
  ],
  demands: [
    flow({
      commodity: "software",
      label: "Software & IT Services",
      icon: "SW",
      billedUnitPrice: 619.76,
      inputAvailability: 0.66,
      shortageRatio: 1.5,
    }),
    flow({
      commodity: "electronics",
      label: "Electronics & Semiconductors",
      icon: "Si",
      billedUnitPrice: 309.88,
      inputAvailability: 0.61,
      shortageRatio: 1.5,
    }),
  ],
  commodityMarginModifier: -8,
  throughput: { bindingInput: "electronics", applied: 0.61, projected: 0.61 },
};

const plants = { fillRate: 0.9 } as PlantsData;

describe("InputsOutputsPanel layout", () => {
  it("keeps buy and make columns from sharing a grid track", () => {
    const { container } = render(
      <InputsOutputsPanel
        commodities={commodities}
        plants={plants}
        countryId="US"
        isExtraction={false}
        forexEnabled={false}
        exchangeRates={{}}
      />
    );

    expect(screen.getByRole("heading", { name: /things you buy/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /things you make/i })).toBeTruthy();
    expect(screen.getByText("Software & IT Services")).toBeTruthy();
    expect(screen.getByText("Advertising & Media")).toBeTruthy();

    const grid = container.querySelector("[data-io-grid]");
    expect(grid?.className).toMatch(/min-w-0/);
    expect(grid?.className).toMatch(/xl:grid-cols-2/);
    const sections = container.querySelectorAll("[data-io-grid] > section");
    expect(sections).toHaveLength(2);
    for (const section of sections) {
      expect(section.className).toMatch(/min-w-0/);
    }
  });
});
