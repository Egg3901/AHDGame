import { describe, expect, it } from "vitest";
import {
  getInitialRates,
  getSeedCurrencyCode,
  eraRateForCurrency,
} from "@/lib/constants/currencies";
import {
  getInitialNationalBudgetsForPreset,
  getNationalBudgetSeedConfigsForPreset,
} from "./budgets";
import { MODERN_2019_NATIONALS } from "./modernRegions2019";

const MONEY = { RU: "RUB", PL: "PLN", HU: "HUF", RO: "RON", BG: "BGN" } as const;
const FISCAL = {
  RU: { revenue: 34.7, expenditure: 33.3, debt: 15.8 },
  PL: { revenue: 41.0, expenditure: 41.8, debt: 1_045_865_000_000 },
  HU: { revenue: 43.6, expenditure: 45.7, debt: 31_130_527_000_000 },
  RO: { revenue: 31.9, expenditure: 36.3, debt: 373_497_000_000 },
  BG: { revenue: 37.6, expenditure: 35.5, debt: 24_085_000_000 },
} as const;

describe("2019 five-country fiscal substrate", () => {
  it("uses modern national currencies and observed 2019 USD exchange rates", () => {
    const rates = getInitialRates("2019-default");
    for (const [countryId, currency] of Object.entries(MONEY)) {
      expect(getSeedCurrencyCode(countryId as keyof typeof MONEY, "2019-default")).toBe(currency);
      expect(eraRateForCurrency(currency, "2019-default")).toBe(
        rates[countryId as keyof typeof MONEY]
      );
      expect(rates[countryId as keyof typeof MONEY]).toBeGreaterThan(0);
    }
    expect(rates.RU).toBeCloseTo(64.7376583333333);
    expect(rates.PL).toBeCloseTo(3.839375);
    expect(rates.HU).toBeCloseTo(290.66);
    expect(rates.RO).toBeCloseTo(4.237925);
    expect(rates.BG).toBeCloseTo(1.74704166666667);
    expect(getSeedCurrencyCode("RU", "1953-default")).toBe("SUR");
    expect(getSeedCurrencyCode("PL", "1991-default")).toBe("PLZ");
    expect(getSeedCurrencyCode("RO", "1991-default")).toBe("ROL");
    expect(getSeedCurrencyCode("BG", "1991-default")).toBe("BGL");
  });

  it("creates era-authored budgets with fiscal totals on their national money scale", () => {
    const configs = new Map(
      getNationalBudgetSeedConfigsForPreset("2019-default").map((row) => [row.countryId, row])
    );
    const seeded = new Map(
      getInitialNationalBudgetsForPreset("2019-default").map((row) => [row.countryId, row])
    );
    for (const countryId of Object.keys(MONEY) as Array<keyof typeof MONEY>) {
      const config = configs.get(countryId)!;
      const budget = seeded.get(countryId)!;
      const fiscal = FISCAL[countryId];
      expect(config.fiscalYear).toBe(2019);
      expect(config.gdp).toBe(MODERN_2019_NATIONALS[countryId].gdp);
      expect(config.population).toBe(MODERN_2019_NATIONALS[countryId].population);
      expect(config.currencyCode).toBe(MONEY[countryId]);
      expect(budget.currencyCode).toBe(MONEY[countryId]);
      expect(budget.taxRates.incomeTax).toBeGreaterThan(0);
      // Eurostat debt is an absolute national-currency stock. Its published
      // debt/GDP ratio uses Eurostat's GDP vintage, whereas these game regions
      // use WDI GDP; preserve the observed stock instead of forcing a ratio.
      if (countryId === "RU") {
        expect((config.debt.principal / config.gdp) * 100).toBeCloseTo(15.8, 1);
      } else {
        expect(config.debt.principal).toBe(fiscal.debt);
      }
      const operating =
        Object.values(config.baselineSpendingByCategory).reduce((sum, value) => sum + value, 0) +
        config.baselineStateGrants;
      expect(
        ((operating + config.debt.principal * config.debt.interestRate) / config.gdp) * 100
      ).toBeCloseTo(fiscal.expenditure, 1);
      expect((config.otherRevenue / config.gdp + 0.3175) * 100).toBeCloseTo(fiscal.revenue, 1);
    }
  });

  it("does not carry 2019-only fiscal rows into 2023 or 1953", () => {
    for (const preset of ["1953-default", "2023-default"]) {
      const configs = getNationalBudgetSeedConfigsForPreset(preset);
      for (const countryId of Object.keys(MONEY)) {
        expect(configs.find((row) => row.countryId === countryId)?.sourceFiscalYear).not.toBe(2019);
      }
    }
  });
});
