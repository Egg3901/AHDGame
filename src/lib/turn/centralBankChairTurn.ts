/**
 * Central Bank Chair Turn Processing
 *
 * Each turn:
 * 1. Compute chair infamy from inflation & GDP growth
 *    - High inflation → infamy up, low inflation → infamy down
 *    - Low growth → infamy up, high growth → infamy down
 *    - Natural 5% decay per turn (same as character infamy)
 *    - Positive effects (infamy reduction) are dampened at higher scrutiny:
 *      multiplier = max(0.1, 1 - chairInfamy/150)
 *    - Clamped to 0-100
 *
 * 2. Apply chair bonuses with infamy penalty
 *    - Base: +0.5 national influence per turn
 *    - If chairInfamy > 25: halve to +0.25 NPI, debit 1.5 actions
 *      (actionRefresh grants chairActionBonus = 3; net becomes 1.5)
 *
 * Runs after inflation recalc so inflation/GDP values are current.
 */

import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { CentralBank } from "@/lib/db/types/centralBank";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { GameState } from "@/lib/db/types/gameState";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import type { StateMetrics } from "@/lib/db/types/stateMetrics";
import type { Character } from "@/lib/db/types";
import { getNationalDocId } from "@/lib/constants/nationalScope";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { getInflationTarget } from "@/lib/budget/inflation";
import { processNppChairAutoRate } from "@/lib/nppAutonomy/nppChairAutoRate";

/** Fallback target inflation rate — deviations drive infamy */
const TARGET_INFLATION = 2.0;
/** Target GDP growth — deviations drive infamy */
const TARGET_GROWTH = 2.0;
/** How much each 1% deviation from targets moves infamy per turn */
const INFAMY_COEFFICIENT = 0.5;
/** Natural decay rate per turn (5%, same as character infamy) */
const INFAMY_DECAY = 0.95;
/** Infamy threshold above which chair bonuses are halved */
const INFAMY_PENALTY_THRESHOLD = 25;
/**
 * Controls how much high scrutiny dampens positive effects (infamy reduction).
 * Multiplier = max(0.1, 1 - chairInfamy / POSITIVE_DAMPENING_SCALE)
 * At 0 infamy: 1.0x (full effect). At 75: 0.5x. At 150+: 0.1x floor.
 */
const POSITIVE_DAMPENING_SCALE = 150;

/** Base NPI bonus for chairs per turn */
const CHAIR_NPI_BONUS = 0.5;
/** Action debit when infamy penalty is active (3 base - 1.5 = 1.5 net) */
const INFAMY_ACTION_DEBIT = 1.5;
const HIGH_SCRUTINY_DIAGNOSTIC_THRESHOLD = 90;
const MAX_SCRUTINY_DIAGNOSTICS = 5;

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Compute the per-turn scrutiny delta (before decay).
 * Exported so the client can mirror this calculation for display.
 */
export function computeScrutinyDelta(
  inflationRate: number,
  gdpGrowth: number,
  currentInfamy: number,
  targetInflation = TARGET_INFLATION
): number {
  const inflationDelta = (inflationRate - targetInflation) * INFAMY_COEFFICIENT;
  const growthDelta = (TARGET_GROWTH - gdpGrowth) * INFAMY_COEFFICIENT;
  let totalDelta = inflationDelta + growthDelta;

  // Dampen positive effects (negative delta = infamy reduction) at high scrutiny
  if (totalDelta < 0) {
    const dampener = Math.max(0.1, 1 - currentInfamy / POSITIVE_DAMPENING_SCALE);
    totalDelta *= dampener;
  }

  return totalDelta;
}

export interface CentralBankChairTurnResult {
  banksProcessed: number;
  chairsPenalized: number;
  bankWritesMatched: number;
  bankWritesModified: number;
  highScrutinyDiagnostics: Array<{
    bankId: string;
    countryId: CountryId;
    previousInfamy: number;
    newInfamy: number;
    inflationRate: number;
    targetInflation: number;
    gdpGrowth: number;
    scrutinyDelta: number;
  }>;
}

