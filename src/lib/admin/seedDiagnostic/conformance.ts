/**
 * Mode A — seed conformance checks.
 * Epsilon-level tolerances; nothing has run yet at post-reset turn 1.
 */

import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { NATIONAL_SCOPE_IDS } from "@/lib/constants/nationalScope";
import { getBankId } from "@/lib/centralBank/helpers";
import { buildCountryReadinessReport } from "@/lib/admin/countryReadinessReport";
import {
  computeStateGdpScalars,
  shouldReconcileStateGdpForPreset,
  STATE_GDP_RECONCILE_TOLERANCE,
} from "@/lib/admin/seed/reconcileStateGdp";
import { getRuntimeCollectionNames } from "@/lib/admin/seed/seedManifest";
import { normalizeMaintenanceMode } from "@/lib/maintenanceStatus";
import { generateDefaultEnactedLaws } from "@/lib/seeds/reference/budgets";
import { COUNTRY_ELECTION_PHASES } from "@/lib/turn/countryPhases";
import {
  buildSeedExpectations,
  expectedPrimeRate,
  expectedRegionCount,
  readinessCountryIds,
  type SeedExpectations,
} from "./expectations";
import {
  CONFORMANCE_POP_STRUCTURAL_BREAK,
  CONFORMANCE_POP_TOL,
  CONFORMANCE_REL_TOL,
  CONFORMANCE_SECTOR_MAX_SHARE,
  withinRelTol,
} from "./tolerance";
import type { SeedDiagnosticCheck, SeedDiagnosticSeverity } from "./types";
import { check, ok, warn, critical } from "./checkFactory";
import { checkRegionDerivedCoverage } from "./regionDerivedCoverage";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

/** Readiness check names that are expected-empty pre-founding / pre-seat. */
const PRE_FOUNDING_READINESS = new Set(["NPPs", "ElectedOfficials", "GovernmentFormation"]);

/** Runtime history/log collections that must be empty at turn 1. */
const EMPTY_AT_TURN1: readonly string[] = [
  "turnLogs",
  "commodityPriceHistory",
  "stateApprovalHistory",
  "stateMetricHistory",
  "parliamentSeatsHistory",
  "corporationHistory",
  "marketCapHistory",
  "shareTradeHistory",
  "bondHistory",
  "tradeHistory",
  "portfolioHistory",
  "partyHistory",
  "influenceHistory",
  "countryHistory",
  "wealthListHistory",
  "corporationCountryHistory",
  "corporationPortfolioHistory",
];

/**
 * Classify Σ region population vs national budget seed population.
 * Dual-authored sources are not reconciled (unlike GDP) — ordinary drift is WARN.
 * CRITICAL only for structural breaks: no regions, non-positive sum, or >25% drift.
 */
export function classifyPopulationSumCheck(
  countryId: string,
  expectedNationalPop: number,
  regionCount: number,
  summedPopulation: number
): SeedDiagnosticCheck {
  const id = `regions.${countryId}.populationSum`;
  const metric = "Σ region population";

  if (regionCount === 0) {
    return critical(id, countryId, metric, expectedNationalPop, summedPopulation, "no regions");
  }
  if (!(summedPopulation > 0) || !Number.isFinite(summedPopulation)) {
    return critical(
      id,
      countryId,
      metric,
      expectedNationalPop,
      summedPopulation,
      "summed population ≤ 0"
    );
  }
  if (!(expectedNationalPop > 0) || !Number.isFinite(expectedNationalPop)) {
    return warn(
      id,
      countryId,
      metric,
      expectedNationalPop,
      summedPopulation,
      "national budget population missing/invalid"
    );
  }

  const drift = Math.abs(summedPopulation - expectedNationalPop) / expectedNationalPop;
  const driftNote = `drift ${(drift * 100).toFixed(2)}% (budget vs Σ regions; not reconciled)`;

  if (drift > CONFORMANCE_POP_STRUCTURAL_BREAK) {
    return critical(
      id,
      countryId,
      metric,
      expectedNationalPop,
      summedPopulation,
      `${driftNote} — structural break (>${(CONFORMANCE_POP_STRUCTURAL_BREAK * 100).toFixed(0)}%)`
    );
  }
  if (drift > CONFORMANCE_POP_TOL) {
    return warn(id, countryId, metric, expectedNationalPop, summedPopulation, driftNote);
  }
  return ok(id, countryId, metric, expectedNationalPop, summedPopulation, driftNote);
}

