/**
 * Pure rules for the `economic_system_reform` bill provision.
 *
 * A planned economy's marketization dial otherwise moves only by endogenous
 * drift, which a government can barely steer: the policy-stance term is worth at
 * most 0.12 points a turn and a chartered party line moves one step per 336
 * turns, so a reforming leadership in a command economy could not reach private
 * enterprise (COMMAND_CEILING) within an era. A reform law sets a legislated
 * target instead. The turn engine ramps the dial toward it at
 * {@link ECONOMIC_REFORM_RAMP_PER_TURN}, so every band transition (dual-track
 * machinery, currency un-pegging, hard budgets) still runs through the same code
 * paths a scheduled transition does. Once the target is reached the law becomes
 * the dial's resting point in place of the era schedule.
 *
 * Client-safe: no Mongo imports.
 */
import type { CountryId } from "@/lib/constants/countries";
import type { EconomicSystemTarget } from "@/lib/db/types/legislation";
import {
  COMMAND_CEILING,
  DUAL_TRACK_CEILING,
  MARKET_LEVEL,
  MARKETIZATION_SCHEDULE,
  marketizationGravity,
} from "@/lib/constants/commandEconomy";

export const ECONOMIC_SYSTEM_TARGETS: readonly EconomicSystemTarget[] = [
  "dual_track",
  "market",
  "command",
] as const;

/** Marketization level each legislated system settles at. */
export const ECONOMIC_SYSTEM_TARGET_LEVEL: Record<EconomicSystemTarget, number> = {
  // Inside the fully-command band, where the era schedules put the bloc.
  command: 10,
  // Mid dual-track: private enterprise is legal and the plan still carries most
  // output (plannedShare is roughly a half here).
  dual_track: 45,
  market: MARKET_LEVEL,
};

/**
 * Level points per turn the dial moves toward a legislated target. From the
 * command floor a reform law opens private enterprise (30) in 24 turns, reaches
 * the market band (70) in 56, and completes in 80.
 */
export const ECONOMIC_REFORM_RAMP_PER_TURN = 1.25;

/** Within this many points of the target the ramp counts as complete. */
export const ECONOMIC_REFORM_REACHED_EPSILON = 0.5;

export const ECONOMIC_SYSTEM_TARGET_LABEL: Record<EconomicSystemTarget, string> = {
  dual_track: "Reform socialism (plan and market)",
  market: "Market economy",
  command: "Central planning",
};

export const ECONOMIC_SYSTEM_TARGET_DESCRIPTION: Record<EconomicSystemTarget, string> = {
  dual_track:
    "Private enterprise becomes legal and prices are partly freed, while the plan still directs much of the economy.",
  market:
    "The plan is wound down: prices, credit and the currency move to the market and state enterprises face hard budgets.",
  command:
    "The state takes the economy back under the plan: administered prices, a pegged currency and no new private enterprise.",
};

/**
 * Only countries that begin the era as planned economies may legislate their
 * economic system. A market country has no plan machinery to return to, and a
 * law that turned one into a command economy would be the engine's least
 * tested path.
 */
export function canLegislateEconomicSystem(countryId: string | null | undefined): boolean {
  if (!countryId) return false;
  return MARKETIZATION_SCHEDULE[countryId as CountryId] != null;
}

/**
 * Ideological direction of a reform for legislators: +1 toward the market
 * (economic right), -1 toward the plan. Dual-track is a half step.
 */
export function economicSystemReformDirection(target: EconomicSystemTarget): number {
  if (target === "market") return 1;
  if (target === "dual_track") return 0.5;
  return -1;
}

export interface EconomicReformState {
  targetLevel: number;
  /** Set once the dial first reaches the target. */
  reachedAtTurn?: number | null;
}

/**
 * The per-turn pull a legislated reform exerts on the dial. While the ramp is
 * running the pull is the full ramp step (capped at the remaining gap). Once the
 * target has been reached the law acts like the era schedule did: a weak,
 * capped gravity toward the target, so endogenous drift can still nudge it.
 */
export function economicReformPull(
  level: number,
  reform: EconomicReformState
): { pull: number; reached: boolean } {
  const target = reform.targetLevel;
  if (!Number.isFinite(level) || !Number.isFinite(target)) return { pull: 0, reached: false };
  if (reform.reachedAtTurn != null) {
    return { pull: marketizationGravity(level, target), reached: true };
  }
  const gap = target - level;
  const pull = Math.max(
    -ECONOMIC_REFORM_RAMP_PER_TURN,
    Math.min(ECONOMIC_REFORM_RAMP_PER_TURN, gap)
  );
  return { pull, reached: Math.abs(gap - pull) < ECONOMIC_REFORM_REACHED_EPSILON };
}

/** Player-facing name of the band a level sits in. */
export function economicBandLabel(level: number): string {
  if (level < COMMAND_CEILING) return "command economy";
  if (level < DUAL_TRACK_CEILING) return "dual-track economy";
  return "market economy";
}
