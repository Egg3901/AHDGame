import { EUROZONE_2027_MEMBERS } from "@/lib/currency/rules/euroAdoption";
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { getBankId } from "@/lib/centralBank/helpers";
import {
  computeStateGdpScalars,
  shouldReconcileStateGdpForPreset,
  STATE_GDP_RECONCILE_TOLERANCE,
} from "@/lib/admin/seed/reconcileStateGdp";
import { generateDefaultEnactedLaws } from "@/lib/seeds/reference/budgets";
import { expectedPrimeRate, type SeedExpectations } from "./expectations";
import { withinRelTol } from "./tolerance";
import type { SeedDiagnosticCheck } from "./types";
import { ok, warn, critical, relCheck } from "./checkFactory";
import { getStartingYearForPreset } from "@/lib/constants/turnTime";
import {
  COUNTRY_CURRENCY_MAP,
  getInitialRates,
  getSeedCurrencyCode,
  type CurrencyCode,
} from "@/lib/constants/currencies";
import {
  currencyConversionScale,
  currencyForCountryAtYear,
} from "@/lib/currency/rules/eraCurrency";

export async function checkNationalBudgets(
  db: Db,
  expect: SeedExpectations
): Promise<SeedDiagnosticCheck[]> {
  const checks: SeedDiagnosticCheck[] = [];
  const budgets = await db.collection("federalBudget").find({}).toArray();
  const byCountry = new Map(budgets.map((b) => [String(b.countryId), b]));
  // Check the active 1991 manifest against authored budget configs, including
  // the transition economies. A future roster expansion must not silently
  // create an active country without a fiscal baseline.
  if (expect.preset === "1991-default") {
    const authored = new Set(expect.nationalBudgets.map((cfg) => cfg.countryId));
    for (const countryId of expect.seededCountryIds) {
      if (!authored.has(countryId)) {
        checks.push(
          critical(
            `budget.${countryId}.authored1991`,
            countryId,
            "1991 national budget config",
            "present",
            null,
            "active 1991 country lacks an authored fiscal baseline"
          )
        );
      }
    }
  }
  const rates = getInitialRates(expect.preset);
  const euroRate = rates.DE;
  const authoredBudgetCurrency = new Map(
    expect.nationalBudgets.map((config) => [config.countryId, config.currencyCode])
  );
  const expectedMoneyScale = (countryId: string): number => {
    // The 2027 budget configs have already been converted to EUR. Earlier
    // presets still carry legacy-denominated configs and need this scale.
    if (authoredBudgetCurrency.get(countryId) === "EUR") return 1;
    const typedCountryId = countryId as CountryId;
    const legacyCurrency = COUNTRY_CURRENCY_MAP[typedCountryId];
    if (currencyForCountryAtYear(typedCountryId, expect.startingYear, legacyCurrency) !== "EUR")
      return 1;
    const legacyRate = rates[typedCountryId];
    if (typeof legacyRate !== "number" || legacyRate <= 0) return 1;
    if (typeof euroRate !== "number" || euroRate <= 0) return 1;
    return currencyConversionScale(legacyRate, euroRate);
  };

  const useGdpInvariant = shouldReconcileStateGdpForPreset(expect.preset);
  const regionRows = useGdpInvariant
    ? await db
        .collection<{ _id: string; countryId: string; gdp?: number }>("states")
        .find({})
        .project({ _id: 1, countryId: 1, gdp: 1 })
        .toArray()
    : [];

  const nationalGdpByCountry = new Map<string, number>();
  for (const cfg of expect.nationalBudgets) {
    nationalGdpByCountry.set(cfg.countryId, cfg.gdp * expectedMoneyScale(cfg.countryId));
  }

  if (useGdpInvariant) {
    const scalars = computeStateGdpScalars(
      regionRows as Parameters<typeof computeStateGdpScalars>[0],
      nationalGdpByCountry
    );
    for (const s of scalars) {
      const within = s.deviation <= STATE_GDP_RECONCILE_TOLERANCE;
      checks.push(
        within
          ? ok(
              `budget.${s.countryId}.gdpInvariant`,
              s.countryId,
              "Σ region gdp vs national",
              s.nationalGdp,
              s.regionalSum,
              `deviation ${(s.deviation * 100).toFixed(2)}% ≤ ${(STATE_GDP_RECONCILE_TOLERANCE * 100).toFixed(0)}%`
            )
          : critical(
              `budget.${s.countryId}.gdpInvariant`,
              s.countryId,
              "Σ region gdp vs national",
              s.nationalGdp,
              s.regionalSum,
              `deviation ${(s.deviation * 100).toFixed(2)}% > ${(STATE_GDP_RECONCILE_TOLERANCE * 100).toFixed(0)}% (post-reconcile)`
            )
      );
    }
  }

  for (const cfg of expect.nationalBudgets) {
    const moneyScale = expectedMoneyScale(cfg.countryId);
    const doc = byCountry.get(cfg.countryId);
    if (!doc) {
      checks.push(
        critical(`budget.${cfg.countryId}.exists`, cfg.countryId, "federalBudget", "present", null)
      );
      continue;
    }

    if (!useGdpInvariant) {
      checks.push(
        relCheck(
          `budget.${cfg.countryId}.gdp`,
          cfg.countryId,
          "gdp",
          cfg.gdp * moneyScale,
          doc.gdp as number
        )
      );
    }

    // federalBudget docs do not store population — verified via Σ regions below.

    const debt = doc.debt as { principal?: number; interestRate?: number } | undefined;
    checks.push(
      relCheck(
        `budget.${cfg.countryId}.debt.principal`,
        cfg.countryId,
        "debt.principal",
        cfg.debtPrincipal * moneyScale,
        debt?.principal
      )
    );
    checks.push(
      relCheck(
        `budget.${cfg.countryId}.debt.interestRate`,
        cfg.countryId,
        "debt.interestRate",
        cfg.debtInterestRate,
        debt?.interestRate
      )
    );

    const factors = doc.economicFactors as
      { gdpGrowth?: number; wageGrowth?: number; inflationRate?: number } | undefined;
    checks.push(
      relCheck(
        `budget.${cfg.countryId}.gdpGrowth`,
        cfg.countryId,
        "economicFactors.gdpGrowth",
        cfg.gdpGrowth,
        factors?.gdpGrowth
      )
    );
    checks.push(
      relCheck(
        `budget.${cfg.countryId}.wageGrowth`,
        cfg.countryId,
        "economicFactors.wageGrowth",
        cfg.wageGrowth,
        factors?.wageGrowth
      )
    );
    checks.push(
      relCheck(
        `budget.${cfg.countryId}.inflationRate`,
        cfg.countryId,
        "economicFactors.inflationRate",
        cfg.inflationRate,
        factors?.inflationRate
      )
    );
  }

  return checks;
}

