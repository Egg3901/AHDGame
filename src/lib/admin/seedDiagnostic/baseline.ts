/**
 * Seed diagnostic baseline snapshot (PR 2).
 *
 * Captures a flat dotted-key map of seeded macro values into
 * `seedDiagnosticBaselines` singleton `{_id:'current'}`. Keys match Mode B
 * drift check ids so comparisons are 1:1.
 */

import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { getBankId } from "@/lib/centralBank/helpers";
import { getRateDoc, rateFromDoc } from "@/lib/world/forex";
import type { ExchangeRate } from "@/lib/db/types";
import { buildSeedExpectations, expectedPrimeRate, type SeedExpectations } from "./expectations";
import { calendarTurnFromGameState } from "./types";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

export const BASELINE_COLLECTION = "seedDiagnosticBaselines";
export const BASELINE_ID = "current" as const;

export interface SeedDiagnosticBaseline {
  _id: typeof BASELINE_ID;
  preset: string;
  capturedAt: Date;
  turn: number;
  calendarTurn: number;
  metrics: Record<string, number>;
}

export interface CaptureSeedBaselineOptions {
  /** Injected clock for tests. */
  now?: Date;
  /** Override preset (otherwise read from gameState). */
  preset?: string;
}

function setMetric(metrics: Record<string, number>, id: string, value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return;
  metrics[id] = value;
}

/**
 * Sum sector output for a country: unowned sector revenue + corporation revenue.
 * At fresh seed most output sits in unowned; after play it migrates to corps.
 */
export async function sumSectorAggregate(db: Db, countryId: string): Promise<number> {
  const unowned = await db
    .collection<{ revenue?: number }>("unownedSectors")
    .find({ countryId })
    .project({ revenue: 1 })
    .toArray();
  const corps = await db
    .collection<{ revenue?: number }>("corporations")
    .find({ countryId })
    .project({ revenue: 1 })
    .toArray();
  let total = 0;
  for (const row of unowned) total += Number(row.revenue) || 0;
  for (const row of corps) total += Number(row.revenue) || 0;
  return total;
}

/**
 * Mean globalPrice/basePrice across commodityPrices docs. Returns null when
 * no usable rows exist.
 */
export async function commodityPriceIndex(db: Db): Promise<number | null> {
  const rows = await db
    .collection<{ globalPrice?: number; basePrice?: number }>("commodityPrices")
    .find({})
    .project({ globalPrice: 1, basePrice: 1 })
    .toArray();
  let sum = 0;
  let n = 0;
  for (const row of rows) {
    const base = Number(row.basePrice);
    const price = Number(row.globalPrice);
    if (!(base > 0) || !Number.isFinite(price)) continue;
    sum += price / base;
    n++;
  }
  return n > 0 ? sum / n : null;
}

/**
 * Build the flat metrics map from live DB collections for the active preset.
 * Shared by capture and (via reconstruction) missing-baseline fallback.
 */
export async function collectLiveMetrics(
  db: Db,
  expect: SeedExpectations
): Promise<Record<string, number>> {
  const metrics: Record<string, number> = {};
  const countries = expect.seededCountryIds;

  const budgets = await db
    .collection<{
      countryId?: string;
      gdp?: number;
      population?: number;
      treasuryBalance?: number;
      debt?: { principal?: number; interestRate?: number };
    }>("federalBudget")
    .find({})
    .toArray();
  const budgetByCountry = new Map(budgets.map((b) => [String(b.countryId ?? b), b] as const));

  for (const countryId of countries) {
    const doc = budgetByCountry.get(countryId);
    if (!doc) continue;
    setMetric(metrics, `budget.${countryId}.gdp`, doc.gdp);
    setMetric(metrics, `budget.${countryId}.population`, doc.population);
    setMetric(metrics, `budget.${countryId}.debt.principal`, doc.debt?.principal);
    setMetric(metrics, `budget.${countryId}.debt.interestRate`, doc.debt?.interestRate);
    setMetric(metrics, `budget.${countryId}.treasuryBalance`, doc.treasuryBalance);
  }

  const banks = await db
    .collection<{
      _id: string;
      countryId?: CountryId;
      primeRate?: number;
      inflationHistory?: Array<{ rate?: number }>;
    }>("centralBanks")
    .find({})
    .toArray();
  const bankById = new Map(banks.map((b) => [String(b._id), b]));

  for (const countryId of expect.forexActiveCountries) {
    const bank = bankById.get(getBankId(countryId));
    if (!bank) continue;
    setMetric(metrics, `centralBank.${countryId}.primeRate`, bank.primeRate);
    const hist = Array.isArray(bank.inflationHistory) ? bank.inflationHistory : [];
    const tail = hist.length > 0 ? hist[hist.length - 1] : null;
    if (tail && typeof tail.rate === "number") {
      setMetric(metrics, `centralBank.${countryId}.inflation`, tail.rate);
    }
  }

  const rates = await db.collection<ExchangeRate>("exchangeRates").find({}).toArray();
  const rateMap = new Map(rates.map((r) => [r.countryId, r]));

  for (const countryId of expect.forexActiveCountries) {
    const doc = getRateDoc(rateMap, countryId);
    if (!doc) continue;
    setMetric(metrics, `forex.${countryId}.rate`, rateFromDoc(doc));
  }

  for (const countryId of countries) {
    const agg = await sumSectorAggregate(db, countryId);
    if (agg > 0) setMetric(metrics, `sectors.${countryId}.aggregate`, agg);
  }

  const cpi = await commodityPriceIndex(db);
  if (cpi != null) setMetric(metrics, "commodity.globalPriceIndex", cpi);

  return metrics;
}

