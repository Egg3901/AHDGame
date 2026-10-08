import { describe, expect, it } from "vitest";
import { forecastSectorInvestment, type InvestmentForecastInput } from "../rules";
import {
  expansionOperatingReserve,
  recommendSectorExpansion,
  sellableExpansionUnits,
} from "./rules";
const forecast: InvestmentForecastInput = {
  units: 100,
  constructionPerUnitAnchor: 1,
  chargedPerUnitAnchor: 1.1,
  buildTurns: 24,
  depreciationPerTurn: 0,
  turnsPerDay: 24,
  capacityUnits: 1000,
  activeFraction: 1,
  producedUnits: 1000,
  soldUnits: 1000,
  demandGapUnits: 10000,
  revenueDailyAnchor: 10000,
  operatingCostDailyAnchor: 4800,
  overheadDailyAnchor: 0,
  upkeepDailyAnchor: 0,
  taxRatePercent: 0,
};
const input = {
  unitsPerFacility: 100,
  measuredDemandUnits: 10000,
  shareHeadroomUnits: 10000,
  queuedUnits: 0,
  cashAnchor: 1000,
  operatingReserveAnchor: 200,
  constrained: false,
  forecast,
};
describe("automatic expansion sizing", () => {
  it("uses the weakest measured output instead of averaging a shortage with a glut", () => {
    expect(
      sellableExpansionUnits([
        { weight: 0.8, gap: 8000 },
        { weight: 0.2, gap: 0 },
      ])
    ).toBe(0);
    expect(
      sellableExpansionUnits([
        { weight: 0.8, gap: 8000 },
        { weight: 0.2, gap: 100 },
      ])
    ).toBe(500);
    expect(sellableExpansionUnits([{ weight: 1, gap: NaN }])).toBe(0);
  });
  it("reserves fully delivered queued costs across the company and rejects stale figures", () => {
    expect(
      expansionOperatingReserve({
        overheadPerTurnAnchor: 10,
        sectors: [{ costPerTurnAnchor: 100, capacityUnits: 1000, queuedUnits: 500, current: true }],
      })
    ).toBe(160);
    expect(
      expansionOperatingReserve({
        overheadPerTurnAnchor: 10,
        sectors: [{ costPerTurnAnchor: 100, capacityUnits: 1000, queuedUnits: 0, current: false }],
      })
    ).toBeNull();
  });
  it("keeps current company expenses plus full new running costs in cash, including FX fees", () => {
    const result = recommendSectorExpansion(input);
    expect(result.demandFacilities).toBe(6); // 6*(110 purchase + 20 running) leaves 220.
    const units = result.demandFacilities * input.unitsPerFacility;
    const cashAfterBuild = input.cashAnchor - units * forecast.chargedPerUnitAnchor;
    const fullNewRunningCosts =
      (units * forecast.operatingCostDailyAnchor) / forecast.producedUnits / forecast.turnsPerDay;
    expect(cashAfterBuild).toBeGreaterThanOrEqual(
      input.operatingReserveAnchor + fullNewRunningCosts
    );
    const nextTurn = forecastSectorInvestment({ ...forecast, units }, [1])![0];
    expect(nextTurn.availableCashAnchor).toBeGreaterThan(0);
  });
  it("accounts for output above nominal capacity when matching the buyer limit", () => {
    const result = recommendSectorExpansion({
      ...input,
      cashAnchor: 100000,
      measuredDemandUnits: 1000,
      forecast: { ...forecast, producedUnits: 2000, soldUnits: 2000 },
    });
    expect(result.demandFacilities).toBe(5);
  });
  it("deducts queued capacity and rounds down to whole facilities", () => {
    expect(
      recommendSectorExpansion({ ...input, measuredDemandUnits: 599, queuedUnits: 300 })
        .demandFacilities
    ).toBe(2);
  });
  it.each([{ forecast: null }, { operatingReserveAnchor: null }, { measuredDemandUnits: null }])(
    "does not invent a recommendation from missing economic context: %j",
    (patch) => {
      expect(recommendSectorExpansion({ ...input, ...patch }).demandFacilities).toBe(0);
    }
  );
  it("refuses loss-making expansions even when the market has buyers and cash is plentiful", () => {
    const result = recommendSectorExpansion({
      ...input,
      forecast: { ...forecast, operatingCostDailyAnchor: 12000 },
    });
    expect(result.reason).toBe("unprofitable");
    expect(result.demandFacilities).toBe(0);
  });
  it("blocks staffing or delivery constraints and insufficient cash reserves", () => {
    expect(recommendSectorExpansion({ ...input, constrained: true }).reason).toBe("constraints");
    expect(recommendSectorExpansion({ ...input, cashAnchor: 210 }).reason).toBe("cash");
  });
});