function relCheck(
  id: string,
  scope: string,
  metric: string,
  expected: number,
  actual: number | null | undefined,
  tol: number = CONFORMANCE_REL_TOL,
  note?: string
): SeedDiagnosticCheck {
  if (actual == null || !Number.isFinite(actual)) {
    return critical(id, scope, metric, expected, actual ?? null, note ?? "missing actual");
  }
  if (withinRelTol(actual, expected, tol)) {
    return ok(id, scope, metric, expected, actual, note);
  }
  const drift = Math.abs(actual - expected) / Math.max(Math.abs(expected), 1e-9);
  return critical(
    id,
    scope,
    metric,
    expected,
    actual,
    note ?? `drift ${(drift * 100).toFixed(2)}% > ${(tol * 100).toFixed(1)}% tol`
  );
}

async function checkGameStateClock(
  db: Db,
  expect: SeedExpectations
): Promise<SeedDiagnosticCheck[]> {
  const gs = await db.collection("gameState").findOne({ _id: "current" as never });
  const checks: SeedDiagnosticCheck[] = [];
  if (!gs) {
    return [
      critical("gameState.exists", "global", "gameState", "present", null, "missing gameState"),
    ];
  }

  const preset = typeof gs.preset === "string" ? gs.preset : null;
  checks.push(
    expect.knownPreset && preset === expect.preset
      ? ok("gameState.preset", "global", "preset", expect.preset, preset)
      : critical(
          "gameState.preset",
          "global",
          "preset",
          expect.preset,
          preset,
          expect.knownPreset ? "preset mismatch" : "unknown preset"
        )
  );

  const startingYear = typeof gs.startingYear === "number" ? gs.startingYear : null;
  checks.push(
    startingYear === expect.startingYear
      ? ok("gameState.startingYear", "global", "startingYear", expect.startingYear, startingYear)
      : critical(
          "gameState.startingYear",
          "global",
          "startingYear",
          expect.startingYear,
          startingYear
        )
  );

  const currentTurn = typeof gs.currentTurn === "number" ? gs.currentTurn : null;
  checks.push(
    currentTurn === 1
      ? ok("gameState.currentTurn", "global", "currentTurn", 1, currentTurn)
      : critical("gameState.currentTurn", "global", "currentTurn", 1, currentTurn)
  );

  const currentYear = typeof gs.currentYear === "number" ? gs.currentYear : null;
  const preIterActive = gs.preIteration?.active === true;
  if (preIterActive) {
    checks.push(
      currentYear === expect.startingYear
        ? ok(
            "gameState.currentYear",
            "global",
            "currentYear",
            expect.startingYear,
            currentYear,
            "preIteration.active pins currentYear to startingYear"
          )
        : critical(
            "gameState.currentYear",
            "global",
            "currentYear",
            expect.startingYear,
            currentYear,
            "preIteration.active but currentYear drifted"
          )
    );
  } else {
    checks.push(
      currentYear === expect.startingYear
        ? ok("gameState.currentYear", "global", "currentYear", expect.startingYear, currentYear)
        : critical(
            "gameState.currentYear",
            "global",
            "currentYear",
            expect.startingYear,
            currentYear
          )
    );
  }

  checks.push(
    gs.iteration != null
      ? ok(
          "gameState.iteration",
          "global",
          "iteration",
          "stamped",
          typeof gs.iteration === "object" ? JSON.stringify(gs.iteration) : String(gs.iteration)
        )
      : warn("gameState.iteration", "global", "iteration", "stamped", null, "iteration not set")
  );

  return checks;
}

