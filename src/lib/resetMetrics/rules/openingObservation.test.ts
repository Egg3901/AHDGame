import { describe, expect, it } from "vitest";
import { primaryMetrics } from "../catalog";
import { buildOpeningMetricObservation } from "./openingObservation";

describe("1991 reset metric observation contract", () => {
  it("covers all 58 primary metrics without silently inventing a value", () => {
    expect(primaryMetrics).toHaveLength(58);
    for (const metric of primaryMetrics) {
      const result = buildOpeningMetricObservation(metric.id, {});
      expect(result.metricId).toBe(metric.id);
      expect(result.owner).toBe(metric.owner);
      expect(result.value).toBeNull();
      expect(result.status).toBe("unavailable");
    }
  });

  it("carries legitimate zero observations but recomputes owner-sourced outcomes", () => {
    expect(buildOpeningMetricObservation("28", { legacyValue: 0 })).toMatchObject({
      value: 0,
      status: "observed",
    });
    expect(buildOpeningMetricObservation("09", { legacyValue: 50 }).value).toBeNull();
    expect(buildOpeningMetricObservation("09", { ownerValue: -2.4 })).toMatchObject({
      value: -2.4,
      status: "derived",
    });
  });

  it("requires real inputs for household, health, justice and cohort derivations", () => {
    expect(
      buildOpeningMetricObservation("02", {
        afterTaxMedianResources: 30_000,
        consumerBasketCost: 12_000,
        consumerResourcesReferenceRatio: 2,
      })
    ).toMatchObject({ value: 125, status: "derived" });
    expect(
      buildOpeningMetricObservation("02", {
        afterTaxMedianResources: 30_000,
        consumerBasketCost: 12_000,
      }).value
    ).toBeNull();
    expect(
      buildOpeningMetricObservation("15", {
        researcherCapacity: 4,
        laboratoryCapacity: 5,
        researchQuality: 2,
        researchCompositeReference: 32,
      }).value
    ).toBe(125);
    expect(
      buildOpeningMetricObservation("24", {
        housingPaymentToIncome: 0.3,
        housingBurdenReference: 0.25,
      }).value
    ).toBe(120);
    expect(
      buildOpeningMetricObservation("12", {
        testedCohortScore: 105,
        testedCohortReference: 100,
      }).value
    ).toBe(105);
    expect(buildOpeningMetricObservation("12", { testedCohortScore: 105 }).value).toBeNull();
    expect(
      buildOpeningMetricObservation("16", {
        uninsuredPercent: 11,
        reachableServicePercent: 82,
      }).value
    ).toBe(82);
    expect(
      buildOpeningMetricObservation("32", {
        totalCrimeRate: 800,
        violentCrimeRate: 250,
      }).value
    ).toBeNull();
    expect(
      buildOpeningMetricObservation("32", {
        totalCrimeRate: 800,
        violentCrimeRate: 250,
        offenseUniverseReconciled: true,
      }).value
    ).toBe(550);
    expect(
      buildOpeningMetricObservation("56", {
        populationUnder15: 20,
        population15To64: 60,
        population65Plus: 20,
      }).value
    ).toBeCloseTo(66.667, 2);
  });

  it("never substitutes grid reliability for energy security", () => {
    expect(buildOpeningMetricObservation("58", { legacyValue: 99 }).value).toBeNull();
    expect(
      buildOpeningMetricObservation("58", {
        physicalFuelLedgerVerified: true,
        energyRiskBand: 0.4,
      }).value
    ).toBe(0.4);
  });
});
