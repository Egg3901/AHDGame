import { describe, expect, it } from "vitest";
import {
  getInitialNationalBudgetsForPreset,
  getNationalBudgetSeedConfigsForPreset,
  NATIONAL_BUDGET_SEED_CONFIGS_1953,
} from "./budgets";

/**
 * 1953 Eastern-bloc revenue/GDP band.
 *
 * Band justification (mechanism, not a tuned landing number):
 * - Command-economy *fiscal* budgets of the early 1950s ran roughly 45–70% of
 *   national income (turnover tax + enterprise-profit remittances the bulk;
 *   Holzman / CIA NMP-to-budget series). Market economies of the same era ran
 *   roughly 20–45% (OECD / Mitchell historical fiscal shares; SE's mid-century
 *   welfare state sits at the high end).
 * - RU/DD were already re-authored under ruling #15 to the fiscal scale
 *   (~36–38%); they sit just under the command lower bound because their
 *   catalog rates are milder than the Stalinist satellite ladder. They are
 *   asserted separately against their historical anchors, not this band.
 * - The failure mode this guards: footprint-scale tax bases (corp ≈0.60,
 *   taxableSales > 1.0) × easternBlocPolicyConfig1953 rates (70% remittance,
 *   26% turnover) produced 96–107% GDP revenue for PL/HU/CS/RO/BG.
 */
const COMMAND_FISCAL_COUNTRIES = ["PL", "HU", "CS", "RO", "BG", "YU"] as const;
const MARKET_COUNTRIES = [
  "US",
  "UK",
  "DE",
  "JP",
  "FR",
  "IT",
  "ES",
  "SE",
  "TR",
  "BR",
  "CN",
  "NG",
  "IE",
] as const;

const COMMAND_REVENUE_GDP_MIN = 0.45;
const COMMAND_REVENUE_GDP_MAX = 0.7;
const MARKET_REVENUE_GDP_MIN = 0.08;
const MARKET_REVENUE_GDP_MAX = 0.65;

/**
 * 1979 Soviet-type *fiscal* budgets of the Brezhnev decade sat roughly 45–65%
 * of national income (CIA NMP-to-budget; RU seed anchors ~57%). Softer than
 * Stalinist 1953 remittance rates (enterprise 55% / product 16% vs 70%/26%),
 * with consumer-goods programmes and hard-currency debt. Prior footprint bases
 * (corp 0.62–0.68, taxableSales 1.1–1.3) produced 83–98% GDP revenue.
 */
const COMMAND_1979_COUNTRIES = ["PL", "CS", "RO", "BG", "YU", "HU", "DD"] as const;
const COMMAND_1979_REVENUE_GDP_MIN = 0.45;
const COMMAND_1979_REVENUE_GDP_MAX = 0.65;

const budgets1953 = getInitialNationalBudgetsForPreset("1953-default");
const byCountry = (cc: string) => budgets1953.find((b) => b.countryId === cc)!;

describe("1953 Eastern-bloc fiscal revenue/GDP (footprint-base regression)", () => {
  it("satellite command budgets land inside the 45–70% fiscal band", () => {
    for (const cc of COMMAND_FISCAL_COUNTRIES) {
      const b = byCountry(cc);
      const ratio = b.revenue.total / b.gdp;
      expect(ratio, `${cc} rev/GDP=${(ratio * 100).toFixed(1)}%`).toBeGreaterThanOrEqual(
        COMMAND_REVENUE_GDP_MIN
      );
      expect(ratio, `${cc} rev/GDP=${(ratio * 100).toFixed(1)}%`).toBeLessThanOrEqual(
        COMMAND_REVENUE_GDP_MAX
      );
    }
  });

  it("no single revenue line can alone exceed ~30% of GDP under Stalinist rates", () => {
    // Guards the specific double-count / wrong-base failure: corp remittance
    // at 42% GDP or turnover tax at 27%+GDP when taxableSales > 1.0.
    for (const cc of COMMAND_FISCAL_COUNTRIES) {
      const b = byCountry(cc);
      const corpShare = (b.revenue.domesticCorporateTax + b.revenue.foreignCorporateTax) / b.gdp;
      const salesShare = b.revenue.salesTax / b.gdp;
      expect(corpShare, `${cc} corp/GDP`).toBeLessThan(0.3);
      expect(salesShare, `${cc} sales/GDP`).toBeLessThan(0.3);
    }
  });

  it("makeEasternBlocBudget1953 no longer authors footprint-scale bases", () => {
    const configs = getNationalBudgetSeedConfigsForPreset("1953-default");
    for (const cc of COMMAND_FISCAL_COUNTRIES) {
      const cfg = configs.find((c) => c.countryId === cc)!;
      // Prior bug: corporateProfits 0.60–0.62 and taxableSales 1.05–1.15.
      expect(cfg.taxBaseRatios.corporateProfits, cc).toBeLessThanOrEqual(0.25);
      expect(cfg.taxBaseRatios.taxableSales, cc).toBeLessThan(1.0);
      expect(cfg.otherRevenue / cfg.gdp, cc).toBeLessThanOrEqual(0.15);
    }
  });

  it("HU is routed through the shared 1953 factory (no divergent footprint block)", () => {
    const hu = NATIONAL_BUDGET_SEED_CONFIGS_1953.find((c) => c.countryId === "HU")!;
    const pl = NATIONAL_BUDGET_SEED_CONFIGS_1953.find((c) => c.countryId === "PL")!;
    expect(hu.taxBaseRatios).toEqual(pl.taxBaseRatios);
    expect(hu.otherRevenue / hu.gdp).toBeCloseTo(pl.otherRevenue / pl.gdp, 5);
  });

  it("market-economy 1953 seeds stay well below command levels (pathology is bloc-only)", () => {
    for (const cc of MARKET_COUNTRIES) {
      const b = byCountry(cc);
      const ratio = b.revenue.total / b.gdp;
      expect(ratio, `${cc} rev/GDP=${(ratio * 100).toFixed(1)}%`).toBeGreaterThanOrEqual(
        MARKET_REVENUE_GDP_MIN
      );
      expect(ratio, `${cc} rev/GDP=${(ratio * 100).toFixed(1)}%`).toBeLessThanOrEqual(
        MARKET_REVENUE_GDP_MAX
      );
    }
  });

  it("pins 1979-default Eastern-bloc fiscal bases (conscious update from footprint era)", () => {
    // Previously pinned corp 0.62 / taxableSales 1.1 so a shared-helper edit
    // could not silently "fix" 1979. That pin is now updated deliberately:
    // makeEasternBlocBudget (and HU/DD hand blocks) use fiscal-scale bases.
    // Keep an exact pin so drift fails the suite.
    const configs1979 = getNationalBudgetSeedConfigsForPreset("1979-default");
    const pl1979 = configs1979.find((c) => c.countryId === "PL")!;
    expect(pl1979.taxBaseRatios.corporateProfits).toBe(0.32);
    expect(pl1979.taxBaseRatios.taxableSales).toBe(0.75);
    expect(pl1979.otherRevenue / pl1979.gdp).toBeCloseTo(0.12, 5);
  });
});