export async function checkStaleCostFractions(
  db: Db,
  preset: string
): Promise<SeedDiagnosticCheck[]> {
  const expectedLaws = generateDefaultEnactedLaws(preset);
  const expectedByKey = new Map<string, (typeof expectedLaws)[number]>(
    expectedLaws.map((law) => [`${law.countryId}:${law.legislationTypeId}`, law])
  );
  const actualLaws = await db
    .collection<{
      countryId?: string;
      legislationTypeId?: string;
      gdpCostFraction?: number;
      incomeCostFraction?: number;
    }>("enactedLaws")
    .find({})
    .project({
      countryId: 1,
      legislationTypeId: 1,
      gdpCostFraction: 1,
      incomeCostFraction: 1,
    })
    .toArray();

  const checks: SeedDiagnosticCheck[] = [];
  let stale = 0;
  for (const law of actualLaws) {
    if (!law.countryId || !law.legislationTypeId) continue;
    const key = `${law.countryId}:${law.legislationTypeId}`;
    const expected = expectedByKey.get(key);
    if (!expected) continue;

    for (const field of ["gdpCostFraction", "incomeCostFraction"] as const) {
      const expectedHas = (expected as Record<string, unknown>)[field] !== undefined;
      const actualHas = law[field] !== undefined && law[field] !== null;
      if (!expectedHas && actualHas) {
        stale++;
        checks.push(
          critical(
            `enactedLaw.${law.countryId}.${law.legislationTypeId}.${field}`,
            law.countryId,
            field,
            null,
            law[field] ?? null,
            "stale cost fraction persisted from prior era"
          )
        );
      } else if (
        expectedHas &&
        actualHas &&
        !withinRelTol(
          Number(law[field]),
          Number((expected as Record<string, unknown>)[field]),
          0.01
        )
      ) {
        checks.push(
          critical(
            `enactedLaw.${law.countryId}.${law.legislationTypeId}.${field}`,
            law.countryId,
            field,
            Number((expected as Record<string, unknown>)[field]),
            Number(law[field]),
            "cost fraction mismatch vs era seed"
          )
        );
      }
    }
  }

  if (checks.length === 0) {
    checks.push(
      ok(
        "enactedLaws.costFractions",
        "global",
        "gdpCostFraction/incomeCostFraction",
        "era-consistent",
        "era-consistent",
        `checked ${actualLaws.length} laws, ${stale} stale`
      )
    );
  }
  return checks;
}

