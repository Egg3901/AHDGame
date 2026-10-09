/** @vitest-environment happy-dom */
import { fireEvent, render, screen, within } from "@testing-library/react";
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
    expect(screen.getAllByText("Revenue less all costs").length).toBeGreaterThan(0);
    expect(screen.getByText(/readings behind the policy, tax and support line/)).toBeTruthy();
    expect(screen.queryByText("Effective margin (sold units only)")).toBeNull();
  });

  it("names a net-negative policy stack as a cost, not a credit (ticket 1448)", () => {
    render(
      <MarginsPanel
        margins={margins}
        defaultExpanded
        pnl={{ ...pnl, policyAnchor: -12.8, policyPp: -12.8, profitAnchor: -35.8 }}
      />
    );
    expect(screen.queryByText("Policy and technology credit")).toBeNull();
    const line = screen.getByText("Policy, tax and support").parentElement!;
    expect(within(line).getByText("-12.8%")).toBeTruthy();
  });

  it("itemizes the policy line with rows that add up to it (ticket 1448)", () => {
    const policyStack = [
      { key: "sectorTypeMatchModifier", label: "Sector match", pp: -15, anchor: -15 },
      { key: "homeLocationModifier", label: "Home location", pp: 2.5, anchor: 2.5 },
      { key: "other", label: "Other factors", pp: -0.3, anchor: -0.3 },
    ];
    render(
      <MarginsPanel
        margins={margins}
        defaultExpanded
        pnl={{ ...pnl, policyAnchor: -12.8, policyPp: -12.8, profitAnchor: -35.8 }}
        policyStack={policyStack}
      />
    );
    expect(screen.getByText("What is in policy, tax and support")).toBeTruthy();
    expect(
      within(screen.getByText("Sector match").parentElement!).getByText("-15.0%")
    ).toBeTruthy();
    expect(
      within(screen.getByText("Home location").parentElement!).getByText("+2.5%")
    ).toBeTruthy();
  });

  it("gives crisis losses their own line inside the cost chain", () => {
    render(
      <MarginsPanel
        margins={margins}
        defaultExpanded
        pnl={{ ...pnl, otherOperatingAnchor: 25, financialEventsAnchor: 5 }}
      />
    );
    expect(
      within(screen.getByText("Crisis and disaster losses").parentElement!).getByText("-5.0%")
    ).toBeTruthy();
    expect(
      within(screen.getByText("Other operating costs").parentElement!).getByText("-20.0%")
    ).toBeTruthy();
  });

  it("under plants, folds the conditions and drops the rows that move no money", () => {
    render(<MarginsPanel margins={margins} defaultExpanded pnl={pnl} />);
    expect(screen.queryByText("Commodity markets")).toBeNull();
    expect(screen.queryByText("Reference base margin")).toBeNull();
    expect(screen.queryByText("Home location")).toBeNull();
    fireEvent.click(screen.getByText("Condition details"));
    expect(screen.getByText("Home location")).toBeTruthy();
    expect(screen.queryByText("Commodity markets")).toBeNull();
    expect(screen.queryByText("Reference base margin")).toBeNull();
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
    expect(screen.getAllByText("Commodity markets").length).toBeGreaterThan(0);
    expect(screen.queryByText("Condition details")).toBeNull();
    expect(screen.queryByText("Revenue less all costs")).toBeNull();
  });
});
