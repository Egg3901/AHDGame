/**
 * Mode B — drift diagnostic.
 *
 * Compares live macro values against a baseline snapshot adjusted for expected
 * growth (trajectory), using the turn-scaled tolerance curve in tolerance.ts.
 */

import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { isCommandEconomy } from "@/lib/constants/commandEconomy";
import { getEraMonetaryBaseline, getEraTrendGdpGrowth } from "@/lib/constants/monetaryEra";
import { getStartingYearForPreset, TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { loadLatestReconciliation } from "@/lib/ledger/reconcile";
import { getRateDoc, rateFromDoc } from "@/lib/world/forex";
import type { ExchangeRate } from "@/lib/db/types";
import type { EraId } from "@/lib/seeds/presetSelector";
import {
  collectLiveMetrics,
  loadSeedBaseline,
  reconstructMetricsFromExpectations,
  type SeedDiagnosticBaseline,
} from "./baseline";
import { buildSeedExpectations, eraForPreset, type SeedExpectations } from "./expectations";
import {
  classifyDrift,
  compoundAnnual,
  yearsFromCalendarTurn,
  type MetricClass,
} from "./tolerance";
import type { SeedDiagnosticCheck, SeedDiagnosticSeverity } from "./types";
import { calendarTurnFromGameState } from "./types";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

/** Default annual population growth percent when seed configs omit an explicit rate. */
export const DEFAULT_POP_GROWTH_PCT = 1;

/** Fallback structural real GDP growth percent when era table has no trendGdpGrowth. */
export const DEFAULT_GDP_GROWTH_PCT = 2.5;

/**
 * Per-era USD GDP-per-capita plausibility bands (nominal USD).
 * Wide enough for authored seeds across countries; tight enough to catch
 * whole-economy mis-scaling (×10–×100 forex/GDP errors). Drift mode only.
 */
export const USD_GDP_PER_CAPITA_BANDS: Record<EraId, { min: number; max: number }> = {
  "1953": { min: 20, max: 50_000 },
  "1979": { min: 100, max: 80_000 },
  "1991": { min: 100, max: 100_000 },
  "1999": { min: 150, max: 120_000 },
  "2007": { min: 200, max: 150_000 },
  "2019": { min: 200, max: 250_000 },
  "2023": { min: 200, max: 250_000 },
};

const RECONSTRUCTED_NOTE = "reconstructed baseline — seed files may have changed since reset";

export interface RunDriftChecksResult {
  checks: SeedDiagnosticCheck[];
  note?: string;
  baseline: SeedDiagnosticBaseline | null;
  reconstructed: boolean;
}

function check(
  id: string,
  scope: string,
  metric: string,
  expected: number | string | null,
  actual: number | string | null,
  severity: SeedDiagnosticSeverity,
  extra?: Partial<SeedDiagnosticCheck>
): SeedDiagnosticCheck {
  return { id, scope, metric, expected, actual, severity, ...extra };
}

function driftCheck(
  id: string,
  scope: string,
  metric: string,
  actual: number | null | undefined,
  expected: number,
  calendarTurn: number,
  cls: MetricClass,
  note?: string
): SeedDiagnosticCheck {
  if (actual == null || !Number.isFinite(actual)) {
    return check(id, scope, metric, expected, actual ?? null, "critical", {
      note: note ?? "missing actual",
    });
  }
  const result = classifyDrift({ actual, expected, calendarTurn, cls });
  return check(id, scope, metric, expected, actual, result.severity, {
    driftPct: result.driftPct,
    tolerancePct: result.tolerancePct,
    note: note ?? result.note,
  });
}

/**
 * Trajectory-adjust a baseline value for the given metric class / key.
 */
export function trajectoryExpected(opts: {
  baseline: number;
  metricId: string;
  calendarTurn: number;
  countryId: string | null;
  startingYear: number;
  currentYear: number;
}): number {
  const { baseline, metricId, calendarTurn, countryId, startingYear, currentYear } = opts;
  const years = yearsFromCalendarTurn(calendarTurn, TURNS_PER_YEAR);
  const yearForEra = currentYear || startingYear;

  if (metricId.includes(".population")) {
    return compoundAnnual(baseline, DEFAULT_POP_GROWTH_PCT, years);
  }

  if (metricId.includes(".gdp") && !metricId.includes("usdGdpPerCapita")) {
    const trendPct =
      (countryId ? getEraTrendGdpGrowth(countryId as CountryId, yearForEra) : undefined) ??
      DEFAULT_GDP_GROWTH_PCT;
    // getEraTrendGdpGrowth returns percent (e.g. 6.0); compoundAnnual takes percent.
    return compoundAnnual(baseline, trendPct, years);
  }

  // Nominal dollar stocks: debt principal, sector aggregates, commodity index.
  // treasuryBalance is intentionally excluded — sign-sanity only (see loop skip).
  if (
    metricId.includes("debt.principal") ||
    metricId.includes("sectors.") ||
    metricId.includes("commodity.")
  ) {
    const infl =
      (countryId
        ? getEraMonetaryBaseline(countryId as CountryId, yearForEra)?.targetInflation
        : undefined) ??
      getEraMonetaryBaseline("US", yearForEra)?.targetInflation ??
      2.0;
    return compoundAnnual(baseline, infl, years);
  }

  // Rates and forex: flat baseline (no compounding).
  return baseline;
}

/**
 * Classify live value vs trajectory-adjusted baseline for a metric id.
 */
export function classifyMetricDrift(opts: {
  metricId: string;
  baseline: number;
  actual: number;
  calendarTurn: number;
  countryId: string | null;
  startingYear: number;
  currentYear: number;
  commandExempt?: boolean;
}): SeedDiagnosticCheck {
  const {
    metricId,
    baseline,
    actual,
    calendarTurn,
    countryId,
    startingYear,
    currentYear,
    commandExempt,
  } = opts;

  const scope = countryId ?? "global";
  const metric = metricId.split(".").slice(-1)[0] ?? metricId;

  if (commandExempt) {
    return check(metricId, scope, metric, baseline, actual, "ok", {
      driftPct: 0,
      tolerancePct: 0,
      note: "command-economy exempt",
    });
  }

  const expected = trajectoryExpected({
    baseline,
    metricId,
    calendarTurn,
    countryId,
    startingYear,
    currentYear,
  });

  const cls = metricClassForId(metricId);
  return driftCheck(metricId, scope, metric, actual, expected, calendarTurn, cls);
}

export function metricClassForId(metricId: string): MetricClass {
  if (metricId.includes("population")) return "population";
  if (metricId.includes("forex")) return "forex";
  if (metricId.includes("primeRate") || metricId.includes("interestRate")) return "interest";
  if (metricId.includes("inflation")) return "inflation";
  if (metricId.includes("debt.principal")) return "debt";
  if (metricId.includes("commodity")) return "commodity";
  if (metricId.includes("sectors.")) return "sector";
  if (metricId.includes("gdp")) return "gdp";
  return "gdp";
}

function countryIdFromMetricId(metricId: string): string | null {
  // budget.US.gdp → US; forex.DE.rate → DE; centralBank.UK.primeRate → UK
  const parts = metricId.split(".");
  if (parts.length >= 3 && parts[1] && parts[1].length <= 3) return parts[1];
  return null;
}

/**
 * USD-normalized GDP per capita vs era plausibility band.
 * Uses live forex rate (trusted after conformance). Drift mode only.
 */
export function classifyUsdGdpPerCapita(opts: {
  countryId: string;
  gdpLocal: number;
  population: number;
  forexRate: number;
  era: EraId;
}): SeedDiagnosticCheck {
  const { countryId, gdpLocal, population, forexRate, era } = opts;
  const id = `budget.${countryId}.usdGdpPerCapita`;
  const band = USD_GDP_PER_CAPITA_BANDS[era] ?? USD_GDP_PER_CAPITA_BANDS["2019"];

  if (!(population > 0) || !(forexRate > 0) || !Number.isFinite(gdpLocal)) {
    return check(id, countryId, "usdGdpPerCapita", `${band.min}-${band.max}`, null, "critical", {
      note: "missing gdp/population/forex for USD conversion",
    });
  }

  const usdGdp = gdpLocal / forexRate;
  const perCapita = usdGdp / population;
  const inBand = perCapita >= band.min && perCapita <= band.max;

  if (inBand) {
    return check(id, countryId, "usdGdpPerCapita", `${band.min}-${band.max}`, perCapita, "ok", {
      note: `era ${era} USD GDP/capita band`,
    });
  }

  // Outside band: magnitude-style critical if ≥3× beyond edge, else warn.
  const overMax = perCapita > band.max ? perCapita / band.max : 0;
  const underMin = perCapita < band.min ? band.min / Math.max(perCapita, 1e-9) : 0;
  const ratio = Math.max(overMax, underMin);
  const severity: SeedDiagnosticSeverity = ratio >= 3 ? "critical" : "warn";
  return check(id, countryId, "usdGdpPerCapita", `${band.min}-${band.max}`, perCapita, severity, {
    driftPct: ratio > 0 ? ratio - 1 : 0,
    note: `outside era ${era} USD GDP/capita band (${band.min}-${band.max})`,
  });
}

async function checkClockDrift(
  db: Db,
  expect: SeedExpectations,
  calendarTurn: number
): Promise<SeedDiagnosticCheck[]> {
  const gs = await db
    .collection<{
      currentTurn?: number;
      currentYear?: number;
      startingYear?: number;
      preIteration?: { active?: boolean };
      preIterationTurns?: number;
    }>("gameState")
    .findOne({ _id: "current" as never });

  if (!gs) {
    return [
      check("gameState.exists", "global", "gameState", "present", null, "critical", {
        note: "missing gameState",
      }),
    ];
  }

  const startingYear = typeof gs.startingYear === "number" ? gs.startingYear : expect.startingYear;
  const currentYear = typeof gs.currentYear === "number" ? gs.currentYear : null;
  const preActive = gs.preIteration?.active === true;

  // While pre-iteration founding is active, currentYear is pinned to startingYear.
  if (preActive) {
    return [
      currentYear === startingYear
        ? check(
            "gameState.yearArithmetic",
            "global",
            "currentYear",
            startingYear,
            currentYear,
            "ok",
            { note: "pre-iteration: year pinned to startingYear" }
          )
        : check(
            "gameState.yearArithmetic",
            "global",
            "currentYear",
            startingYear,
            currentYear,
            "warn",
            { note: "pre-iteration active but currentYear ≠ startingYear" }
          ),
    ];
  }

  const expectedYear = startingYear + Math.floor((calendarTurn - 1) / TURNS_PER_YEAR);
  return [
    currentYear === expectedYear
      ? check("gameState.yearArithmetic", "global", "currentYear", expectedYear, currentYear, "ok")
      : check(
          "gameState.yearArithmetic",
          "global",
          "currentYear",
          expectedYear,
          currentYear,
          "critical",
          {
            note: `expected startingYear + floor((calendarTurn-1)/${TURNS_PER_YEAR})`,
          }
        ),
  ];
}

async function checkLedgerHealth(db: Db): Promise<SeedDiagnosticCheck[]> {
  try {
    const latest = await loadLatestReconciliation(db);
    if (!latest) {
      return [
        check("ledger.reconciliation", "global", "ledger", "present", null, "ok", {
          note: "no reconciliation yet",
        }),
      ];
    }
    const status = latest.status;
    const severity: SeedDiagnosticSeverity =
      status === "red" ? "critical" : status === "amber" ? "warn" : "ok";
    return [
      check("ledger.reconciliation", "global", "ledger", "green", status, severity, {
        note: `turn ${latest.turn}`,
      }),
    ];
  } catch (err) {
    return [
      check("ledger.reconciliation", "global", "ledger", "green", null, "warn", {
        note: err instanceof Error ? err.message : "load failed",
      }),
    ];
  }
}

async function checkTreasurySign(db: Db, expect: SeedExpectations): Promise<SeedDiagnosticCheck[]> {
  const checks: SeedDiagnosticCheck[] = [];
  const budgets = await db
    .collection<{
      countryId?: string;
      treasuryBalance?: number;
      debt?: { principal?: number };
    }>("federalBudget")
    .find({})
    .toArray();
  const byCountry = new Map(budgets.map((b) => [String(b.countryId), b]));

  for (const countryId of expect.seededCountryIds) {
    const doc = byCountry.get(countryId);
    const id = `budget.${countryId}.treasurySign`;
    if (!doc || typeof doc.treasuryBalance !== "number") {
      checks.push(
        check(id, countryId, "treasurySign", "finite", null, "warn", {
          note: "missing treasuryBalance",
        })
      );
      continue;
    }
    const bal = doc.treasuryBalance;
    const principal = doc.debt?.principal;
    // Sign sanity: if debt.principal > 0, treasury should be ≤ 0 (mirror).
    if (
      typeof principal === "number" &&
      principal > 0 &&
      bal > 0 &&
      Math.abs(bal) > 1 &&
      Math.abs(principal) > 1
    ) {
      checks.push(
        check(id, countryId, "treasurySign", "≤0 when debt>0", bal, "warn", {
          note: `treasuryBalance positive while debt.principal=${principal}`,
        })
      );
    } else {
      checks.push(check(id, countryId, "treasurySign", "coherent", bal, "ok"));
    }
  }
  return checks;
}

/**
 * Run all Mode B drift checks.
 */
export async function runDriftChecks(
  db: Db,
  opts?: { preset?: string; calendarTurn?: number }
): Promise<RunDriftChecksResult> {
  const gs = await db
    .collection<{
      preset?: string;
      currentTurn?: number;
      currentYear?: number;
      startingYear?: number;
      preIterationTurns?: number;
    }>("gameState")
    .findOne({ _id: "current" as never });

  const preset =
    opts?.preset ?? (typeof gs?.preset === "string" ? gs.preset : null) ?? DEFAULT_SEED_PRESET;
  const expect = buildSeedExpectations(preset);
  const calendarTurn = opts?.calendarTurn ?? calendarTurnFromGameState(gs);
  const startingYear =
    typeof gs?.startingYear === "number" ? gs.startingYear : getStartingYearForPreset(preset);
  const currentYear = typeof gs?.currentYear === "number" ? gs.currentYear : startingYear;
  const era = eraForPreset(preset);

  const stored = await loadSeedBaseline(db);
  let baselineMetrics: Record<string, number>;
  let reconstructed = false;
  let note: string | undefined;
  let baselineDoc: SeedDiagnosticBaseline | null = stored;

  if (stored?.metrics && Object.keys(stored.metrics).length > 0) {
    baselineMetrics = stored.metrics;
  } else {
    baselineMetrics = reconstructMetricsFromExpectations(expect);
    reconstructed = true;
    note = RECONSTRUCTED_NOTE;
    baselineDoc = {
      _id: "current",
      preset,
      capturedAt: new Date(0),
      turn: 1,
      calendarTurn: 1,
      metrics: baselineMetrics,
    };
  }

  const liveMetrics = await collectLiveMetrics(db, expect);

  const config = await db
    .collection<{ commandEconomyEnabled?: boolean }>("gameConfig")
    .findOne({ _id: "default" as never });
  const commandEnabled = config?.commandEconomyEnabled === true;

  const checks: SeedDiagnosticCheck[] = [];

  if (reconstructed) {
    checks.push(
      check("baseline.source", "global", "baseline", "captured", "reconstructed", "warn", {
        note: RECONSTRUCTED_NOTE,
      })
    );
  } else {
    checks.push(
      check("baseline.source", "global", "baseline", "captured", "snapshot", "ok", {
        note: `capturedAt turn ${stored?.turn ?? "?"}`,
      })
    );
  }

  checks.push(...(await checkClockDrift(db, expect, calendarTurn)));
  checks.push(...(await checkLedgerHealth(db)));
  checks.push(...(await checkTreasurySign(db, expect)));

  // Metric-by-metric drift against trajectory-adjusted baseline.
  // treasuryBalance is sign-sanity only (checkTreasurySign) — a running cash
  // balance that flips sign or moves >3× is normal and must not magnitude-break.
  const metricIds = new Set([...Object.keys(baselineMetrics), ...Object.keys(liveMetrics)]);
  for (const metricId of [...metricIds].sort()) {
    if (metricId.endsWith(".treasuryBalance")) continue;

    const baselineVal = baselineMetrics[metricId];
    const actualVal = liveMetrics[metricId];
    if (baselineVal == null || actualVal == null) continue;

    const countryId = countryIdFromMetricId(metricId);
    // Forex docs exist for FOREX_ACTIVE command countries (RU/DD). When the
    // command-economy flag is on, administered FX is class-exempt. The global
    // commodity.globalPriceIndex has no countryId, so it is not exempted here.
    const commandExempt =
      !!countryId &&
      metricId.startsWith("forex.") &&
      isCommandEconomy(countryId, currentYear, commandEnabled);

    checks.push(
      classifyMetricDrift({
        metricId,
        baseline: baselineVal,
        actual: actualVal,
        calendarTurn,
        countryId,
        startingYear,
        currentYear,
        commandExempt,
      })
    );
  }

  // USD GDP-per-capita band (after forex is trusted).
  const rates = await db.collection<ExchangeRate>("exchangeRates").find({}).toArray();
  const rateMap = new Map(rates.map((r) => [r.countryId, r]));
  const budgets = await db
    .collection<{ countryId?: string; gdp?: number; population?: number }>("federalBudget")
    .find({})
    .toArray();
  const budgetByCountry = new Map(budgets.map((b) => [String(b.countryId), b]));

  for (const countryId of expect.seededCountryIds) {
    const doc = budgetByCountry.get(countryId);
    if (!doc || doc.gdp == null || doc.population == null) continue;

    let forexRate = 1;
    if (countryId !== "US") {
      const rateDoc = getRateDoc(rateMap, countryId as CountryId);
      if (rateDoc) {
        forexRate = rateFromDoc(rateDoc);
      } else if (expect.forexRates[countryId as CountryId] != null) {
        forexRate = expect.forexRates[countryId as CountryId]!;
      } else {
        // No forex doc and not US — skip rather than invent a rate.
        continue;
      }
    }

    checks.push(
      classifyUsdGdpPerCapita({
        countryId,
        gdpLocal: doc.gdp,
        population: doc.population,
        forexRate,
        era,
      })
    );
  }

  return { checks, note, baseline: baselineDoc, reconstructed };
}
