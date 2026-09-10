// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../messages/en/corporations.json";
import InvestmentForecast from "./InvestmentForecast";
import type { PlantsData } from "../types";

vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({ formatAmount: (n: number) => `$${n.toFixed(2)}` }),
}));
afterEach(cleanup);

const plants = {
  capacityUnits: 1000,
  producedUnits: 1000,
  soldUnits: 1000,
  demandGapUnits: 1000,
  mothballed: false,
  buildTurns: 48,
  depreciationPerTurn: 0,
  buildQuote: { perUnitAnchor: 100, perUnitChargedAnchor: 100 },
  pnl: {
    revenueAnchor: 1000,
    inputsAnchor: 300,
    labourAnchor: 200,
    complianceAnchor: 0,
    otherOperatingAnchor: 100,
    growthAndBuildAnchor: 0,
    upkeepAnchor: 0,
  },
  investment: { overheadDailyAnchor: 50, taxRatePercent: 20 },
} as PlantsData;
function view(data = plants) {
  render(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
      <InvestmentForecast plants={data} units={100} />
    </NextIntlClientProvider>
  );
}

describe("investment cash scenario", () => {
  it("shows all cumulative horizons and discloses reserves and the basis of remaining value", () => {
    view();
    for (const turns of [48, 96, 192])
      expect(screen.getByText(`After ${turns} turns`)).toBeTruthy();
    expect(screen.getByText(/Returns are cumulative, not annualized/)).toBeTruthy();
    expect(screen.getByText(/not a cash sale quote/)).toBeTruthy();
    expect(screen.getByText(/Over 96 turns: overhead/)).toBeTruthy();
  });
  it("does not turn previously stored inventory sales into recurring expansion income", () => {
    view({ ...plants, investment: { ...plants.investment!, inventoryRevenueDailyAnchor: 1000 } });
    const returns = screen.getAllByText(/^-\d+\.\d%$/);
    expect(returns).toHaveLength(3);
  });
  it("withholds the estimate when current-turn operating context is unavailable", () => {
    view({ ...plants, investment: undefined });
    expect(screen.getByText(/missing or stale/)).toBeTruthy();
    expect(screen.queryByText("After 48 turns")).toBeNull();
  });
  it("shows that a glut gives expansion no additional sales but still incurs costs", () => {
    view({ ...plants, demandGapUnits: 0 });
    expect(screen.getByText(/no measured unmet demand/)).toBeTruthy();
    expect(screen.getAllByText(/^-\d+\.\d%$/)).toHaveLength(3);
  });
});
