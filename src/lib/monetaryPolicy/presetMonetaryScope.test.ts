import { describe, expect, it } from "vitest";
import type { CountryId } from "@/lib/constants/countries";
import { FOREX_ACTIVE_COUNTRIES } from "@/lib/constants/currencies";
import { getNationalBudgetSeedConfigsForPreset } from "@/lib/seeds/reference/budgets";
import { SHIPPING_PRESETS } from "@/lib/world/eraRoster";
import { getPresetMonetaryScope } from "./presetMonetaryScope";

describe("getPresetMonetaryScope", () => {
  it.each(SHIPPING_PRESETS)("keeps central-bank coverage inside %s fiscal coverage", (preset) => {
    const scope = getPresetMonetaryScope(preset);
    const budgeted = new Set<CountryId>(
      getNationalBudgetSeedConfigsForPreset(preset).map(({ countryId }) => countryId)
    );

    const expectedForex =
      preset === "2027-default" ? [...FOREX_ACTIVE_COUNTRIES, "BG"] : FOREX_ACTIVE_COUNTRIES;
    expect(scope.forexCountries).toEqual(expectedForex);
    expect(scope.centralBankCountries.every((countryId) => budgeted.has(countryId))).toBe(true);
    expect(
      new Set([
        ...scope.centralBankCountries,
        ...scope.exclusions.map(({ countryId }) => countryId),
      ])
    ).toEqual(new Set(expectedForex));
  });

  it("uses one shared EUR bank for 2027 Bulgaria", () => {
    const scope = getPresetMonetaryScope("2027-default");
    expect(scope.forexCountries).toContain("BG");
    expect(scope.centralBankCountries).toContain("DE");
    expect(scope.centralBankCountries).not.toContain("BG");
    expect(scope.exclusions).toContainEqual(
      expect.objectContaining({ countryId: "BG", reason: "shared-currency-bank" })
    );
    expect(getPresetMonetaryScope("1991-default").forexCountries).not.toContain("BG");
  });

  it.each(["1953-default", "1979-default"])("models RU and DD fiscally in %s", (preset) => {
    const scope = getPresetMonetaryScope(preset);
    expect(scope.centralBankCountries).toEqual(expect.arrayContaining(["RU", "DD"]));
    expect(scope.exclusions.map(({ countryId }) => countryId)).not.toEqual(
      expect.arrayContaining(["RU", "DD"])
    );
  });

  it.each([
    "1991-default",
    "1999-default",
    "2007-default",
    "2019-default",
    "2023-default",
    "2027-default",
  ])("records explicit RU/DD exclusions in %s", (preset) => {
    const scope = getPresetMonetaryScope(preset);
    expect(scope.centralBankCountries).not.toEqual(expect.arrayContaining(["RU", "DD"]));
    expect(scope.exclusions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ countryId: "RU", reason: "fiscal-model-unauthored" }),
        expect.objectContaining({ countryId: "DD", reason: "absent-in-era" }),
      ])
    );
  });
});
