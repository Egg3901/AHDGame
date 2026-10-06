import { describe, expect, it } from "vitest";
import { calculateInflationWithBreakdown } from "@/lib/budget/inflation";
import {
  measuredTariffInflationRate,
  tariffInflationExposure,
  TARIFF_INFLATION_BASELINE,
} from "./tariffInflationExposure";

const neutralInflation = (tariffRate: number) =>
  calculateInflationWithBreakdown({
    unemployment: 5,
    gdpGrowth: 2,
    primeRate: 3,
    surplusToGdp: 0,
    tariffRate,
    wageGrowth: 2.5,
    commodityPressure: 0,
    forexPressure: 0,
    savingsPressure: 0,
    previousInflation: 2,
    policyStancePressure: 0,
  });

describe("tariffInflationExposure", () => {
  it("keeps a measured no-import market neutral despite a high statutory rate", () => {
    const result = tariffInflationExposure(
      {
        householdFinal: {
          domesticPreDutyValue: 50_000,
          importPreDutyValue: 0,
          tariffPaid: 0,
          deliveredTariffPaid: 0,
        },
        productionInput: {
          domesticPreDutyValue: 25_000,
          importPreDutyValue: 0,
          tariffPaid: 0,
          deliveredTariffPaid: 0,
        },
      },
      true
    );
    const baseline = neutralInflation(TARIFF_INFLATION_BASELINE);
    expect(result.tariffRate).toBe(TARIFF_INFLATION_BASELINE);
    expect(result.available).toBe(true);
    expect(neutralInflation(result.tariffRate).breakdown.tariff).toBe(0);
    expect(neutralInflation(40).breakdown.tariff - baseline.breakdown.tariff).toBeCloseTo(1.85);
  });

  it("weights actual duties by matched household and input absorption values", () => {
    const result = tariffInflationExposure(
      {
        householdFinal: {
          domesticPreDutyValue: 1_000,
          importPreDutyValue: 4_000,
          tariffPaid: 800,
          deliveredTariffPaid: 800,
        },
        productionInput: {
          domesticPreDutyValue: 1_000,
          importPreDutyValue: 4_000,
          tariffPaid: 800,
          deliveredTariffPaid: 800,
        },
      },
      true
    );
    expect(result.householdAbsorptionValue).toBe(5_000);
    expect(result.householdImportValue).toBe(4_000);
    expect(result.importShare).toBe(0.8);
    expect(result.householdTariffPaid).toBe(800);
    expect(result.tariffRate).toBeCloseTo(16.6);
    expect(neutralInflation(result.tariffRate).breakdown.tariff).toBeCloseTo(0.68);
  });

  it("keeps a baseline-rate duty neutral and scales an FTA exemption below baseline", () => {
    const exposure = {
      householdFinal: {
        domesticPreDutyValue: 1_000,
        importPreDutyValue: 4_000,
        tariffPaid: 120,
        deliveredTariffPaid: 120,
      },
      productionInput: {
        domesticPreDutyValue: 0,
        importPreDutyValue: 0,
        tariffPaid: 0,
        deliveredTariffPaid: 0,
      },
    };
    const baselineDuty = tariffInflationExposure(exposure, true);
    const exemptFlow = tariffInflationExposure(
      {
        ...exposure,
        householdFinal: { ...exposure.householdFinal, tariffPaid: 0, deliveredTariffPaid: 0 },
      },
      true
    );
    expect(baselineDuty.tariffRate).toBe(3);
    expect(neutralInflation(baselineDuty.tariffRate).breakdown.tariff).toBe(0);
    expect(exemptFlow.tariffRate).toBeCloseTo(0.6);
    expect(neutralInflation(exemptFlow.tariffRate).breakdown.tariff).toBeCloseTo(-0.06);
  });

  it("does not merge input tariff burden into the direct household CPI channel", () => {
    const result = tariffInflationExposure(
      {
        householdFinal: {
          domesticPreDutyValue: 4_000,
          importPreDutyValue: 1_000,
          tariffPaid: 100,
          deliveredTariffPaid: 100,
        },
        productionInput: {
          domesticPreDutyValue: 1_000,
          importPreDutyValue: 4_000,
          tariffPaid: 1_600,
          deliveredTariffPaid: 1_600,
        },
      },
      true
    );
    expect(result.tariffRate).toBeCloseTo(4.4);
    expect(result.productionInputImportShare).toBe(0.8);
    expect(result.productionInputTariffPaid).toBe(1_600);
  });

  it("distinguishes measured zero exposure from unavailable current-turn data", () => {
    const zero = {
      domesticPreDutyValue: 0,
      importPreDutyValue: 0,
      tariffPaid: 0,
      deliveredTariffPaid: 0,
    };
    const measuredZero = tariffInflationExposure(
      { householdFinal: zero, productionInput: zero },
      true
    );
    const unavailable = tariffInflationExposure(undefined, false);
    expect(measuredZero).toMatchObject({
      available: true,
      tariffRate: 3,
      householdAbsorptionValue: 0,
    });
    expect(unavailable).toMatchObject({
      available: false,
      tariffRate: 3,
      householdAbsorptionValue: 0,
    });
    expect(tariffInflationExposure(undefined, true).available).toBe(false);
  });

  it("marks invalid negative and non-finite exposure unavailable", () => {
    const result = tariffInflationExposure(
      {
        householdFinal: {
          domesticPreDutyValue: Number.NaN,
          importPreDutyValue: -500,
          tariffPaid: Number.POSITIVE_INFINITY,
          deliveredTariffPaid: Number.POSITIVE_INFINITY,
        },
        productionInput: {
          domesticPreDutyValue: 10,
          importPreDutyValue: 10,
          tariffPaid: 2,
          deliveredTariffPaid: 2,
        },
      },
      true
    );
    expect(result).toMatchObject({
      householdAbsorptionValue: 0,
      householdImportValue: 0,
      available: false,
      productionInputAbsorptionValue: 0,
      productionInputImportValue: 0,
      productionInputTariffPaid: 0,
    });
    expect(result.tariffRate).toBe(3);
  });
});

describe("measuredTariffInflationRate", () => {
  it("passes a measured rate through", () => {
    expect(measuredTariffInflationRate({ available: true, tariffRate: 4.2 })).toBe(4.2);
  });

  it("returns undefined for unavailable or shadow exposure so the legacy tariff path runs", () => {
    expect(
      measuredTariffInflationRate({ available: false, tariffRate: TARIFF_INFLATION_BASELINE })
    ).toBeUndefined();
  });
});
