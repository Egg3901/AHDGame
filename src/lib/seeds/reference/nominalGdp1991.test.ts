import { describe, expect, it } from "vitest";
import { calculateEnactedLawAnnualCost } from "@/lib/budget/costs";
import { getInitialRates } from "@/lib/constants/currencies";
import { FISCAL_ANCHORS_1991 } from "@/lib/constants/fiscalAnchors1991";
import { IE_GEOGRAPHY } from "@/lib/countries/ie/geography";
import { FR_GEOGRAPHY } from "@/lib/countries/fr/geography";
import { IT_GEOGRAPHY } from "@/lib/countries/it/geography";
import { ES_GEOGRAPHY } from "@/lib/countries/es/geography";
import { SE_GEOGRAPHY } from "@/lib/countries/se/geography";
import { TR_GEOGRAPHY } from "@/lib/countries/tr/geography";
import { GR_GEOGRAPHY } from "@/lib/countries/gr/geography";
import { AT_GEOGRAPHY } from "@/lib/countries/at/geography";
import { FI_GEOGRAPHY } from "@/lib/countries/fi/geography";
import {
  computeStateGdpScalars,
  shouldReconcileStateGdpForPreset,
  STATE_GDP_RECONCILE_TOLERANCE,
} from "@/lib/admin/seed/reconcileStateGdp";
import { selectPresetBundle } from "../presetSelector";
import {
  generateDefaultEnactedLaws,
  getInitialNationalBudgetsForPreset,
  getNationalBudgetSeedConfigsForPreset,
} from "./budgets";
import { IRISH_GROSS_GOVERNMENT_DEBT_1991_IEP, NATIVE_NOMINAL_GDP_1991 } from "./nominalGdp1991";

// Independent WDI NY.GDP.MKTP.CD annual-1991 observations. Annual FX applies
// to these nine entries; successor opening fixings are deliberately excluded.
const fixtures = [
  ["IE", IE_GEOGRAPHY, 49_787_501_584.4847, 24_000_000_000, 32_000_000_000],
  ["FR", FR_GEOGRAPHY, 1_258_961_748_633.88, 5_330_000_000_000, 1_920_000_000_000],
  ["IT", IT_GEOGRAPHY, 1_249_092_439_519.28, 1_030_000_000_000_000, 1_010_000_000_000_000],
  ["ES", ES_GEOGRAPHY, 576_753_902_321.857, 38_900_000_000_000, 17_100_000_000_000],
  ["SE", SE_GEOGRAPHY, 273_831_464_572.137, 1_160_000_000_000, 500_000_000_000],
  ["TR", TR_GEOGRAPHY, 151_034_731_543.624, 6_900_000_000_000, 2_000_000_000_000],
  ["GR", GR_GEOGRAPHY, 103_680_863_712.844, 1_500_000_000_000, 330_000_000_000],
  ["AT", AT_GEOGRAPHY, 173_113_449_616.971, 920_000_000_000, 275_000_000_000],
  ["FI", FI_GEOGRAPHY, 127_794_441_993.824, 160_000_000_000, 19_000_000_000],
] as const;

