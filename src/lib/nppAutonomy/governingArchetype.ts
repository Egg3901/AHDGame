// src/lib/nppAutonomy/governingArchetype.ts
/**
 * Governing Archetypes (V1)
 *
 * NPP officeholders already carry an `NPPPersonality` ({ loyalty, ambition,
 * stubbornness }). Rather than introduce a parallel governing-personality
 * system, we *derive* a governing archetype from those existing sliders and
 * translate it into concrete, formula-driven modifiers that bias the autonomous
 * governing logic (agenda breadth, how the three agenda inputs are weighted,
 * fiscal spend appetite, cabinet-reshuffle propensity).
 *
 * This deliberately mirrors `turn/ceoArchetype.ts`: same `derive → modifier
 * table → clamp` shape, so an NPP that runs a corp and an NPP that runs a
 * government behave from the same two personality axes.
 *
 * Two axes drive the classification (loyalty stays reserved for its existing
 * political role — party donations / influence):
 *   - ambition     → agenda breadth, spend appetite, reshuffle appetite
 *   - stubbornness → ideology-over-conditions weighting, agenda stability
 *
 *            low stubbornness        high stubbornness
 *   high ambition   reformer              ideologue
 *   low  ambition   technocrat            steward
 *
 * All modifiers are multipliers/deltas applied to base constants, then clamped
 * to safe bounds by the caller (see GOVERNING_ARCHETYPE_CLAMP) so no archetype
 * can drive a runaway agenda or a player-ungovernable fiscal stance.
 */

import type { NPPPersonality } from "@/lib/db/types/npp";

export type GoverningArchetype = "reformer" | "ideologue" | "technocrat" | "steward";

/** Slider midpoint; at/above is "high", below is "low". (Matches ceoArchetype.) */
const TRAIT_MIDPOINT = 50;

/**
 * Deterministically classify a governing archetype from personality sliders.
 * Pure and total — every personality maps to exactly one archetype, so NPPs
 * predating any explicit archetype field still get sensible governing behavior.
 */
export function deriveGoverningArchetype(personality: NPPPersonality): GoverningArchetype {
  const highAmbition = personality.ambition >= TRAIT_MIDPOINT;
  const highStubbornness = personality.stubbornness >= TRAIT_MIDPOINT;

  if (highAmbition && !highStubbornness) return "reformer";
  if (highAmbition && highStubbornness) return "ideologue";
  if (!highAmbition && highStubbornness) return "steward";
  return "technocrat";
}

export interface GoverningArchetypeModifiers {
  /**
   * Added to the base agenda breadth (max ranked items the government pursues at
   * once). Ambitious governments run broad agendas; stewards run narrow ones.
   */
  agendaBreadthDelta: number;
  /** Multiplies the weight on the ideology input when blending the agenda. */
  ideologyWeightMult: number;
  /** Multiplies the weight on the conditions (urgency) input. */
  conditionsWeightMult: number;
  /** Multiplies the weight on the electoral-mandate input. */
  mandateWeightMult: number;
  /**
   * Multiplies fiscal aggressiveness (how far the government pushes tax/spend
   * nudges toward its stance). Clamped downstream so it can never exceed a
   * player-survivable bound when V2 exposes it to player corps.
   */
  spendAppetiteMult: number;
  /**
   * Probability-ish bias (0..1 scale, applied multiplicatively to a base) that
   * the government reshuffles an underperforming minister in a given cycle.
   */
  reshufflePropensity: number;
}

/**
 * Per-archetype modifier table. Values are intentionally modest — the agenda
 * and downstream levers stay deterministic and bounded; archetype only colors
 * the emphasis, it does not unlock unbounded behavior.
 */
export const GOVERNING_ARCHETYPE_MODIFIERS: Record<
  GoverningArchetype,
  GoverningArchetypeModifiers
> = {
  // Broad, mandate-and-conditions driven, spends freely, reshuffles readily.
  reformer: {
    agendaBreadthDelta: +1,
    ideologyWeightMult: 0.85,
    conditionsWeightMult: 1.15,
    mandateWeightMult: 1.2,
    spendAppetiteMult: 1.25,
    reshufflePropensity: 0.6,
  },
  // Narrow but forceful, ideology over conditions, rarely reshuffles.
  ideologue: {
    agendaBreadthDelta: 0,
    ideologyWeightMult: 1.35,
    conditionsWeightMult: 0.85,
    mandateWeightMult: 1.0,
    spendAppetiteMult: 1.1,
    reshufflePropensity: 0.2,
  },
  // Pragmatic problem-solver: follows the conditions, moderate spend.
  technocrat: {
    agendaBreadthDelta: 0,
    ideologyWeightMult: 0.8,
    conditionsWeightMult: 1.3,
    mandateWeightMult: 0.9,
    spendAppetiteMult: 1.0,
    reshufflePropensity: 0.45,
  },
  // Status-quo caretaker: narrow agenda, frugal, stable cabinet.
  steward: {
    agendaBreadthDelta: -1,
    ideologyWeightMult: 1.0,
    conditionsWeightMult: 1.0,
    mandateWeightMult: 0.8,
    spendAppetiteMult: 0.8,
    reshufflePropensity: 0.25,
  },
};

/**
 * Safe bounds applied by callers after combining base constants with archetype
 * modifiers. Mirrors the SAFE_* clamp discipline in nppCorporationBehavior so
 * no archetype can produce a runaway agenda or an ungovernable fiscal posture.
 */
export const GOVERNING_ARCHETYPE_CLAMP = {
  /** Hard floor/ceiling on how many agenda items a government pursues at once. */
  minAgendaBreadth: 2,
  maxAgendaBreadth: 6,
  /** Spend-appetite multiplier is clamped to this band before use. */
  minSpendAppetiteMult: 0.7,
  maxSpendAppetiteMult: 1.4,
} as const;

/** Convenience: modifiers for a personality in one call. Pure and total. */
export function governingArchetypeModifiers(
  personality: NPPPersonality
): GoverningArchetypeModifiers {
  return GOVERNING_ARCHETYPE_MODIFIERS[deriveGoverningArchetype(personality)];
}

/** Clamp a spend-appetite multiplier into the safe band. */
export function clampSpendAppetite(mult: number): number {
  return Math.min(
    GOVERNING_ARCHETYPE_CLAMP.maxSpendAppetiteMult,
    Math.max(GOVERNING_ARCHETYPE_CLAMP.minSpendAppetiteMult, mult)
  );
}
