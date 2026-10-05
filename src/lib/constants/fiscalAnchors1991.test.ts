/**
 * #3034: FR/IT/ES/SE/TR/GR/AT/FI open 1991 with sourced nominal GDP, budgets and
 * exchange rates authored together, so the dollar conversion is right.
 */
import { describe, expect, it } from "vitest";
import {
  FISCAL_ANCHORS_1991,
  FISCAL_ANCHOR_COUNTRIES_1991,
  gdp1991LegacyLcu,
} from "./fiscalAnchors1991";
import { INITIAL_RATES_1991 } from "./currencies";
import { getCountryConfig } from "./countries";
import { getNationalBudgetSeedConfigsForPreset } from "@/lib/seeds/reference/budgets";
import { frRegions1991 } from "@/lib/countries/fr/data/frRegions1991";
import { itRegions1991 } from "@/lib/countries/it/data/itRegions1991";
import { esRegions1991 } from "@/lib/countries/es/data/esRegions1991";
import { seRegions1991 } from "@/lib/countries/se/data/seRegions1991";
import { trRegions1991 } from "@/lib/countries/tr/data/trRegions1991";
import { grRegions1991 } from "@/lib/countries/gr/data/grRegions1991";
import { atRegions1991 } from "@/lib/countries/at/data/atRegions1991";
import { fiRegions1991 } from "@/lib/countries/fi/data/fiRegions1991";

const REGIONS = {
  FR: frRegions1991,
  IT: itRegions1991,
  ES: esRegions1991,
  SE: seRegions1991,
  TR: trRegions1991,
  GR: grRegions1991,
  AT: atRegions1991,
  FI: fiRegions1991,
} as const;

describe("1991 fiscal anchors", () => {
  const budgets = getNationalBudgetSeedConfigsForPreset("1991-default");

  it.each(FISCAL_ANCHOR_COUNTRIES_1991)(
    "%s: legacy GDP over the rate is the published US$ GDP",
    (c) => {
      const a = FISCAL_ANCHORS_1991[c];
      expect(gdp1991LegacyLcu(c) / a.lcuPerUsd / a.wdiGdpUsd).toBeGreaterThan(0.9995);
      expect(gdp1991LegacyLcu(c) / a.lcuPerUsd / a.wdiGdpUsd).toBeLessThan(1.0005);
    }
  );

  it.each(FISCAL_ANCHOR_COUNTRIES_1991)(
    "%s: forex table, era config, budget and regions agree",
    (c) => {
      const a = FISCAL_ANCHORS_1991[c];
      expect(INITIAL_RATES_1991[c]).toBe(a.lcuPerUsd);
      const cfg = getCountryConfig(c, "1991-default");
      expect(cfg.usdExchangeRate).toBeCloseTo(1 / a.lcuPerUsd, 12);
      const budget = budgets.find((b) => b.countryId === c)!;
      expect(budget.gdp).toBeCloseTo(gdp1991LegacyLcu(c), -2);
      expect(budget.currencyCode).toBe(a.currencyCode);
      const regionSum = REGIONS[c].reduce((s, r) => s + r.gdp, 0);
      expect(regionSum * 1_000_000).toBeCloseTo(budget.gdp, -6);
      // Converted with the era anchor, the seeded GDP is the real dollar economy.
      expect((budget.gdp * cfg.usdExchangeRate) / a.wdiGdpUsd).toBeCloseTo(1, 3);
    }
  );

  it.each(FISCAL_ANCHOR_COUNTRIES_1991)(
    "%s: debt follows the sourced IMF share where one exists",
    (c) => {
      const a = FISCAL_ANCHORS_1991[c];
      const b = budgets.find((x) => x.countryId === c)!;
      if (a.govGrossDebtPctGdp != null) {
        expect(b.debt.principal / b.gdp).toBeCloseTo(a.govGrossDebtPctGdp / 100, 6);
      }
      expect(b.debt.ceiling).toBeGreaterThan(b.debt.principal);
    }
  );

  it.each(["AT", "FI", "GR"] as const)(
    "%s: carried 1979 mix is rescaled so spending plus interest hits the sourced share",
    (c) => {
      const a = FISCAL_ANCHORS_1991[c];
      const b = budgets.find((x) => x.countryId === c)!;
      const lines =
        Object.values(b.baselineSpendingByCategory).reduce((s, v) => s + v, 0) +
        b.baselineStateGrants;
      const total = lines + b.debt.principal * b.debt.interestRate;
      expect(total / b.gdp).toBeCloseTo(a.govExpenditurePctGdp! / 100, 6);
      expect(b.fiscalYear).toBe(1991);
      expect(b.sourceFiscalYear).toBe(1979);
      expect(b.economicFactors.inflationRate).toBeCloseTo(a.cpiInflationPct, 1);
    }
  );

  it("keeps regional shares when scaling to the national total", () => {
    const shares = frRegions1991.map((r) => r.gdp / frRegions1991.reduce((s, x) => s + x.gdp, 0));
    const base = [700, 230, 250, 360, 270, 320, 250, 200];
    base.forEach((v, i) => expect(shares[i]).toBeCloseTo(v / 2580, 6));
  });
});