describe("1991 native GDP and fiscal continuity", () => {
  const configs = getNationalBudgetSeedConfigsForPreset("1991-default");
  const budgets = getInitialNationalBudgetsForPreset("1991-default");
  const rates = getInitialRates("1991-default");

  it.each(fixtures)(
    "%s maintains fiscal spending after rebuilding from its actual laws",
    (countryId) => {
      const config = configs.find((row) => row.countryId === countryId)!;
      const budget = budgets.find((row) => row.countryId === countryId)!;
      const laws = generateDefaultEnactedLaws("1991-default").filter(
        (law) => law.countryId === countryId && law.rate === undefined
      );
      const charges = laws.map((law) =>
        calculateEnactedLawAnnualCost(law, {
          gdp: config.gdp,
          population: config.population,
          countryId,
          budgetCapacity: budget.revenue.total,
          year: 1991,
          nationalGdpPerCapita: config.gdp / config.population,
          nationalMedianIncome: 1,
        })
      );
      // Spain's neutral-only catalog follows the runtime's baseline fallback.
      const operating = charges.some((amount) => amount > 0)
        ? charges.reduce((sum, amount) => sum + amount, 0)
        : Object.values(config.baselineSpendingByCategory).reduce(
            (sum, amount) => sum + amount,
            0
          ) + config.baselineStateGrants;
      // Seed snapshots round individual categories to whole currency units.
      expect(
        Math.abs(operating + budget.spending.debtInterest - budget.spending.total)
      ).toBeLessThan(5);
    }
  );

  it.each(fixtures)(
    "%s restores native money and preserves the authoritative debt basis",
    (countryId, _geography, usdGdp, oldGdp, oldPrincipal) => {
      const config = configs.find((row) => row.countryId === countryId)!;
      const budget = budgets.find((row) => row.countryId === countryId)!;
      expect(config.gdp).toBe(NATIVE_NOMINAL_GDP_1991[countryId]);
      expect(Math.abs(config.gdp / rates[countryId]! / usdGdp - 1)).toBeLessThan(0.01);
      const observedDebtShare =
        countryId === "IE" ? null : FISCAL_ANCHORS_1991[countryId].govGrossDebtPctGdp;
      const debtShare =
        countryId === "IE"
          ? IRISH_GROSS_GOVERNMENT_DEBT_1991_IEP / config.gdp
          : observedDebtShare == null
            ? oldPrincipal / oldGdp
            : observedDebtShare / 100;
      expect(config.debt.principal / config.gdp).toBeCloseTo(debtShare, 12);
      expect(budget.debt.principal).toBe(config.debt.principal);
      expect(budget.treasuryBalance).toBe(-config.debt.principal);
      expect(budget.debtToGdpRatio).toBeCloseTo(debtShare, 12);
      expect(budget.spending.debtInterest).toBe(
        Math.round(config.debt.principal * config.debt.interestRate)
      );
      if (countryId === "IE") {
        expect(config.debt.principal).toBe(36_004_000_000 * 0.787564);
        expect(config.debt.ceiling / config.debt.principal).toBeCloseTo(38 / 32, 12);
      }
      if (["GR", "AT", "FI"].includes(countryId)) expect(config.sourceFiscalYear).toBe(1979);
    }
  );

  it.each(fixtures)(
    "%s regional GDP reaches the same native fiscal anchor before dependent seeds",
    (countryId, geography) => {
      expect(shouldReconcileStateGdpForPreset("1991-default")).toBe(true);
      const rows = selectPresetBundle("1991-default", geography.regionBundles, "GDP audit");
      const national = new Map([[countryId, NATIVE_NOMINAL_GDP_1991[countryId]]]);
      const [entry] = computeStateGdpScalars(rows, national);
      expect(entry).toBeDefined();
      const reconciled = rows.map((row) => ({ ...row, gdp: row.gdp * entry.scalar }));
      const [again] = computeStateGdpScalars(reconciled, national);
      expect(again.deviation).toBeLessThan(STATE_GDP_RECONCILE_TOLERANCE);
      expect(again.applied).toBe(false);
      expect(again.scalar).toBe(1);
    }
  );

  it("preserves GR/AT/FI inherited composition and headroom with sourced1991 fiscal totals", () => {
    const originals = getNationalBudgetSeedConfigsForPreset("1979-default");
    for (const countryId of ["GR", "AT", "FI"] as const) {
      const original = originals.find((row) => row.countryId === countryId)!;
      const next = configs.find((row) => row.countryId === countryId)!;
      const totalBefore =
        Object.values(original.baselineSpendingByCategory).reduce(
          (sum, amount) => sum + amount,
          0
        ) + original.baselineStateGrants;
      const totalAfter =
        Object.values(next.baselineSpendingByCategory).reduce((sum, amount) => sum + amount, 0) +
        next.baselineStateGrants;
      expect(next.gdp).not.toBe(original.gdp);
      expect(next.otherRevenue / next.gdp).toBeCloseTo(original.otherRevenue / original.gdp, 12);
      expect(next.debt.ceiling / next.debt.principal).toBeCloseTo(
        original.debt.ceiling / original.debt.principal,
        12
      );
      expect(next.baselineStateGrants / totalAfter).toBeCloseTo(
        original.baselineStateGrants / totalBefore,
        12
      );
      for (const [category, amount] of Object.entries(original.baselineSpendingByCategory)) {
        expect(next.baselineSpendingByCategory[category] / totalAfter).toBeCloseTo(
          amount / totalBefore,
          12
        );
      }
      expect((totalAfter + next.debt.principal * next.debt.interestRate) / next.gdp).toBeCloseTo(
        FISCAL_ANCHORS_1991[countryId].govExpenditurePctGdp! / 100,
        12
      );
    }
  });
});
