/** Reproducible specialization scenarios with equal capital and fixed market inputs. */
import assert from "node:assert/strict";
import { computeBuildCost, CAPACITY_BUILD_TURNS } from "../../src/lib/constants/capacityEconomy";
import { forecastSectorInvestment } from "../../src/lib/corporations/investment/rules";
import { getSectorTypeMatchModifier } from "../../src/lib/corporations/specialization/rules";
import { softCapEffectiveMargin, type CorporationType } from "../../src/lib/constants/corporations";

const capital = 100_000;
const results = [];
for (const type of ["energy", "retail", "manufacturing", "real_estate"] as CorporationType[]) {
  for (const demand of ["buyers", "glut"] as const) {
    const quote = computeBuildCost({
      sectorType: type,
      strategyId: "standard",
      units: 1,
      year: 1966,
      eraUnitScale: 1,
      primeRate: 5,
    });
    const runs = [5, getSectorTypeMatchModifier(type, type)].map((bonus) => {
      const revenue = 100_000;
      const operatingCost = revenue * (1 - 35 / 100);
      const policyCredit = revenue * ((softCapEffectiveMargin(35 + bonus) - 35) / 100);
      return forecastSectorInvestment({
        units: capital / quote.totalAnchor,
        constructionPerUnitAnchor: quote.totalAnchor,
        chargedPerUnitAnchor: quote.totalAnchor,
        buildTurns: CAPACITY_BUILD_TURNS(type),
        depreciationPerTurn: 0.0005,
        turnsPerDay: 24,
        capacityUnits: 1000,
        activeFraction: 1,
        producedUnits: 850,
        soldUnits: 850,
        demandGapUnits: demand === "buyers" ? 1_000_000 : 0,
        revenueDailyAnchor: revenue,
        operatingCostDailyAnchor: operatingCost,
        policyCreditDailyAnchor: policyCredit,
        overheadDailyAnchor: revenue * 0.05,
        upkeepDailyAnchor: 1000,
        taxRatePercent: 20,
      })!;
    });
    for (let i = 0; i < 3; i++) {
      assert.equal(runs[0][i].soldUnitsDaily, runs[1][i].soldUnitsDaily);
      assert.equal(runs[0][i].replacementReserveAnchor, runs[1][i].replacementReserveAnchor);
      assert.ok(runs[1][i].availableCashAnchor >= runs[0][i].availableCashAnchor);
      if (demand === "glut") {
        assert.ok(runs[1][i].availableCashAnchor < 0);
        assert.equal(runs[1][i].availableCashAnchor, runs[0][i].availableCashAnchor);
      }
    }
    results.push({
      type,
      demand,
      baseline: runs[0].map((r) => Number(r.cashReturnPercent.toFixed(2))),
      candidate: runs[1].map((r) => Number(r.cashReturnPercent.toFixed(2))),
    });
  }
}
console.log(JSON.stringify({ capital, horizons: [48, 96, 192], results }, null, 2));
