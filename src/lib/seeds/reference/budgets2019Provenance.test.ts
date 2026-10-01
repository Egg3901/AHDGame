import { describe, expect, it } from "vitest";
import {
  getInitialNationalBudgetsForPreset,
  getNationalBudgetSeedConfigsForPreset,
  getNationalBudgetSeedProvenance,
  reportCrossEraBudgetInheritance,
} from "./budgets";

/**
 * Issue #2076: the 2019 preset used to carry 1979/1991 fiscal inputs forward
 * with only fiscalYear rewritten, seeding turn-one inflation of 5.9% (ES),
 * 6.3% (IT), 3.2% (FR), 9.3% (SE), 66% (TR), 19% (GR), 3.7% (AT), 7.5% (FI).
 * Every named country now carries an explicit 2019 calibration, and any
 * remaining cross-era inheritance is observable via the provenance report.
 */

const NAMED_2019 = ["ES", "IT", "FR", "SE", "TR", "GR", "AT", "FI"] as const;

// 2019 macro anchors (Eurostat/IMF/World Bank 2019 actuals, rounded).
const EXPECTED_INFLATION: Record<string, number> = {
  ES: 0.7,
  IT: 0.6,
  FR: 1.1,
  SE: 1.7,
  TR: 15.2,
  GR: 0.5,
  AT: 1.5,
  FI: 1.1,
};

const EXPECTED_WAGE_GROWTH: Record<string, number> = {
  ES: 2.0,
  IT: 1.0,
  FR: 1.7,
  SE: 2.6,
  TR: 18.0,
  GR: 1.5,
  AT: 2.2,
  FI: 2.1,
};

const EXPECTED_GDP_GROWTH: Record<string, number> = {
  ES: 2.0,
  IT: 0.5,
  FR: 1.8,
  SE: 2.0,
  TR: 0.9,
  GR: 1.9,
  AT: 1.6,
  FI: 1.4,
};

// 2019 general-government gross debt ratios, as fractions of GDP.
const EXPECTED_DEBT_RATIO: Record<string, { low: number; high: number }> = {
  ES: { low: 0.9, high: 1.0 },
  IT: { low: 1.29, high: 1.39 },
  FR: { low: 0.93, high: 1.03 },
  SE: { low: 0.3, high: 0.4 },
  TR: { low: 0.28, high: 0.38 },
  GR: { low: 1.75, high: 1.87 },
  AT: { low: 0.66, high: 0.76 },
  FI: { low: 0.54, high: 0.64 },
};

describe("2019 preset carries no cross-era budget inheritance (#2076)", () => {
  it("reports zero inherited rows for 2019-default", () => {
    expect(reportCrossEraBudgetInheritance("2019-default")).toEqual([]);
  });

  it("gives every named country an explicit 2019 calibration", () => {
    const provenance = new Map(
      getNationalBudgetSeedProvenance("2019-default").map((row) => [row.countryId, row])
    );
    for (const countryId of NAMED_2019) {
      const row = provenance.get(countryId);
      expect(row, `${countryId} missing from 2019 roster`).toBeDefined();
      expect(row!.inherited).toBe(false);
      expect(row!.fiscalYear).toBe(2019);
      expect(row!.sourceFiscalYear).toBe(2019);
    }
  });

  it("prints the cross-era inheritance report for every preset", () => {
    const lines: string[] = [];
    for (const preset of [
      "1953-default",
      "1979-default",
      "1991-default",
      "1999-default",
      "2007-default",
      "2019-default",
      "2023-default",
      "2027-default",
    ]) {
      const rows = reportCrossEraBudgetInheritance(preset);
      lines.push(
        `${preset}: ` +
          (rows.length === 0
            ? "all explicit"
            : rows.map((r) => `${r.countryId}(${r.sourceFiscalYear}->${r.fiscalYear})`).join(", "))
      );
    }
    console.log("\nCross-era budget inheritance:\n  " + lines.join("\n  "));
    expect(lines.length).toBe(8);
  });
});

