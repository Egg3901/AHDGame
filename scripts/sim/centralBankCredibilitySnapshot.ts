/**
 * Sandbox credibility evidence for #2319 records each completed world's
 * observed CPI, policy rate and scrutiny. End-of-turn rates may already reflect
 * the next autonomous policy choice; these rows are not decision-input logs.
 */
import type { Db } from "mongodb";
import type { CentralBank } from "@/lib/db/types/centralBank";
import type { GameState } from "@/lib/db/types/gameState";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { getNationalDocId } from "@/lib/constants/nationalScope";

type BankObservation = Pick<
  CentralBank,
  "_id" | "countryId" | "primeRate" | "chairInfamy" | "resolveStreak" | "monetaryAuthorityId"
>;
interface BudgetObservation {
  _id: string;
  economicFactors?: { inflationRate?: number };
}
interface GrowthObservation {
  _id: string;
  economic?: { gdpGrowth?: { value?: number } };
}

export interface CentralBankCredibilityPoint {
  _id: string;
  schemaVersion: 1;
  runId: string;
  seed: string;
  codeVersion: string;
  sourceClass: "sandbox";
  observation: "completed-turn-state";
  observedAt: string;
  turn: number;
  year: number;
  bankId: string;
  countryId: CountryId;
  monetaryAuthorityId: string | null;
  endPrimeRatePct: number | null;
  scrutiny: number | null;
  resolveStreak: number | null;
  countryInflationPct: number | null;
  nationalGdpGrowthPct: number | null;
}

const observedNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export function assertCredibilityPhasesCompleted(
  log: { phaseStatuses?: Record<string, { status: string }> } | null
): void {
  for (const phase of ["inflationRecalc", "centralBankChairTurn"]) {
    if (log?.phaseStatuses?.[phase]?.status !== "completed") {
      throw new Error(`Central-bank credibility evidence requires completed ${phase}`);
    }
  }
}

export async function captureCentralBankCredibilityTurn(
  db: Db,
  input: { runId: string; seed: string; codeVersion: string; turn: number }
): Promise<string[]> {
  if (!/^ahd_sim_[a-zA-Z0-9_-]+$/.test(db.databaseName)) {
    throw new Error("Central-bank credibility evidence is sandbox-only");
  }
  if (
    !/^[0-9a-f]{40}$/.test(input.codeVersion) ||
    !input.runId ||
    !input.seed ||
    !Number.isInteger(input.turn) ||
    input.turn < 0
  ) {
    throw new Error("Central-bank credibility evidence requires a pinned source, run and turn");
  }
  const game = await db
    .collection<Pick<GameState, "_id" | "currentTurn" | "currentYear">>("gameState")
    .findOne({ _id: "current" }, { projection: { currentTurn: 1, currentYear: 1 } });
  if (game?.currentTurn !== input.turn || !Number.isFinite(game.currentYear)) {
    throw new Error(`Central-bank credibility turn mismatch at ${input.turn}`);
  }
  const banks = await db
    .collection<BankObservation>("centralBanks")
    .find(
      {},
      {
        projection: {
          _id: 1,
          countryId: 1,
          primeRate: 1,
          chairInfamy: 1,
          resolveStreak: 1,
          monetaryAuthorityId: 1,
        },
      }
    )
    .toArray();
  const knownBanks = banks.filter((bank) => Object.hasOwn(COUNTRY_CONFIGS, bank.countryId));
  if (knownBanks.length === 0) {
    throw new Error("Central-bank credibility evidence has no observed banks");
  }
  const budgetIds = [...new Set(knownBanks.map((bank) => getNationalBudgetId(bank.countryId)))];
  const metricIds = knownBanks.flatMap((bank) => {
    const id = getNationalDocId(bank.countryId);
    return id ? [id] : [];
  });
  const [budgets, metrics] = await Promise.all([
    db
      .collection<BudgetObservation>("federalBudget")
      .find(
        { _id: { $in: budgetIds } },
        { projection: { _id: 1, "economicFactors.inflationRate": 1 } }
      )
      .toArray(),
    db
      .collection<GrowthObservation>("macroMetrics")
      .find({ _id: { $in: metricIds } }, { projection: { _id: 1, "economic.gdpGrowth.value": 1 } })
      .toArray(),
  ]);
  const budgetsById = new Map(budgets.map((budget) => [String(budget._id), budget]));
  const metricsById = new Map(metrics.map((metric) => [String(metric._id), metric]));
  const observedAt = new Date().toISOString();
  const points: CentralBankCredibilityPoint[] = knownBanks.map((bank) => {
    const budget = budgetsById.get(getNationalBudgetId(bank.countryId));
    const metricId = getNationalDocId(bank.countryId);
    const metric = metricId ? metricsById.get(metricId) : undefined;
    return {
      _id: `${input.runId}:${input.turn}:${bank._id}`,
      schemaVersion: 1,
      ...input,
      sourceClass: "sandbox",
      observation: "completed-turn-state",
      observedAt,
      year: game.currentYear,
      bankId: bank._id,
      countryId: bank.countryId,
      monetaryAuthorityId: bank.monetaryAuthorityId ?? null,
      endPrimeRatePct: observedNumber(bank.primeRate),
      scrutiny: observedNumber(bank.chairInfamy),
      resolveStreak: observedNumber(bank.resolveStreak),
      countryInflationPct: observedNumber(budget?.economicFactors?.inflationRate),
      nationalGdpGrowthPct: observedNumber(metric?.economic?.gdpGrowth?.value),
    };
  });
  await db.collection<CentralBankCredibilityPoint>("simCentralBankCredibility").bulkWrite(
    points.map((point) => ({
      updateOne: { filter: { _id: point._id }, update: { $setOnInsert: point }, upsert: true },
    })),
    { ordered: false }
  );
  return points.map((point) => point.bankId);
}
