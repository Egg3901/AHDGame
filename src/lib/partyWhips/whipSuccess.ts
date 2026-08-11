import type { NPP } from "@/lib/db/types";
import { statMultiplier } from "@/lib/stats/statMultiplier";
import { NEUTRAL_STAT } from "@/lib/stats/statsConstants";

export type NppWhipMode = "soft" | "hard";

/**
 * Convert a whipping character's Statecraft stat into additive whip-success
 * percentage points. Maps the gentle ±20% efficacy band onto roughly ±9 points
 * (comparable in scale to the soft/hard mode bonus). Neutral stat → 0 points.
 */
export function statecraftWhipBonus(statecraft: number | undefined): number {
  return Math.round((statMultiplier(statecraft ?? NEUTRAL_STAT) - 1) * 50);
}

export interface NppWhipSuccessCalculation {
  baseChance: number;
  loyaltyBonus: number;
  stubbornnessPenalty: number;
  modeBonus: number;
  finalChance: number;
}

export interface NppWhipSuccessResult {
  success: boolean;
  roll: number;
  calculation: NppWhipSuccessCalculation;
}

const WHIP_SUCCESS_BASE_CHANCE = 55;
const WHIP_LOYALTY_WEIGHT = 0.35;
const WHIP_STUBBORNNESS_WEIGHT = 0.18;
const WHIP_MODE_BONUS: Record<NppWhipMode, number> = {
  soft: 6,
  hard: 15,
};
const WHIP_MIN_SUCCESS_CHANCE = 40;
const WHIP_MAX_SUCCESS_CHANCE = 95;

/**
 * Hidden NPP whip willingness roll.
 *
 * Whips are meant to be a strong party-discipline tool, so this curve is
 * intentionally generous: average same-party NPPs should usually comply, while
 * loyalty still matters and stubbornness still creates a real chance to balk.
 * Soft whips remain meaningfully weaker than hard whips without becoming flavor-only.
 */
export function calculateNppWhipSuccessChance(
  npp: Pick<NPP, "personality">,
  mode: NppWhipMode = "hard",
  statecraftBonus = 0
): NppWhipSuccessCalculation {
  const loyaltyBonus = Math.round((npp.personality?.loyalty ?? 50) * WHIP_LOYALTY_WEIGHT);
  const stubbornnessPenalty = Math.round(
    (npp.personality?.stubbornness ?? 50) * WHIP_STUBBORNNESS_WEIGHT
  );
  const modeBonus = WHIP_MODE_BONUS[mode];

  const finalChance = Math.max(
    WHIP_MIN_SUCCESS_CHANCE,
    Math.min(
      WHIP_MAX_SUCCESS_CHANCE,
      Math.round(
        WHIP_SUCCESS_BASE_CHANCE + loyaltyBonus - stubbornnessPenalty + modeBonus + statecraftBonus
      )
    )
  );

  return {
    baseChance: WHIP_SUCCESS_BASE_CHANCE,
    loyaltyBonus,
    stubbornnessPenalty,
    modeBonus,
    finalChance,
  };
}

export function rollNppWhipSuccess(): number {
  return Math.floor(Math.random() * 100) + 1;
}

export function resolveNppWhipSuccess(
  npp: Pick<NPP, "personality">,
  mode: NppWhipMode = "hard",
  statecraftBonus = 0
): NppWhipSuccessResult {
  const calculation = calculateNppWhipSuccessChance(npp, mode, statecraftBonus);
  const roll = rollNppWhipSuccess();
  return {
    success: roll <= calculation.finalChance,
    roll,
    calculation,
  };
}
