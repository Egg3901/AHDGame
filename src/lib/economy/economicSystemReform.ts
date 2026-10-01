/**
 * Enactment of the `economic_system_reform` bill provision.
 *
 * Writes the legislated target onto the national budget; the command-economy
 * turn phase does the actual moving (see `economicReformPull`). Under a
 * one-party regime the law also lands on the ruling party: reform toward the
 * market costs the leader confidence with the party's orthodox wing and buys
 * popular legitimacy, and a return to the plan does the reverse.
 */
import type { Db } from "mongodb";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { scheduledMarketizationLevel } from "@/lib/constants/commandEconomy";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { getCountryState } from "@/lib/countryState";
import { getHeadOfGovernmentCharacterId } from "@/lib/api/headOfGovernment";
import { adjustLeaderConfidence } from "@/lib/turn/rulingPartyConfidence";
import { adjustPopularLegitimacy } from "@/lib/turn/popularLegitimacy";
import { createSystemNewsPost } from "@/lib/news";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { GameState } from "@/lib/db/types/gameState";
import type { EconomicSystemReformProvision } from "@/lib/db/types/legislation";
import {
  ECONOMIC_SYSTEM_TARGET_LABEL,
  ECONOMIC_SYSTEM_TARGET_LEVEL,
  canLegislateEconomicSystem,
} from "./economicSystemReformRules";

/** Leader-confidence and popular-legitimacy deltas, by direction and size. */
export const REFORM_REGIME_EFFECTS = {
  /** Toward the market, per full 100-point move. Scaled by the distance moved. */
  liberalize: { leaderConfidence: -20, popularLegitimacy: 12 },
  /** Back toward the plan, per full 100-point move. */
  replan: { leaderConfidence: 10, popularLegitimacy: -12 },
} as const;

/**
 * Regime deltas for a reform moving the dial from `fromLevel` to `toLevel`.
 * Scaled by the distance so a half step costs half; never less than a quarter
 * of the full effect, because passing the law is itself the political act.
 */
export function reformRegimeEffects(
  fromLevel: number,
  toLevel: number
): { leaderConfidence: number; popularLegitimacy: number } {
  const delta = toLevel - fromLevel;
  if (!Number.isFinite(delta) || Math.abs(delta) < 1) {
    return { leaderConfidence: 0, popularLegitimacy: 0 };
  }
  const base = delta > 0 ? REFORM_REGIME_EFFECTS.liberalize : REFORM_REGIME_EFFECTS.replan;
  const scale = Math.max(0.25, Math.min(1, Math.abs(delta) / 100));
  return {
    leaderConfidence: Math.round(base.leaderConfidence * scale),
    popularLegitimacy: Math.round(base.popularLegitimacy * scale),
  };
}

export async function applyEconomicSystemReformProvision(
  db: Db,
  provision: EconomicSystemReformProvision,
  countryId: CountryId,
  currentTurn: number,
  billId?: string
): Promise<void> {
  const countryName = getCountryConfig(countryId)?.name ?? countryId;
  const label = ECONOMIC_SYSTEM_TARGET_LABEL[provision.target];

  // Validation refuses these at proposal; a bill that predates a world change
  // still must not write a target onto a market country.
  if (!canLegislateEconomicSystem(countryId)) {
    await createSystemNewsPost(
      `${countryName} enacted an economic system law, but it has no planned economy to reform.`,
      "legislation"
    ).catch(() => {});
    return;
  }

  const budgetId = getNationalBudgetId(countryId);
  const budget = await db
    .collection<FederalBudget>("federalBudget")
    .findOne({ _id: budgetId }, { projection: { economicFactors: 1 } });
  const gameState = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { currentYear: 1 } });
  const persisted = budget?.economicFactors?.marketizationLevel;
  const fromLevel =
    typeof persisted === "number" && Number.isFinite(persisted)
      ? persisted
      : scheduledMarketizationLevel(countryId, gameState?.currentYear ?? null);
  const targetLevel = ECONOMIC_SYSTEM_TARGET_LEVEL[provision.target];

  await db.collection<FederalBudget>("federalBudget").updateOne(
    { _id: budgetId },
    {
      $set: {
        "economicFactors.marketizationLevel": fromLevel,
        "economicFactors.economicReform": {
          target: provision.target,
          targetLevel,
          enactedTurn: currentTurn,
          reachedAtTurn: null,
          ...(billId ? { billId } : {}),
        },
      },
    }
  );

  const runtime = await getCountryState(db, countryId);
  if (runtime.hasLeaderConfidenceModel) {
    const leaderId = await getHeadOfGovernmentCharacterId(db, countryId);
    const effects = reformRegimeEffects(fromLevel, targetLevel);
    if (leaderId && effects.leaderConfidence !== 0) {
      const reason = `Enacted economic reform: ${label}`;
      await adjustLeaderConfidence(
        db,
        countryId,
        leaderId,
        effects.leaderConfidence,
        reason,
        currentTurn
      );
      await adjustPopularLegitimacy(
        db,
        countryId,
        leaderId,
        effects.popularLegitimacy,
        reason,
        currentTurn
      );
    }
  }

  const direction =
    targetLevel > fromLevel
      ? "The plan will be wound back over the coming months."
      : targetLevel < fromLevel
        ? "The state will take the economy back under the plan over the coming months."
        : "The economy already runs on these lines.";
  await createSystemNewsPost(
    `${countryName} legislates a new economic system: ${label}. ${direction}`,
    "legislation",
    {
      title: `${countryName} adopts ${label.toLowerCase()}`,
    }
  ).catch(() => {});
}