export async function checkMonetary(
  db: Db,
  expect: SeedExpectations
): Promise<SeedDiagnosticCheck[]> {
  const banks = await db
    .collection<{
      _id: string;
      countryId?: CountryId;
      primeRate?: number;
      rateHistory?: unknown[];
      inflationHistory?: unknown[];
    }>("centralBanks")
    .find({})
    .toArray();
  const byId = new Map(banks.map((b) => [String(b._id), b]));
  const checks: SeedDiagnosticCheck[] = [];

  for (const countryId of expect.monetaryCoverage.centralBankCountries) {
    const bankId = getBankId(countryId);
    const bank = byId.get(bankId);
    if (!bank) {
      checks.push(
        critical(`centralBank.${countryId}.exists`, countryId, "centralBanks", "present", null)
      );
      continue;
    }
    const expectedRate = expectedPrimeRate(countryId, expect.startingYear);
    checks.push(
      relCheck(
        `centralBank.${countryId}.primeRate`,
        countryId,
        "primeRate",
        expectedRate,
        bank.primeRate,
        0.01,
        "vs opening seeder policy benchmark"
      )
    );
    const rateHistLen = Array.isArray(bank.rateHistory) ? bank.rateHistory.length : -1;
    const inflHistLen = Array.isArray(bank.inflationHistory) ? bank.inflationHistory.length : -1;
    checks.push(
      rateHistLen <= 1
        ? ok(
            `centralBank.${countryId}.rateHistory`,
            countryId,
            "rateHistory.length",
            "≤1",
            rateHistLen
          )
        : warn(
            `centralBank.${countryId}.rateHistory`,
            countryId,
            "rateHistory.length",
            "≤1",
            rateHistLen,
            "expected empty or single-entry at turn 1"
          )
    );
    checks.push(
      inflHistLen <= 1
        ? ok(
            `centralBank.${countryId}.inflationHistory`,
            countryId,
            "inflationHistory.length",
            "≤1",
            inflHistLen
          )
        : warn(
            `centralBank.${countryId}.inflationHistory`,
            countryId,
            "inflationHistory.length",
            "≤1",
            inflHistLen
          )
    );
  }

  const budgetedCountries = new Set(expect.nationalBudgets.map(({ countryId }) => countryId));
  for (const bank of banks) {
    if (bank.countryId && !budgetedCountries.has(bank.countryId)) {
      checks.push(
        critical(
          `centralBank.${bank.countryId}.fiscalCoverage`,
          bank.countryId,
          "federalBudget",
          "authored budget",
          null,
          "central bank exists outside the preset's authored fiscal coverage"
        )
      );
    }
  }
  return checks;
}

