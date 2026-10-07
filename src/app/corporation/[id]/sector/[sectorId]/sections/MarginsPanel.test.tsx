/** @vitest-environment happy-dom */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MarginsPanel from "./MarginsPanel";
import type { Margins, PlantsData } from "../types";

vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({ formatAmount: (n: number) => `M${n}` }),
}));

const margins = {
  base: 35,
  effective: -18,
  commodityModifier: 24,
  homeLocationModifier: 5,
  sectorTypeMatchModifier: 5,
  typeSwitchModifier: -10,
} as Margins;
const pnl: PlantsData["pnl"] = {
  revenueAnchor: 100,
  inputsAnchor: 70,
  labourAnchor: 20,
  upkeepAnchor: 3,
  complianceAnchor: 2,
  policyAnchor: 5,
  policyPp: 5,
  otherOperatingAnchor: 25,
  growthAndBuildAnchor: 3,
  profitAnchor: -18,
  financialEventsAnchor: 0,
  avgSalePriceAnchor: 1,
  profitPerUnitAnchor: -0.18,
};

describe("sector margin explanation", () => {
  it("explains a physical loss with the costs that produce it, even when advisory modifiers are positive", () => {
    render(
      <MarginsPanel margins={margins} defaultExpanded fillAdjustedMarginPct={-18} {...{ pnl }} />
    );
    expect(screen.getByText("Inputs at market prices")).toBeTruthy();
    expect(screen.getByText("Revenue less all costs")).toBeTruthy();
    expect(screen.getByText(/These modifiers affect costs and sales/)).toBeTruthy();
    expect(screen.queryByText("Effective margin (sold units only)")).toBeNull();
  });
  it("names freight in the physical cost chain", () => {
    render(
      <MarginsPanel
        margins={margins}
        defaultExpanded
        pnl={{ ...pnl, freightCostAnchor: 20, profitAnchor: -38 }}
      />
    );
    expect(screen.getByText("Freight charges")).toBeTruthy();
    expect(
      within(screen.getByText("Freight charges").parentElement!).getByText("-20.0%")
    ).toBeTruthy();
    expect(screen.getAllByText("-38.0%")).toHaveLength(2);
  });

  it("preserves the modifier breakdown for sectors without physical records", () => {
    render(<MarginsPanel margins={margins} defaultExpanded />);
    expect(screen.getByText("Base margin")).toBeTruthy();
    expect(screen.getByText("Biggest effects right now")).toBeTruthy();
    expect(screen.queryByText("Revenue less all costs")).toBeNull();
  });
});
