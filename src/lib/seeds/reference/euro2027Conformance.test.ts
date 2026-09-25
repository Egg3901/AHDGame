import { describe, expect, it, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";
import {
  getNationalBudgetSeedConfigsForPreset,
  getInitialNationalBudgetsForPreset,
  NATIONAL_BUDGET_SEED_CONFIGS_2027,
  type NationalBudgetSeedConfig,
} from "./budgets";
import {
  COUNTRY_CURRENCY_MAP,
  getInitialRates,
  getSeedCurrencyCode,
  type CurrencyCode,
} from "@/lib/constants/currencies";
import {
  EUROZONE_2027_MEMBERS,
  euroConversionFactor,
  legacyAnchorValue,
} from "@/lib/currency/rules/euroAdoption";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const MEMBERS = [...EUROZONE_2027_MEMBERS];
const RATES_2027 = getInitialRates("2027-default");
const RATES_1991 = getInitialRates("1991-default");

function configsByCountry(
  configs: NationalBudgetSeedConfig[]
): Map<string, NationalBudgetSeedConfig> {
  return new Map(configs.map((config) => [config.countryId, config]));
}

/** Pre-conversion row for a 2027 euro member: the authored 2027 override when
 * one exists, else the inherited 2023 row the overlay carries forward. */
function preConversionBase(
  countryId: string,
  configs2023: NationalBudgetSeedConfig[]
): NationalBudgetSeedConfig {
  return (
    NATIONAL_BUDGET_SEED_CONFIGS_2027.find((config) => config.countryId === countryId) ??
    configsByCountry(configs2023).get(countryId)!
  );
}

describe("2027 euro seed conformance", () => {
  describe("budget configs", () => {
    it("prices every euro member in EUR and leaves non-members on their home code", () => {
      const byCountry = configsByCountry(getNationalBudgetSeedConfigsForPreset("2027-default"));
      for (const member of MEMBERS) {
        expect(byCountry.get(member)?.currencyCode, member).toBe("EUR");
      }
      for (const outsider of ["US", "UK", "SE", "CN", "BR", "NG", "TR"] as const) {
        expect(byCountry.get(outsider)?.currencyCode, outsider).toBe(
          COUNTRY_CURRENCY_MAP[outsider]
        );
      }
    });

    it("converts absolute-money fields at the authored cross rate, ratios pass through", () => {
      const configs2027 = configsByCountry(getNationalBudgetSeedConfigsForPreset("2027-default"));
      const configs2023 = getNationalBudgetSeedConfigsForPreset("2023-default");
      const eurAnchorRate = RATES_2027.DE!;
      for (const member of MEMBERS) {
        if (member === "DE") continue; // already EUR, untouched
        const converted = configs2027.get(member)!;
        const base = preConversionBase(member, configs2023);
        expect(base, `${member} has a pre-conversion row`).toBeDefined();
        const factor = euroConversionFactor(RATES_2027[member]!, eurAnchorRate);

        expect(converted.gdp).toBe(base.gdp * factor);
        expect(converted.otherRevenue).toBe(base.otherRevenue * factor);
        expect(converted.debt.principal).toBe(base.debt.principal * factor);
        expect(converted.debt.ceiling).toBe(base.debt.ceiling * factor);
        expect(converted.baselineStateGrants).toBe(base.baselineStateGrants * factor);
        for (const [category, baseline] of Object.entries(base.baselineSpendingByCategory)) {
          expect(converted.baselineSpendingByCategory[category]).toBe(baseline * factor);
        }
        for (const [index, revenueConfig] of (base.policyRevenueConfigs ?? []).entries()) {
          expect(
            converted.policyRevenueConfigs?.[index]?.annualRevenuePerCapitaByOptionIndex
          ).toEqual(
            revenueConfig.annualRevenuePerCapitaByOptionIndex?.map(
              (perCapita) => perCapita * factor
            )
          );
        }
        // Ratios and rates are unit-free: byte-identical to the base row.
        expect(converted.taxBaseRatios).toEqual(base.taxBaseRatios);
        expect(converted.debt.interestRate).toBe(base.debt.interestRate);
        expect(converted.creditRating).toBe(base.creditRating);
      }
    });

    it("conserves anchor value between the converted row and the FX-seeded rate", () => {
      const configs2027 = configsByCountry(getNationalBudgetSeedConfigsForPreset("2027-default"));
      const configs2023 = getNationalBudgetSeedConfigsForPreset("2023-default");
      const eurAnchorRate = RATES_2027.DE!;
      for (const member of MEMBERS) {
        if (member === "DE") continue;
        const converted = configs2027.get(member)!;
        const base = preConversionBase(member, configs2023);
        // Same-table property the seeder guarantees: converted euros at the
        // anchor rate hold exactly the anchor value the legacy amount held at
        // the legacy rate, so budget and FX rows agree in internal units.
        // Relative form: absolute closeness is meaningless at trillion scale
        // (float64 carries ~16 significant digits, not 9 decimal places).
        const gdpAnchorRatio =
          legacyAnchorValue(converted.gdp, eurAnchorRate) /
          legacyAnchorValue(base.gdp, RATES_2027[member]!);
        expect(gdpAnchorRatio).toBeCloseTo(1, 12);
        const debtAnchorRatio =
          legacyAnchorValue(converted.debt.principal, eurAnchorRate) /
          legacyAnchorValue(base.debt.principal, RATES_2027[member]!);
        expect(debtAnchorRatio).toBeCloseTo(1, 12);
      }
    });

    it("converts Ireland at factor 1.0: code flips, amounts stay", () => {
      const configs2027 = configsByCountry(getNationalBudgetSeedConfigsForPreset("2027-default"));
      const configs2023 = getNationalBudgetSeedConfigsForPreset("2023-default");
      const converted = configs2027.get("IE")!;
      const base = preConversionBase("IE", configs2023);
      expect(euroConversionFactor(RATES_2027.IE!, RATES_2027.DE!)).toBe(1);
      expect(converted.currencyCode).toBe("EUR");
      expect(converted.gdp).toBe(base.gdp);
      expect(converted.debt.principal).toBe(base.debt.principal);
    });

    it("built 2027 budgets (federalBudget rows) carry EUR for members", () => {
      const budgets = getInitialNationalBudgetsForPreset("2027-default");
      const byCountry = new Map(budgets.map((budget) => [budget.countryId, budget]));
      for (const member of MEMBERS) {
        expect(byCountry.get(member)?.currencyCode, member).toBe("EUR");
      }
    });
  });

  describe("1991 nonchange", () => {
    it("keeps every 1991 budget row on its era-blind home code", () => {
      // DE reads EUR here by design (its home code is the DM-proxy EUR in
      // every preset); the nonchange property is map-equality, not EUR absence.
      for (const config of getNationalBudgetSeedConfigsForPreset("1991-default")) {
        expect(config.currencyCode).toBe(COUNTRY_CURRENCY_MAP[config.countryId]);
      }
    });

    it("passes non-2027 presets through the seed currency map untouched", () => {
      for (const preset of ["1991-default", "2019-default", "2023-default", "1953-default"]) {
        for (const member of MEMBERS) {
          expect(getSeedCurrencyCode(member, preset), `${member}@${preset}`).toBe(
            COUNTRY_CURRENCY_MAP[member]
          );
        }
      }
    });

    it("builds EUR 1991 budget rows for DE only (its home code)", () => {
      for (const budget of getInitialNationalBudgetsForPreset("1991-default")) {
        if (budget.countryId === "DE") {
          expect(budget.currencyCode).toBe("EUR");
        } else {
          expect(budget.currencyCode, budget.countryId).not.toBe("EUR");
        }
      }
    });
  });

  describe("FX seed rows", () => {
    let db: MockDb;

    function seedOps() {
      const calls = db.collectionMocks.exchangeRates.bulkWrite.mock.calls;
      expect(calls).toHaveLength(1);
      return calls[0][0] as Array<{
        updateOne: {
          filter: { _id: string };
          update: { $setOnInsert: { currencyCode: CurrencyCode; rate: number } };
        };
      }>;
    }

    beforeEach(async () => {
      vi.resetModules();
      db = createMockDb();
      const { getDb } = await import("@/lib/mongodb");
      vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    });

    it("seeds 2027 euro members as EUR at the DE anchor rate", async () => {
      const { seedExchangeRates } = await import("@/lib/currency/migration");
      await seedExchangeRates(db as unknown as Db, "2027-default");

      const byCountry = new Map(seedOps().map((op) => [op.updateOne.filter._id, op]));
      for (const member of MEMBERS) {
        const op = byCountry.get(member);
        expect(op?.updateOne.update.$setOnInsert.currencyCode, member).toBe("EUR");
        expect(op?.updateOne.update.$setOnInsert.rate, member).toBe(RATES_2027.DE);
      }
      // Non-members keep code and table rate.
      for (const outsider of ["US", "UK", "SE", "CN"] as const) {
        const op = byCountry.get(outsider);
        expect(op?.updateOne.update.$setOnInsert.currencyCode, outsider).toBe(
          COUNTRY_CURRENCY_MAP[outsider]
        );
        expect(op?.updateOne.update.$setOnInsert.rate, outsider).toBe(RATES_2027[outsider]);
      }
    });

    it("seeds 1991 rows on home codes and table rates (DE EUR by design)", async () => {
      const { seedExchangeRates } = await import("@/lib/currency/migration");
      await seedExchangeRates(db as unknown as Db, "1991-default");

      for (const op of seedOps()) {
        const countryId = op.updateOne.filter._id;
        expect(op.updateOne.update.$setOnInsert.currencyCode, countryId).toBe(
          COUNTRY_CURRENCY_MAP[countryId as keyof typeof COUNTRY_CURRENCY_MAP]
        );
        if (countryId !== "DE") {
          expect(op.updateOne.update.$setOnInsert.currencyCode, countryId).not.toBe("EUR");
        }
        expect(op.updateOne.update.$setOnInsert.rate, countryId).toBe(
          RATES_1991[countryId as keyof typeof RATES_1991]
        );
      }
    });
  });

  describe("three-way agreement", () => {
    it("budget EUR set, FX EUR set, and euroAdoptedCountries source agree on the eight", () => {
      const budgetEur = new Set(
        getNationalBudgetSeedConfigsForPreset("2027-default")
          .filter((config) => config.currencyCode === "EUR")
          .map((config) => config.countryId)
      );
      const fxEur = new Set(
        MEMBERS.filter((member) => getSeedCurrencyCode(member, "2027-default") === "EUR")
      );
      expect([...budgetEur].sort()).toEqual([...MEMBERS].sort());
      expect([...fxEur].sort()).toEqual([...MEMBERS].sort());
      // seedForex writes euroAdoptedCountries from this same list.
      expect([...EUROZONE_2027_MEMBERS].sort()).toEqual([...MEMBERS].sort());
    });
  });
});
