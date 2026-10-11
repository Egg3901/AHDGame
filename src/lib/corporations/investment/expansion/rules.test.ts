import { describe, expect, it } from "vitest";
import { forecastSectorInvestment, type InvestmentForecastInput } from "../rules";
import {
  expansionOperatingReserve,
  expansionGapAfterExistingCapacity,
  recommendSectorExpansion,
  sellableExpansionUnits,
  stressExpansionForecast,
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
  revenueDailyAnchor: 20000,
  operatingCostDailyAnchor: 4800,
  inputsCostDailyAnchor: 0,
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
  it("reserves unused plants and undelivered builds before quoting room", () => {
    expect(
      expansionGapAfterExistingCapacity(500, [
        { capacity: 1000, produced: 600, queued: 100, weight: 0.5 },
        { capacity: 200, produced: 200, queued: 100, weight: 1 },
      ])
    ).toBe(150);
    expect(
      expansionGapAfterExistingCapacity(200, [
        { capacity: 1000, produced: 600, queued: 0, weight: 1 },
      ])
    ).toBe(0);
    expect(
      expansionGapAfterExistingCapacity(200, [
        { capacity: NaN, produced: 600, queued: 0, weight: 1 },
      ])
    ).toBeNull();
    expect(
      expansionGapAfterExistingCapacity(200, [
        { capacity: -100, produced: 0, queued: 0, weight: 1 },
      ])
    ).toBeNull();
    expect(
      expansionGapAfterExistingCapacity(200, [
        { capacity: 100, produced: 200, queued: 0, weight: 1 },
      ])
    ).toBe(200);
  });
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
    const nextTurn = forecastSectorInvestment(
      { ...stressExpansionForecast(forecast), units },
      [1]
    )![0];
    expect(nextTurn.availableCashAnchor).toBeGreaterThan(0);
  });
  it("refuses a profitable shortage-price build that loses cash when prices normalize", () => {
    const fragile = { ...forecast, revenueDailyAnchor: 10000 };
    expect(forecastSectorInvestment(fragile, [1])![0].availableCashAnchor).toBeGreaterThan(0);
    const result = recommendSectorExpansion({ ...input, forecast: fragile });
    expect(result.reason).toBe("unprofitable");
    expect(result.demandFacilities).toBe(0);
  });
  it("reserves the stressed input bill and keeps next-turn cash positive under both price moves", () => {
    const priceSensitive = { ...forecast, inputsCostDailyAnchor: 2400 };
    const result = recommendSectorExpansion({ ...input, forecast: priceSensitive });
    expect(result.demandFacilities).toBe(5);
    const stressed = stressExpansionForecast(priceSensitive);
    const units = result.demandFacilities * input.unitsPerFacility;
    const running =
      (units * stressed.operatingCostDailyAnchor) / stressed.producedUnits / stressed.turnsPerDay;
    expect(
      input.cashAnchor - units * stressed.chargedPerUnitAnchor - running
    ).toBeGreaterThanOrEqual(input.operatingReserveAnchor);
    expect(
      forecastSectorInvestment({ ...stressed, units }, [1])![0].availableCashAnchor
    ).toBeGreaterThan(0);
  });
  it("does not convert productivity-adjusted build room a second time", () => {
    const result = recommendSectorExpansion({
      ...input,
      cashAnchor: 100000,
      measuredDemandUnits: 1000,
      forecast: { ...forecast, producedUnits: 2000, soldUnits: 2000 },
    });
    expect(result.demandFacilities).toBe(10);
  });
  it("deducts queued capacity and rounds down to whole facilities", () => {
    expect(
      recommendSectorExpansion({ ...input, measuredDemandUnits: 599, queuedUnits: 300 })
        .demandFacilities
    ).toBe(2);
  });
  it("reserves running costs per capacity unit even when productivity doubles output", () => {
    const result = recommendSectorExpansion({
      ...input,
      cashAnchor: 970,
      forecast: { ...forecast, producedUnits: 2000, soldUnits: 2000 },
    });
    // 770 available, 110 construction plus 20 running per facility, not 10.
    expect(result.demandFacilities).toBe(5);
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