function checkBundleFallbacks(expect: SeedExpectations): SeedDiagnosticCheck[] {
  if (expect.bundleFallbacks.length === 0) {
    return [
      ok(
        "preset.bundles",
        "global",
        "bundleCoverage",
        "explicit",
        "explicit",
        "all core domains have explicit bundles"
      ),
    ];
  }
  return expect.bundleFallbacks.map((f) =>
    critical(`preset.bundle.${f.domain}`, "global", f.domain, "explicit", "2019-fallback", f.note)
  );
}

async function checkNationalBudgets(
  db: Db,
  expect: SeedExpectations
): Promise<SeedDiagnosticCheck[]> {
  const checks: SeedDiagnosticCheck[] = [];
  const budgets = await db.collection("federalBudget").find({}).toArray();
  const byCountry = new Map(budgets.map((b) => [String(b.countryId), b]));

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
    nationalGdpByCountry.set(cfg.countryId, cfg.gdp);
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
    const doc = byCountry.get(cfg.countryId);
    if (!doc) {
      checks.push(
        critical(`budget.${cfg.countryId}.exists`, cfg.countryId, "federalBudget", "present", null)
      );
      continue;
    }

    if (!useGdpInvariant) {
      checks.push(
        relCheck(`budget.${cfg.countryId}.gdp`, cfg.countryId, "gdp", cfg.gdp, doc.gdp as number)
      );
    }

    // federalBudget docs do not store population — verified via Σ regions below.

    const debt = doc.debt as { principal?: number; interestRate?: number } | undefined;
    checks.push(
      relCheck(
        `budget.${cfg.countryId}.debt.principal`,
        cfg.countryId,
        "debt.principal",
        cfg.debtPrincipal,
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

async function checkStaleCostFractions(db: Db, preset: string): Promise<SeedDiagnosticCheck[]> {
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

async function checkMonetary(db: Db, expect: SeedExpectations): Promise<SeedDiagnosticCheck[]> {
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

  for (const countryId of expect.forexActiveCountries) {
    const bankId = getBankId(countryId);
    const bank = byId.get(bankId);
    if (!bank) {
      checks.push(
        critical(`centralBank.${countryId}.exists`, countryId, "centralBanks", "present", null)
      );
      continue;
    }
    const expectedRate = expectedPrimeRate(countryId);
    checks.push(
      relCheck(
        `centralBank.${countryId}.primeRate`,
        countryId,
        "primeRate",
        expectedRate,
        bank.primeRate,
        0.01,
        "vs seeder defaultPrimeRate"
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
  return checks;
}

async function checkForex(db: Db, expect: SeedExpectations): Promise<SeedDiagnosticCheck[]> {
  const rates = await db
    .collection<{ _id: string; countryId?: string; rate?: number }>("exchangeRates")
    .find({})
    .toArray();
  const byCountry = new Map(rates.map((r) => [String(r.countryId ?? r._id), r] as const));
  const checks: SeedDiagnosticCheck[] = [];

  for (const countryId of expect.forexActiveCountries) {
    const expectedRate = expect.forexRates[countryId];
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
  const { COUNTRY_CURRENCY_MAP, eraRateForCurrency } = await import("@/lib/constants/currencies");
  const forexActive = new Set<string>(expect.forexActiveCountries);
  for (const [countryId, code] of Object.entries(COUNTRY_CURRENCY_MAP)) {
    if (forexActive.has(countryId)) continue;
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

async function checkSectors(db: Db, expect: SeedExpectations): Promise<SeedDiagnosticCheck[]> {
  const checks: SeedDiagnosticCheck[] = [];
  const countries = expect.seededCountryIds;

  for (const countryId of countries) {
    const unownedCount = await db.collection("unownedSectors").countDocuments({ countryId });
    checks.push(
      unownedCount > 0
        ? ok(`sectors.${countryId}.unowned`, countryId, "unownedSectors.count", ">0", unownedCount)
        : critical(
            `sectors.${countryId}.unowned`,
            countryId,
            "unownedSectors.count",
            ">0",
            unownedCount
          )
    );

    const strategicCount = await db
      .collection("strategicSectorDesignations")
      .countDocuments({ countryId });
    checks.push(
      strategicCount > 0
        ? ok(
            `sectors.${countryId}.strategic`,
            countryId,
            "strategicSectorDesignations.count",
            ">0",
            strategicCount
          )
        : warn(
            `sectors.${countryId}.strategic`,
            countryId,
            "strategicSectorDesignations.count",
            ">0",
            strategicCount,
            "no strategic designations"
          )
    );

    // Sanity: revenue shares must sum to ~1 and no single sector dominate.
    // Exact weight-table match is unreliable once MIN_UNOWNED floors apply.
    const rows = await db
      .collection<{ sectorType?: string; revenue?: number }>("unownedSectors")
      .find({ countryId })
      .project({ sectorType: 1, revenue: 1 })
      .toArray();
    const revenueByType = new Map<string, number>();
    let total = 0;
    for (const row of rows) {
      const t = row.sectorType ?? "";
      const rev = Number(row.revenue) || 0;
      revenueByType.set(t, (revenueByType.get(t) ?? 0) + rev);
      total += rev;
    }
    if (total > 0) {
      let maxShare = 0;
      let maxType = "";
      let shareSum = 0;
      for (const [t, rev] of revenueByType) {
        const share = rev / total;
        shareSum += share;
        if (share > maxShare) {
          maxShare = share;
          maxType = t;
        }
      }
      const sumOk = Math.abs(shareSum - 1) <= 0.02;
      const maxOk = maxShare <= CONFORMANCE_SECTOR_MAX_SHARE;
      if (sumOk && maxOk) {
        checks.push(
          ok(
            `sectors.${countryId}.weightDist`,
            countryId,
            "sector share sanity",
            `sum≈1, max≤${CONFORMANCE_SECTOR_MAX_SHARE}`,
            `sum=${shareSum.toFixed(3)}, max=${maxType}:${maxShare.toFixed(3)}`
          )
        );
      } else {
        checks.push(
          critical(
            `sectors.${countryId}.weightDist`,
            countryId,
            "sector share sanity",
            `sum≈1, max≤${CONFORMANCE_SECTOR_MAX_SHARE}`,
            `sum=${shareSum.toFixed(3)}, max=${maxType}:${maxShare.toFixed(3)}`,
            !sumOk ? "shares do not sum to ~1" : `sector ${maxType} implausibly dominant`
          )
        );
      }
    }
  }
  return checks;
}

async function checkRegions(db: Db, expect: SeedExpectations): Promise<SeedDiagnosticCheck[]> {
  const checks: SeedDiagnosticCheck[] = [];
  // Structural region checks for every seeded country (not just readiness set).
  for (const countryId of expect.seededCountryIds) {
    const regionCount = await db.collection("states").countDocuments({ countryId });
    const expectedCount = expectedRegionCount(countryId, expect.preset);

    if (expectedCount != null) {
      checks.push(
        regionCount === expectedCount
          ? ok(
              `regions.${countryId}.count`,
              countryId,
              "states.count",
              expectedCount,
              regionCount,
              "era-authored region bundle"
            )
          : critical(
              `regions.${countryId}.count`,
              countryId,
              "states.count",
              expectedCount,
              regionCount,
              "era-authored region bundle"
            )
      );
    } else {
      checks.push(
        regionCount > 0
          ? ok(
              `regions.${countryId}.count`,
              countryId,
              "states.count",
              ">0",
              regionCount,
              "presence (no dedicated era count registered)"
            )
          : critical(
              `regions.${countryId}.count`,
              countryId,
              "states.count",
              ">0",
              regionCount,
              "no regions seeded"
            )
      );
    }

    // Metrics: countryId filter (era-agnostic). Expect ≈ region count when regions exist.
    // Every country's regions carry a macroMetrics doc — the branch that counted
    // `stateMetrics` for non-playables was reporting on a store nothing writes,
    // so it read 0 and flagged every one of them as missing region metrics.
    const metricsCount = await db.collection("macroMetrics").countDocuments({ countryId });
    if (regionCount > 0) {
      checks.push(
        metricsCount === regionCount
          ? ok(
              `regions.${countryId}.metrics`,
              countryId,
              `macroMetrics.count`,
              regionCount,
              metricsCount,
              "matches region count"
            )
          : metricsCount > 0
            ? warn(
                `regions.${countryId}.metrics`,
                countryId,
                `macroMetrics.count`,
                regionCount,
                metricsCount,
                "metrics count ≠ region count"
              )
            : critical(
                `regions.${countryId}.metrics`,
                countryId,
                `macroMetrics.count`,
                regionCount,
                metricsCount,
                "no region metrics for seeded regions"
              )
      );
    }

    const cfg = expect.nationalBudgets.find((b) => b.countryId === countryId);
    if (cfg) {
      const states = await db
        .collection<{ _id: string; population?: number }>("states")
        .find({ countryId })
        .project({ _id: 1, population: 1 })
        .toArray();
      const sum = states
        .filter((s) => !NATIONAL_SCOPE_IDS.has(String(s._id)))
        .reduce((acc, s) => acc + (Number(s.population) || 0), 0);
      checks.push(classifyPopulationSumCheck(countryId, cfg.population, regionCount, sum));
    }
  }
  return checks;
}

async function checkPolitical(db: Db, expect: SeedExpectations): Promise<SeedDiagnosticCheck[]> {
  const checks: SeedDiagnosticCheck[] = [];
  for (const countryId of readinessCountryIds(expect.preset)) {
    const report = await buildCountryReadinessReport(db, countryId, expect.preset);
    if (!report) {
      checks.push(
        warn(
          `readiness.${countryId}`,
          countryId,
          "countryReadiness",
          "report",
          null,
          "no expectations entry"
        )
      );
      continue;
    }
    for (const c of report.checks) {
      let severity: SeedDiagnosticSeverity =
        c.status === "ok" ? "ok" : c.status === "warning" ? "warn" : "critical";
      let note = c.detail;
      // Pre-founding: officials / NPPs / government formation are not seated yet
      // on a plain historical seed — keep the detail but do not critical.
      if (severity === "critical" && PRE_FOUNDING_READINESS.has(c.name)) {
        severity = "warn";
        note = `${c.detail ?? c.name} (expected pre-founding)`;
      }
      checks.push(
        check(
          `readiness.${countryId}.${c.name}`,
          countryId,
          c.name,
          c.detail ?? null,
          c.count ?? c.status,
          severity,
          note
        )
      );
    }
  }
  return checks;
}

/**
 * Every country registered in {@link COUNTRY_ELECTION_PHASES} spawns
 * founding/perpetual elections regardless of preset — the registry is not
 * itself preset-gated, only the seat maps behind each `ensureXXElections`
 * call are. A country that spawns races but was seeded with zero political
 * parties for the active preset can never field a candidate: no NPP, no
 * `challengerSupply` floor, no player — the chamber resolves empty in every
 * world, forever. This was the root cause of #3875 (FR/IT/ES/SE/TR/GR/FI/AT
 * under 1991-default, NG under 1979-default): 4,552 + 1,466 seats stranded
 * because the country was in the election-phase registry but had no
 * `validForPresets`-gated roster authored for that era.
 *
 * `validForPresets` itself is stripped before a party seed is written to
 * `politicalParties` (see `ensureDefaultParties`/`seedXXParties`), so a
 * plain `countDocuments({ countryId })` after seeding is the correct
 * post-hoc signal: it is zero if and only if nothing in that country's
 * roster was valid for the active preset.
 */
async function checkPartyRosters(db: Db, expect: SeedExpectations): Promise<SeedDiagnosticCheck[]> {
  const checks: SeedDiagnosticCheck[] = [];
  const seeded = new Set(expect.seededCountryIds);
  const electionCountries = Object.keys(COUNTRY_ELECTION_PHASES) as CountryId[];

  for (const countryId of electionCountries) {
    if (!seeded.has(countryId)) continue; // not part of this preset's world
    const count = await db.collection("politicalParties").countDocuments({ countryId });
    checks.push(
      count > 0
        ? ok(`parties.${countryId}.roster`, countryId, "politicalParties.count", ">0", count)
        : critical(
            `parties.${countryId}.roster`,
            countryId,
            "politicalParties.count",
            ">0",
            count,
            "spawns founding/perpetual elections (COUNTRY_ELECTION_PHASES) but has zero " +
              "seeded parties for this preset — every chamber resolves empty forever (#3875)"
          )
    );
  }
  return checks;
}

async function checkDemographics(db: Db, expect: SeedExpectations): Promise<SeedDiagnosticCheck[]> {
  const checks: SeedDiagnosticCheck[] = [];
  checks.push(
    expect.eraCompositionOk
      ? ok(
          "demographics.eraComposition",
          "global",
          "ERA_COMPOSITIONS",
          expect.era,
          expect.era,
          "era composition resolved"
        )
      : critical(
          "demographics.eraComposition",
          "global",
          "ERA_COMPOSITIONS",
          expect.era,
          null,
          "era composition missing — would fall back"
        )
  );

  for (const countryId of expect.seededCountryIds) {
    const regionCount = await db.collection("states").countDocuments({ countryId });
    const expectedDemo = expectedRegionCount(countryId, expect.preset) ?? regionCount;
    const demoCount = await db.collection("stateDemographics").countDocuments({ countryId });

    if (expectedDemo > 0) {
      checks.push(
        demoCount === expectedDemo
          ? ok(
              `demographics.${countryId}.stateDemographics`,
              countryId,
              "stateDemographics.count",
              expectedDemo,
              demoCount
            )
          : demoCount > 0
            ? warn(
                `demographics.${countryId}.stateDemographics`,
                countryId,
                "stateDemographics.count",
                expectedDemo,
                demoCount,
                "count ≠ era region count"
              )
            : critical(
                `demographics.${countryId}.stateDemographics`,
                countryId,
                "stateDemographics.count",
                expectedDemo,
                demoCount
              )
      );
    }

    const defaultsCount = await db.collection("demographicDefaults").countDocuments({ countryId });
    checks.push(
      defaultsCount > 0
        ? ok(
            `demographics.${countryId}.defaults`,
            countryId,
            "demographicDefaults.count",
            ">0",
            defaultsCount
          )
        : warn(
            `demographics.${countryId}.defaults`,
            countryId,
            "demographicDefaults.count",
            ">0",
            defaultsCount
          )
    );
    const turnoutCount = await db
      .collection("stateDemographicTurnout")
      .countDocuments({ countryId });
    checks.push(
      turnoutCount > 0
        ? ok(
            `demographics.${countryId}.turnout`,
            countryId,
            "stateDemographicTurnout.count",
            ">0",
            turnoutCount
          )
        : warn(
            `demographics.${countryId}.turnout`,
            countryId,
            "stateDemographicTurnout.count",
            ">0",
            turnoutCount
          )
    );
  }
  return checks;
}

async function checkRuntimeCleanliness(db: Db): Promise<SeedDiagnosticCheck[]> {
  const checks: SeedDiagnosticCheck[] = [];
  const runtime = new Set(getRuntimeCollectionNames());
  const owned = new Set(["seedDiagnostics", "seedDiagnosticBaselines", "gameState"]);

  for (const name of EMPTY_AT_TURN1) {
    if (!runtime.has(name) || owned.has(name)) continue;
    try {
      const count = await db.collection(name).countDocuments({});
      checks.push(
        count === 0
          ? ok(`runtime.${name}`, "global", `${name}.count`, 0, count)
          : warn(
              `runtime.${name}`,
              "global",
              `${name}.count`,
              0,
              count,
              "append-only/history collection not empty at turn 1"
            )
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      checks.push(
        warn(`runtime.${name}`, "global", `${name}.count`, 0, null, `query failed: ${message}`)
      );
    }
  }
  return checks;
}

async function checkConfig(db: Db): Promise<SeedDiagnosticCheck[]> {
  const checks: SeedDiagnosticCheck[] = [];
  const config = await db.collection("gameConfig").findOne({ _id: "default" as never });
  checks.push(
    config
      ? ok("config.gameConfig", "global", "gameConfig", "present", "present")
      : critical("config.gameConfig", "global", "gameConfig", "present", null)
  );

  // Maintenance mode should be "full" mid-reset (Phase 4 runs after
  // enableMaintenanceMode, which always writes "full"). Normalize first so a
  // legacy boolean `true` doc (pre-tri-state) still reads as sealed.
  const maintMode = normalizeMaintenanceMode(
    config?.maintenanceMode as boolean | "off" | "partial" | "full" | undefined
  );
  const maintSealed = maintMode === "full";
  checks.push(
    maintSealed
      ? ok(
          "config.maintenanceMode",
          "global",
          "maintenanceMode",
          "full",
          "full",
          "sealed post-reset"
        )
      : warn(
          "config.maintenanceMode",
          "global",
          "maintenanceMode",
          "full",
          maintMode,
          "expected maintenance mode 'full' after reset"
        )
  );

  // commandEconomyEnabled is admin-gated; absent/false is fine for fresh seeds.
  const cmd = config?.commandEconomyEnabled === true;
  checks.push(
    ok(
      "config.commandEconomyEnabled",
      "global",
      "commandEconomyEnabled",
      "optional",
      cmd ? "true" : "false",
      cmd ? "enabled" : "disabled (default)"
    )
  );

  return checks;
}

/**
 * Run all Mode A conformance checks against the live DB for the active preset.
 */
export async function runConformanceChecks(
  db: Db,
  opts?: { preset?: string }
): Promise<{ checks: SeedDiagnosticCheck[]; expect: SeedExpectations }> {
  const gs = await db.collection("gameState").findOne({ _id: "current" as never });
  const preset =
    opts?.preset ?? (typeof gs?.preset === "string" ? gs.preset : null) ?? DEFAULT_SEED_PRESET;
  const expect = buildSeedExpectations(preset);

  // Every group below is READ-ONLY (no write of any kind in this module), and
  // none reads another's output, so they overlap instead of queueing 12 round
  // trips end to end. This was the run's largest single phase gap.
  //
  // ⚠️ `Promise.all` preserves INPUT order in its result, and the groups are
  // flattened in that order, so the emitted check sequence is byte-identical to
  // the sequential version. That matters beyond tidiness: `formatDiagnosticSummary`
  // names only the first five criticals, so a reordering would silently change
  // which failures a reader is told about.
  const groups = await Promise.all([
    checkGameStateClock(db, expect),
    Promise.resolve(checkBundleFallbacks(expect)),
    checkNationalBudgets(db, expect),
    checkStaleCostFractions(db, preset),
    checkMonetary(db, expect),
    checkForex(db, expect),
    checkSectors(db, expect),
    checkRegions(db, expect),
    checkPolitical(db, expect),
    checkPartyRosters(db, expect),
    checkDemographics(db, expect),
    checkRuntimeCleanliness(db),
    checkConfig(db),
    checkRegionDerivedCoverage(db, expect),
  ]);
  const checks: SeedDiagnosticCheck[] = groups.flat();

  return { checks, expect };
}
