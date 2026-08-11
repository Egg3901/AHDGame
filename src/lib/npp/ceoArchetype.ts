// src/lib/turn/ceoArchetype.ts
/**
 * CEO Corporate Archetypes
 *
 * NPP CEOs already carry an `NPPPersonality` ({ loyalty, ambition, stubbornness }).
 * Rather than introduce a parallel personality system, we *derive* a corporate
 * behavior archetype from those existing sliders and translate it into concrete,
 * formula-driven modifiers that bias the autonomous corp-management logic in
 * `nppCorporationBehavior.ts`.
 *
 * Two axes drive the classification (loyalty stays reserved for its existing
 * political role — party donations / influence):
 *   - ambition     → growth appetite / risk tolerance
 *   - stubbornness → cost discipline / resistance to change
 *
 *            low stubbornness        high stubbornness
 *   high ambition   aggressive            innovator
 *   low  ambition   cautious              costCutter
 *
 * All modifiers are multipliers/deltas applied to the existing base constants,
 * then clamped to safe bounds by the caller so no archetype can drive a
 * profitable corp into the ground (see SAFE_* clamps consumed in the behavior
 * module).
 */

import type { NPPPersonality } from "@/lib/db/types/npp";

export type CeoArchetype = "aggressive" | "cautious" | "innovator" | "costCutter";

/** Slider midpoint; at/above is "high", below is "low". */
const TRAIT_MIDPOINT = 50;

/**
 * Deterministically classify an NPP's corporate archetype from its personality
 * sliders. Pure and total — every personality maps to exactly one archetype, so
 * NPPs predating any explicit archetype field still get sensible behavior.
 */
export function deriveCeoArchetype(personality: NPPPersonality): CeoArchetype {
  const highAmbition = personality.ambition >= TRAIT_MIDPOINT;
  const highStubbornness = personality.stubbornness >= TRAIT_MIDPOINT;

  if (highAmbition && !highStubbornness) return "aggressive";
  if (highAmbition && highStubbornness) return "innovator";
  if (!highAmbition && highStubbornness) return "costCutter";
  return "cautious";
}

export interface CeoArchetypeModifiers {
  /** Added to each per-sector target-growth step (e.g. aggressive grows harder). */
  growthDelta: number;
  /** Multiplies the revenue-share marketing budget. */
  marketingMult: number;
  /** Multiplies the revenue-share R&D budget. */
  rdMult: number;
  /** Multiplies the computed dividend rate. */
  dividendMult: number;
  /** Multiplies the base cash floor (caution hoards, aggression runs lean). */
  cashFloorMult: number;
  /** Multiplies the minimum corp margin required to expand. */
  expansionMinMarginMult: number;
  /** Multiplies the surplus cash required to expand. */
  expansionMinCashMult: number;
  /**
   * Margin (%) at or below which a non-core losing sector is divested. Impatient
   * archetypes divest at the first loss (0); patient ones tolerate shallow
   * losses and only shed deep losers (negative floor). There is no per-sector
   * loss-streak state to count turns, so patience is expressed as loss depth.
   */
  divestMarginFloor: number;
}

/**
 * Archetype → behavior modifiers. Hand-tuned but explicit: every lever is a
 * named multiplier so the effect is auditable and unit-testable.
 */
export const CEO_ARCHETYPE_MODIFIERS: Record<CeoArchetype, CeoArchetypeModifiers> = {
  // Chases growth: spends on marketing, grows sectors hard, expands eagerly on a
  // thinner cash buffer, pays out a little more. Light on R&D.
  aggressive: {
    growthDelta: 1,
    marketingMult: 1.4,
    rdMult: 0.8,
    dividendMult: 1.2,
    cashFloorMult: 0.6,
    expansionMinMarginMult: 0.7,
    expansionMinCashMult: 0.7,
    divestMarginFloor: 0,
  },
  // Conservative: hoards cash, expands only on strong margins with a fat buffer,
  // pays modest dividends, patient with temporary losers.
  cautious: {
    growthDelta: 0,
    marketingMult: 0.8,
    rdMult: 0.8,
    dividendMult: 0.8,
    cashFloorMult: 1.5,
    expansionMinMarginMult: 1.3,
    expansionMinCashMult: 1.5,
    divestMarginFloor: -10,
  },
  // Invests for the long term: heavy R&D, low dividends, tolerates short-term
  // losses to develop sectors.
  innovator: {
    growthDelta: 0,
    marketingMult: 0.9,
    rdMult: 2.0,
    dividendMult: 0.6,
    cashFloorMult: 1.0,
    expansionMinMarginMult: 1.0,
    expansionMinCashMult: 1.0,
    divestMarginFloor: -15,
  },
  // Squeezes margins: minimal marketing/R&D, sheds losers fast, returns cash to
  // shareholders rather than reinvesting.
  costCutter: {
    growthDelta: 0,
    marketingMult: 0.5,
    rdMult: 0.3,
    dividendMult: 1.3,
    cashFloorMult: 1.2,
    expansionMinMarginMult: 1.2,
    expansionMinCashMult: 1.1,
    divestMarginFloor: 0,
  },
};

export function ceoArchetypeModifiers(archetype: CeoArchetype): CeoArchetypeModifiers {
  return CEO_ARCHETYPE_MODIFIERS[archetype];
}
