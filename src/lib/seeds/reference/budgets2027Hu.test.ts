import { describe, expect, it } from "vitest";
import { getInitialRates, eraRateForCurrency } from "@/lib/constants/currencies";
import { huRegions2027 } from "@/lib/countries/hu/data/huRegions2027";
import { PARTY_ROSTERS_2027 } from "@/lib/seeds/partyRosters2027";
import {
  getInitialNationalBudgetsForPreset,
  getNationalBudgetSeedConfigsForPreset,
} from "./budgets";

describe("HU 2027 explicit source fallback", () => {
  it("reconciles region totals to the national population and revised GDP", () => {
    const budget = getNationalBudgetSeedConfigsForPreset("2027-default").find(
      (row) => row.countryId === "HU"
    );
    expect(budget).toBeDefined();
    expect(budget!.sourceFiscalYear).toBe(2025);
    expect(budget!.fiscalYear).toBe(2027);
    expect(budget!.currencyCode).toBe("HUF");
    expect(budget!.population).toBe(9_488_000);
    expect(budget!.gdp).toBe(87_045_554_000_000);
    expect(huRegions2027.reduce((sum, row) => sum + row.population, 0)).toBe(budget!.population);
    expect(huRegions2027.reduce((sum, row) => sum + row.gdp, 0) * 1_000_000).toBe(budget!.gdp);
    expect(huRegions2027.reduce((sum, row) => sum + row.houseDistricts, 0)).toBe(199);
    expect(huRegions2027.every((row) => row.stateSenateSeats === 0)).toBe(true);
    const operating =
      Object.values(budget!.baselineSpendingByCategory).reduce((sum, amount) => sum + amount, 0) +
      budget!.baselineStateGrants;
    expect(operating + budget!.debt.principal * budget!.debt.interestRate).toBe(41_141_000_000_000);
    const seeded = getInitialNationalBudgetsForPreset("2027-default").find(
      (row) => row.countryId === "HU"
    );
    expect(seeded).toBeDefined();
    expect(Math.abs(seeded!.revenue.total - 37_082_000_000_000)).toBeLessThan(1_000_000);
    expect(Math.abs(seeded!.spending.total - 41_141_000_000_000)).toBeLessThan(1_000_000);
  });

  it("uses the 2026 parliamentary parties, without obsolete seeded competitors", () => {
    expect(PARTY_ROSTERS_2027.HU?.map((row) => row.abbreviation)).toEqual([
      "TISZA",
      "FIDESZ-KDNP",
      "MI HAZÁNK",
    ]);
  });

  it("uses the 2025 forint average only for 2027", () => {
    expect(getInitialRates("2027-default").HU).toBe(353.2);
    expect(eraRateForCurrency("HUF", "2027-default")).toBe(353.2);
    expect(getInitialRates("1991-default").HU).toBe(74.7353833333333);
    expect(getInitialRates("1953-default").HU).toBe(20);
  });
});