/**
 * Reconstruct a baseline metrics map from seed-file expectations when no
 * `seedDiagnosticBaselines` doc exists (worlds reset before this feature).
 * Sector aggregates and commodity index are omitted (not in seed tables).
 */
export function reconstructMetricsFromExpectations(
  expect: SeedExpectations
): Record<string, number> {
  const metrics: Record<string, number> = {};

  for (const cfg of expect.nationalBudgets) {
    setMetric(metrics, `budget.${cfg.countryId}.gdp`, cfg.gdp);
    setMetric(metrics, `budget.${cfg.countryId}.population`, cfg.population);
    setMetric(metrics, `budget.${cfg.countryId}.debt.principal`, cfg.debtPrincipal);
    setMetric(metrics, `budget.${cfg.countryId}.debt.interestRate`, cfg.debtInterestRate);
    // Seed configs set treasuryBalance = −debt.principal at creation.
    setMetric(metrics, `budget.${cfg.countryId}.treasuryBalance`, -cfg.debtPrincipal);
  }

  for (const countryId of expect.forexActiveCountries) {
    const rate = expect.forexRates[countryId];
    if (rate != null) setMetric(metrics, `forex.${countryId}.rate`, rate);
    setMetric(metrics, `centralBank.${countryId}.primeRate`, expectedPrimeRate(countryId));
    const budget = expect.nationalBudgets.find((b) => b.countryId === countryId);
    if (budget) {
      setMetric(metrics, `centralBank.${countryId}.inflation`, budget.inflationRate);
    }
  }

  return metrics;
}

/**
 * Load the singleton baseline, or null if missing.
 */
export async function loadSeedBaseline(db: Db): Promise<SeedDiagnosticBaseline | null> {
  const doc = await db
    .collection<SeedDiagnosticBaseline>(BASELINE_COLLECTION)
    .findOne({ _id: BASELINE_ID });
  if (!doc || typeof doc.metrics !== "object" || doc.metrics == null) return null;
  return doc;
}

/**
 * Capture a baseline snapshot of seeded macro values. Upserts the singleton
 * `{_id:'current'}`. Safe to call after a clean conformance run (Phase 4b).
 */
export async function captureSeedBaseline(
  db: Db,
  opts?: CaptureSeedBaselineOptions
): Promise<SeedDiagnosticBaseline> {
  const now = opts?.now ?? new Date();
  const gs = await db
    .collection<{
      preset?: string;
      currentTurn?: number;
      preIterationTurns?: number;
    }>("gameState")
    .findOne({ _id: "current" as never });

  const preset =
    opts?.preset ?? (typeof gs?.preset === "string" ? gs.preset : null) ?? DEFAULT_SEED_PRESET;
  const turn = typeof gs?.currentTurn === "number" ? gs.currentTurn : 1;
  const calendarTurn = calendarTurnFromGameState(gs);
  const expect = buildSeedExpectations(preset);
  const metrics = await collectLiveMetrics(db, expect);

  const baseline: SeedDiagnosticBaseline = {
    _id: BASELINE_ID,
    preset,
    capturedAt: now,
    turn,
    calendarTurn,
    metrics,
  };

  await db
    .collection<SeedDiagnosticBaseline>(BASELINE_COLLECTION)
    .replaceOne({ _id: BASELINE_ID }, baseline, { upsert: true });

  return baseline;
}