describe("2019 named-country macro anchors (#2076)", () => {
  const configs = getNationalBudgetSeedConfigsForPreset("2019-default");
  const byCountry = new Map(configs.map((config) => [config.countryId, config]));

  it.each([...NAMED_2019])("%s seeds era-appropriate inflation, wage and growth", (countryId) => {
    const config = byCountry.get(countryId);
    expect(config, `${countryId} config`).toBeDefined();
    expect(config!.economicFactors.inflationRate).toBe(EXPECTED_INFLATION[countryId]);
    expect(config!.economicFactors.wageGrowth).toBe(EXPECTED_WAGE_GROWTH[countryId]);
    expect(config!.economicFactors.gdpGrowth).toBe(EXPECTED_GDP_GROWTH[countryId]);
  });

  it.each([...NAMED_2019])("%s carries a 2019-scale debt load", (countryId) => {
    const config = byCountry.get(countryId)!;
    const ratio = config.debt.principal / config.gdp;
    const band = EXPECTED_DEBT_RATIO[countryId]!;
    expect(ratio).toBeGreaterThanOrEqual(band.low);
    expect(ratio).toBeLessThanOrEqual(band.high);
    expect(config.debt.ceiling).toBeGreaterThan(config.debt.principal);
    expect(config.debt.ceilingLastRaisedYear).toBe(2019);
  });

  it.each([...NAMED_2019])("%s has non-zero tax bases and plausible spend", (countryId) => {
    const config = byCountry.get(countryId)!;
    expect(config.taxBaseRatios.taxableIncome).toBeGreaterThan(0);
    expect(config.taxBaseRatios.wagesAndSalaries).toBeGreaterThan(0);
    expect(config.taxBaseRatios.taxableSales).toBeGreaterThan(0);
    const spendTotal =
      Object.values(config.baselineSpendingByCategory).reduce((sum, v) => sum + v, 0) +
      config.baselineStateGrants;
    const share = spendTotal / config.gdp;
    expect(share).toBeGreaterThan(0.15);
    expect(share).toBeLessThan(0.65);
  });

  it("builds seeded 2019 budgets with live tax rates for every named country", () => {
    const budgets = getInitialNationalBudgetsForPreset("2019-default");
    for (const countryId of NAMED_2019) {
      const budget = budgets.find((b) => b.countryId === countryId);
      expect(budget, `${countryId} budget`).toBeDefined();
      expect(
        budget!.taxRates.incomeTax +
          budget!.taxRates.domesticCorporateTax +
          budget!.taxRates.payrollTax +
          budget!.taxRates.salesTax
      ).toBeGreaterThan(0);
      expect(budget!.treasuryBalance).toBe(-budget!.debt.principal);
    }
  });
});

describe("older presets keep their documented fallback provenance (#2076)", () => {
  it("1991 still carries the 1979 AT/FI/GR fallback, now tagged with source era", () => {
    const rows = reportCrossEraBudgetInheritance("1991-default");
    const byCountry = new Map(rows.map((row) => [row.countryId, row]));
    for (const countryId of ["AT", "FI", "GR"]) {
      const row = byCountry.get(countryId);
      expect(row, `${countryId} 1991 fallback`).toBeDefined();
      expect(row!.sourceFiscalYear).toBe(1979);
      expect(row!.fiscalYear).toBe(1991);
    }
  });

  it("fiscalYear rewriting no longer disguises the source era on the 2007 chain", () => {
    const rows = reportCrossEraBudgetInheritance("2007-default");
    const fr = rows.find((row) => row.countryId === "FR");
    expect(fr, "FR 2007 inheritance").toBeDefined();
    expect(fr!.sourceFiscalYear).toBe(1991);
    expect(fr!.fiscalYear).toBe(2007);
  });

  it("1979 and 1953 presets remain fully explicit", () => {
    expect(reportCrossEraBudgetInheritance("1979-default")).toEqual([]);
    expect(reportCrossEraBudgetInheritance("1953-default")).toEqual([]);
  });
});
