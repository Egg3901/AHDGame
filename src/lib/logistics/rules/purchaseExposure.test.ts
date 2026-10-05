/** Verify that modeled purchase cohorts conserve accepted values and delivery duties. */
import { describe, expect, it } from "vitest";
import {
  addPurchaseExposure,
  emptyPurchaseExposure,
  purchaseUseShares,
  summarizePurchaseExposureByCountry,
} from "./purchaseExposure";

describe("modeled purchase exposure", () => {
  it("scales known demand cohorts together when final demand was capped", () => {
    expect(purchaseUseShares(50, { householdFinal: 60, productionInput: 40 })).toEqual({
      householdFinal: 0.6,
      productionInput: 0.4,
      other: 0,
    });
    const shares = purchaseUseShares(100, { householdFinal: 30, productionInput: 20 });
    expect(shares.householdFinal).toBeCloseTo(0.3);
    expect(shares.productionInput).toBeCloseTo(0.2);
    expect(shares.other).toBeCloseTo(0.5);
  });

  it("conserves fractional local and imported purchases without dropping route losses", () => {
    const target = emptyPurchaseExposure();
    const shares = purchaseUseShares(100, { householdFinal: 30, productionInput: 20 });
    addPurchaseExposure(target, shares, {
      units: 0.25,
      preDutyValue: 25,
      tariffPaid: 0,
      deliveredTariffPaid: 0,
      imported: false,
    });
    addPurchaseExposure(target, shares, {
      units: 0.5,
      preDutyValue: 50,
      tariffPaid: 12.5,
      deliveredTariffPaid: 10,
      imported: true,
    });
    for (const [key, expected] of Object.entries({
      domesticUnits: 0.25,
      domesticPreDutyValue: 25,
      importUnits: 0.5,
      importPreDutyValue: 50,
      tariffPaid: 12.5,
      deliveredTariffPaid: 10,
    })) {
      expect(
        Object.values(target).reduce((total, row) => total + row[key as keyof typeof row], 0)
      ).toBeCloseTo(expected, 10);
    }
    const summary = summarizePurchaseExposureByCountry(
      [
        { stateId: "A", countryId: "US" },
        { stateId: "B", countryId: "US" },
      ],
      new Map([
        ["A", new Map([["coal", target]])],
        ["B", new Map([["coal", target]])],
      ])
    );
    expect(summary.get("US")?.get("coal")?.householdFinal.importPreDutyValue).toBeCloseTo(30);
    expect(summary.get("US")?.get("coal")?.householdFinal.deliveredTariffPaid).toBeCloseTo(6);
  });
});