export async function checkForex(db: Db, expect: SeedExpectations): Promise<SeedDiagnosticCheck[]> {
  const rates = await db
    .collection<{ _id: string; countryId?: string; currencyCode?: CurrencyCode; rate?: number }>(
      "exchangeRates"
    )
    .find({})
    .toArray();
  const byCountry = new Map(rates.map((r) => [String(r.countryId ?? r._id), r] as const));
  const checks: SeedDiagnosticCheck[] = [];
  const year = getStartingYearForPreset(expect.preset);

  if (expect.preset === "2027-default") {
    const gameState = await db
      .collection<{ _id: string; eurozoneEnabled?: boolean; euroAdoptedCountries?: string[] }>(
        "gameState"
      )
      .findOne({ _id: "current" });
    const expected = [...EUROZONE_2027_MEMBERS].sort();
    const actual = gameState?.euroAdoptedCountries;
    const valid =
      gameState?.eurozoneEnabled === true &&
      Array.isArray(actual) &&
      actual.length === expected.length &&
      [...actual].sort().every((countryId, index) => countryId === expected[index]);
    checks.push(
      valid
        ? ok(
            "forex.euroAdoption",
            "global",
            "euroAdoptedCountries",
            expected.join(","),
            expected.join(",")
          )
        : critical(
            "forex.euroAdoption",
            "global",
            "euroAdoptedCountries",
            expected.join(","),
            `enabled=${String(gameState?.eurozoneEnabled ?? null)}; countries=${Array.isArray(actual) ? [...actual].sort().join(",") : "missing"}`,
            "2027 adoption manifest does not match persisted game state"
          )
    );
  }

  for (const countryId of expect.forexActiveCountries) {
    const expectedCurrency = currencyForCountryAtYear(
      countryId,
      year,
      getSeedCurrencyCode(countryId, expect.preset)
    );
    const expectedRate =
      expectedCurrency === "EUR" ? expect.forexRates.DE : expect.forexRates[countryId];
    if (expectedRate == null) {
      checks.push(
        warn(
          `forex.${countryId}.rate`,
          countryId,
          "rate",
          null,
          null,
          "no era anchor in getInitialRates"
        )
      );
      continue;
    }
    const doc = byCountry.get(countryId);
    if (!doc) {
      checks.push(
        critical(`forex.${countryId}.exists`, countryId, "exchangeRates", "present", null)
      );
      continue;
    }
    checks.push(
      relCheck(`forex.${countryId}.rate`, countryId, "rate", expectedRate, doc.rate, 0.01)
    );
    checks.push(
      doc.currencyCode === expectedCurrency
        ? ok(
            `forex.${countryId}.currency`,
            countryId,
            "exchangeRates.currencyCode",
            expectedCurrency,
            doc.currencyCode
          )
        : critical(
            `forex.${countryId}.currency`,
            countryId,
            "exchangeRates.currencyCode",
            expectedCurrency,
            doc.currencyCode ?? null,
            "currency topology does not match the selected era"
          )
    );

    if (expectedCurrency === "EUR") {
      const [budget, legacyCorps, legacyBonds] = await Promise.all([
        db.collection("federalBudget").findOne({ countryId }, { projection: { currencyCode: 1 } }),
        db.collection("corporations").countDocuments({
          countryId,
          liquidCurrencyCode: { $ne: "EUR" },
        }),
        db.collection("bonds").countDocuments({ countryId, currencyCode: { $ne: "EUR" } }),
      ]);
      checks.push(
        budget?.currencyCode === "EUR" && legacyCorps === 0 && legacyBonds === 0
          ? ok(
              `forex.${countryId}.euroTopology`,
              countryId,
              "budget/corporation/bond currency",
              "EUR",
              "EUR"
            )
          : critical(
              `forex.${countryId}.euroTopology`,
              countryId,
              "budget/corporation/bond currency",
              "EUR",
              `budget=${String(budget?.currencyCode ?? "missing")}, legacyCorps=${legacyCorps}, legacyBonds=${legacyBonds}`,
              "euro member retains a legacy denomination"
            )
      );
    }
  }

  // ⚠️ The loop above iterates `forexActiveCountries` ONLY, which is exactly why
  // it could not see the defect this block covers. `COUNTRY_CURRENCY_MAP`
  // assigns a currency to more countries than `FOREX_ACTIVE_COUNTRIES` lists —
  // the budget-only Warsaw-Pact economies among them. Those corps carry a real
  // `liquidCurrencyCode`, so every FX helper takes the convert path for them;
  // with no rate row AND no authored era rate they silently fall through to 1.0
  // and a złoty is read as ₳1.
  //
  // A missing ROW is correct for these and is not asserted. What must hold is
  // that an authored era rate EXISTS, since that is what the helpers now
  // resolve. Absent, corp valuations for that country are silently wrong.
  const { eraRateForCurrency } = await import("@/lib/constants/currencies");
  const forexActive = new Set<string>(expect.forexActiveCountries);
  const seededCountries = new Set<string>(expect.seededCountryIds);
  for (const [countryId, code] of Object.entries(COUNTRY_CURRENCY_MAP)) {
    if (forexActive.has(countryId) || !seededCountries.has(countryId)) continue;
    const era = eraRateForCurrency(code, expect.preset);
    checks.push(
      era !== undefined && era > 0
        ? ok(`forex.${countryId}.eraRate`, countryId, "eraRate", "present", era)
        : warn(
            `forex.${countryId}.eraRate`,
            countryId,
            "eraRate",
            "present",
            null,
            `${code} has no authored rate for ${expect.preset} — corps of this country value at 1.0`
          )
    );
  }
  return checks;
}
