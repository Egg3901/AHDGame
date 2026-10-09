/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import InputsOutputsPanel from "./InputsOutputsPanel";
import type { CommoditiesData, CommodityFlow, PlantsData } from "../types";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
});
afterEach(() => vi.unstubAllGlobals());

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

  it("explains the exact global price drivers without calling them regional", () => {
    const attributed: CommoditiesData = {
      ...commodities,
      supplies: [
        flow({
          commodity: "advertising",
          label: "Advertising & Media",
          icon: "Ad",
          priceAttribution: {
            appliedPrice: 120,
            realBasePrice: 100,
            nominalInflation: 10,
            scarcityMemory: 2,
            producerInputCostPassThrough: 3,
            marketBalance: 8,
            adjustmentLag: -3,
            explicitOverride: 0,
          },
        }),
      ],
    };
    render(
      <InputsOutputsPanel
        commodities={attributed}
        plants={plants}
        countryId="US"
        isExtraction={false}
        forexEnabled={false}
        exchangeRates={{}}
      />
    );
    fireEvent.focus(screen.getByText("Advertising & Media").parentElement!);
    expect(screen.getByText(/Global price drivers: inflation \+10/)).toBeTruthy();
    expect(screen.getByText(/country and regional conditions set the local price/)).toBeTruthy();
  });

  it("reports what prices cost through the input bill, not a margin modifier (ticket 1448)", () => {
    // The legacy commodity modifier read +6.1% on a plant whose inputs ate 59.6%
    // of revenue. Under plants it moves no money, so it is not shown.
    const withPnl = {
      ...plants,
      pnl: { revenueAnchor: 1_768_578.76, inputsAnchor: 1_054_772.78 },
    } as PlantsData;
    render(
      <InputsOutputsPanel
        commodities={{ ...commodities, commodityMarginModifier: 6.1 }}
        plants={withPnl}
        countryId="US"
        isExtraction={false}
        forexEnabled={false}
        exchangeRates={{}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /details/i }));
    expect(screen.queryByText(/Net effect of prices/)).toBeNull();
    expect(screen.getByText("Your input bill, as a share of sales revenue")).toBeTruthy();
    expect(screen.getByText("59.6%")).toBeTruthy();
  });

  it("shows last turn's real amounts and sale price, so units x price matches the money panel (ticket 1448)", () => {
    // Nameplate rows: 10 + 5 units at billed 100 and 200 = 2,000 of inputs, 4
    // vehicles at a market 1,000. The plant actually ran at 90%: the booked
    // input bill was 1,800 and it made 3.6 vehicles, sold at 950 on average.
    const io: CommoditiesData = {
      supplies: [
        flow({
          commodity: "vehicles",
          label: "Vehicles & Machinery",
          icon: "Ve",
          units: 4,
          marketPrice: 1_000,
        }),
      ],
      demands: [
        flow({
          commodity: "steel",
          label: "Steel & Metals",
          icon: "Fe",
          units: 10,
          billedUnitPrice: 100,
        }),
        flow({
          commodity: "plastics",
          label: "Plastics & Polymers",
          icon: "Pl",
          units: 5,
          billedUnitPrice: 200,
        }),
      ],
      commodityMarginModifier: 0,
    };
    const ran = {
      fillRate: 1,
      producedUnits: 3.6,
      pnl: { revenueAnchor: 3_420, inputsAnchor: 1_800, avgSalePriceAnchor: 950 },
    } as PlantsData;
    render(
      <InputsOutputsPanel
        commodities={io}
        plants={ran}
        countryId="US"
        isExtraction={false}
        forexEnabled={false}
        exchangeRates={{}}
      />
    );
    const row = (label: string) => screen.getByText(label).closest("li")!;
    expect(within(row("Steel & Metals")).getByText("9")).toBeTruthy();
    expect(within(row("Plastics & Polymers")).getByText("4.5")).toBeTruthy();
    expect(within(row("Vehicles & Machinery")).getByText("3.6")).toBeTruthy();
    expect(within(row("Vehicles & Machinery")).getByText(/950/)).toBeTruthy();
    expect(within(row("Vehicles & Machinery")).queryByText(/1,000/)).toBeNull();
  });
});