export async function processCentralBankChairTurn(
  db: Db,
  currentTurn: number
): Promise<CentralBankChairTurnResult> {
  const banks = await db
    .collection<CentralBank>("centralBanks")
    .find({})
    .project<
      Pick<
        CentralBank,
        | "_id"
        | "countryId"
        | "chairInfamy"
        | "chairCharacterId"
        | "chairMode"
        | "primeRate"
        | "lastRateChangeTurn"
        | "fomcBoard"
      >
    >({
      _id: 1,
      countryId: 1,
      chairInfamy: 1,
      chairCharacterId: 1,
      chairMode: 1,
      primeRate: 1,
      lastRateChangeTurn: 1,
      fomcBoard: 1,
    })
    .toArray();
  if (banks.length === 0) {
    return {
      banksProcessed: 0,
      chairsPenalized: 0,
      bankWritesMatched: 0,
      bankWritesModified: 0,
      highScrutinyDiagnostics: [],
    };
  }

  // Pre-collect budget IDs and national doc IDs for batching
  const budgetIdSet = new Set<string>();
  const nationalDocIdSet = new Set<string>();

  for (const bank of banks) {
    const countryId = bank.countryId as CountryId;
    const config = COUNTRY_CONFIGS[countryId];
    if (!config) continue;
    const budgetId = getNationalBudgetId(countryId);
    budgetIdSet.add(budgetId);
    const nationalDocId = getNationalDocId(countryId);
    if (nationalDocId) nationalDocIdSet.add(nationalDocId);
  }

  // Batch-fetch budgets and metrics
  const budgets =
    budgetIdSet.size > 0
      ? await db
          .collection<FederalBudget>("federalBudget")
          .find(
            { _id: { $in: Array.from(budgetIdSet) } },
            { projection: { "economicFactors.inflationRate": 1 } }
          )
          .toArray()
      : [];
  const budgetById = new Map(budgets.map((b) => [b._id.toString(), b]));

  const nationalMetricsDocs =
    nationalDocIdSet.size > 0
      ? await db
          .collection<StateMetrics>("macroMetrics")
          .find(
            { _id: { $in: Array.from(nationalDocIdSet) } },
            { projection: { "economic.gdpGrowth.value": 1 } }
          )
          .toArray()
      : [];
  const metricsById = new Map(nationalMetricsDocs.map((m) => [m._id.toString(), m]));

  // World era: chair scrutiny and the NPP auto-rate rule must judge inflation
  // against the era-authored target, not the modern/1979 constants. Keyed on
  // the CURRENT in-game year so the target graduates as the world advances;
  // absent → modern anchors (fail-safe).
  const gameState = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { currentYear: 1 } });
  const currentYear = gameState?.currentYear;
  const chairGameConfig = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { commandEconomyEnabled: 1 } });
  const commandEconomyEnabled = chairGameConfig?.commandEconomyEnabled === true;

  let chairsPenalized = 0;
  let bankWritesMatched = 0;
  let bankWritesModified = 0;
  const highScrutinyDiagnostics: CentralBankChairTurnResult["highScrutinyDiagnostics"] = [];
  const bankBulkOps: Array<{
    updateOne: {
      filter: { _id: string };
      update: { $set: { chairInfamy: number; updatedAt: Date } };
    };
  }> = [];
  const charBulkOps: Array<{
    updateOne: {
      filter: { _id: ObjectId };
      update: { $inc: Record<string, number> };
    };
  }> = [];

  for (const bank of banks) {
    const countryId = bank.countryId as CountryId;
    const config = COUNTRY_CONFIGS[countryId];
    if (!config) continue;

    const budgetId = getNationalBudgetId(countryId);
    const budget = budgetById.get(budgetId);
    const targetInflation = getInflationTarget(countryId, currentYear);
    const inflationRate = finiteOr(budget?.economicFactors?.inflationRate, targetInflation);

    const nationalDocId = getNationalDocId(countryId);
    const nationalMetricsDoc = nationalDocId ? metricsById.get(nationalDocId) : null;
    const gdpGrowth = finiteOr(nationalMetricsDoc?.economic?.gdpGrowth?.value, TARGET_GROWTH);

    const currentInfamy = Math.min(100, Math.max(0, finiteOr(bank.chairInfamy, 0)));

    const totalDelta = computeScrutinyDelta(
      inflationRate,
      gdpGrowth,
      currentInfamy,
      targetInflation
    );

    const decayedInfamy = currentInfamy * INFAMY_DECAY;
    const newInfamy = Math.min(100, Math.max(0, decayedInfamy + totalDelta));

    if (
      currentInfamy >= HIGH_SCRUTINY_DIAGNOSTIC_THRESHOLD &&
      highScrutinyDiagnostics.length < MAX_SCRUTINY_DIAGNOSTICS
    ) {
      highScrutinyDiagnostics.push({
        bankId: String(bank._id),
        countryId,
        previousInfamy: currentInfamy,
        newInfamy,
        inflationRate,
        targetInflation,
        gdpGrowth,
        scrutinyDelta: totalDelta,
      });
    }

    bankBulkOps.push({
      updateOne: {
        filter: { _id: bank._id },
        update: { $set: { chairInfamy: newInfamy, updatedAt: new Date() } },
      },
    });

    // NPP technocrat chairs: run the autonomous rate setter and skip the
    // character-side NPI bonus / action debit path (there is no character to
    // credit or penalize). chairInfamy is still decayed/written above for
    // display transparency.
    if (bank.chairMode === "npp") {
      // When a bank has an FOMC committee, the committee (processFomcMeetings)
      // owns the rate. Skip the single-chair autonomous setter to avoid two
      // systems moving primeRate on the same turn.
      if (bank.fomcBoard && bank.fomcBoard.length > 0) continue;
      await processNppChairAutoRate(
        db,
        bank,
        countryId,
        currentTurn,
        currentYear,
        commandEconomyEnabled
      );
      continue;
    }

    if (!bank.chairCharacterId) continue;

    const isPenalized = newInfamy > INFAMY_PENALTY_THRESHOLD;
    if (isPenalized) chairsPenalized++;

    const npiBonus = isPenalized ? CHAIR_NPI_BONUS / 2 : CHAIR_NPI_BONUS;

    const incFields: Record<string, number> = {
      nationalInfluence: npiBonus,
    };

    if (isPenalized) {
      incFields.actions = -INFAMY_ACTION_DEBIT;
    }

    charBulkOps.push({
      updateOne: {
        filter: { _id: new ObjectId(bank.chairCharacterId) },
        update: { $inc: incFields },
      },
    });
  }

  if (bankBulkOps.length > 0) {
    const bankWriteResult = await db
      .collection<CentralBank>("centralBanks")
      .bulkWrite(bankBulkOps as never);
    bankWritesMatched = bankWriteResult.matchedCount ?? 0;
    bankWritesModified = bankWriteResult.modifiedCount ?? 0;
  }
  if (charBulkOps.length > 0) {
    await db.collection<Character>("characters").bulkWrite(charBulkOps as never);
  }

  return {
    banksProcessed: banks.length,
    chairsPenalized,
    bankWritesMatched,
    bankWritesModified,
    highScrutinyDiagnostics,
  };
}