describe("1979 Eastern-bloc fiscal revenue/GDP (footprint-base regression)", () => {
  const budgets1979 = getInitialNationalBudgetsForPreset("1979-default");
  const byCountry1979 = (cc: string) => budgets1979.find((b) => b.countryId === cc)!;

  it("satellite + DD command budgets land inside the 45–65% Brezhnev-era fiscal band", () => {
    for (const cc of COMMAND_1979_COUNTRIES) {
      const b = byCountry1979(cc);
      const ratio = b.revenue.total / b.gdp;
      expect(ratio, `${cc} rev/GDP=${(ratio * 100).toFixed(1)}%`).toBeGreaterThanOrEqual(
        COMMAND_1979_REVENUE_GDP_MIN
      );
      expect(ratio, `${cc} rev/GDP=${(ratio * 100).toFixed(1)}%`).toBeLessThanOrEqual(
        COMMAND_1979_REVENUE_GDP_MAX
      );
    }
  });

  it("makeEasternBlocBudget no longer authors footprint-scale bases", () => {
    const configs = getNationalBudgetSeedConfigsForPreset("1979-default");
    for (const cc of COMMAND_1979_COUNTRIES) {
      const cfg = configs.find((c) => c.countryId === cc)!;
      // Prior bug: corporateProfits 0.62–0.68 and taxableSales 1.1–1.3.
      expect(cfg.taxBaseRatios.corporateProfits, cc).toBeLessThanOrEqual(0.4);
      expect(cfg.taxBaseRatios.taxableSales, cc).toBeLessThan(1.0);
      expect(cfg.otherRevenue / cfg.gdp, cc).toBeLessThanOrEqual(0.15);
    }
  });

  it("does not alter 1953-default Eastern-bloc revenue ratios (era gate)", () => {
    for (const cc of COMMAND_FISCAL_COUNTRIES) {
      const b = byCountry(cc);
      const ratio = b.revenue.total / b.gdp;
      expect(ratio, `${cc} 1953 rev/GDP`).toBeGreaterThanOrEqual(COMMAND_REVENUE_GDP_MIN);
      expect(ratio, `${cc} 1953 rev/GDP`).toBeLessThanOrEqual(COMMAND_REVENUE_GDP_MAX);
    }
    // Exact pin on 1953 PL bases — makeEasternBlocBudget1953 must stay untouched.
    const configs1953 = getNationalBudgetSeedConfigsForPreset("1953-default");
    const pl1953 = configs1953.find((c) => c.countryId === "PL")!;
    expect(pl1953.taxBaseRatios.corporateProfits).toBe(0.18);
    expect(pl1953.taxBaseRatios.taxableSales).toBe(0.6);
  });

  it("market-economy 1979 seeds stay well below the old footprint pathology", () => {
    for (const cc of ["US", "FR", "DE", "SE"] as const) {
      const b = byCountry1979(cc);
      const ratio = b.revenue.total / b.gdp;
      expect(ratio, `${cc} rev/GDP=${(ratio * 100).toFixed(1)}%`).toBeLessThan(0.75);
    }
  });
});
