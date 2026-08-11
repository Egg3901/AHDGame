/**
 * CAREER/ECONOMIC PROPENSITIES MODULE (V3)
 *
 * This module derives career and economic behavior modifiers from the same governing
 * archetype used in `governingArchetype.ts`. The archetype classification is reused
 * (not redefined) to ensure consistency between political/governing style and economic
 * decision-making. Loyalty remains reserved for party behavior and is not used here.
 *
 * The modifiers represent multipliers on a base of 1.0 (unless otherwise noted) and
 * are clamped to safe bands to prevent extreme values from breaking game balance.
 */

import type { NPPPersonality } from "@/lib/db/types/npp";
import { deriveGoverningArchetype, type GoverningArchetype } from "../governingArchetype";

/**
 * Modifiers that shape an NPC's career and economic behavior.
 * All values are multipliers on a base of 1.0 unless otherwise noted.
 */
export interface CareerArchetypeModifiers {
  /** How hard they campaign/advertise to build influence & favorability. */
  campaignAggressionMult: number;
  /** Propensity to fundraise + build donor base (war-chest building). */
  fundraiseAppetiteMult: number;
  /** Ambition to enter/run for higher offices. */
  officeSeekingMult: number;
  /** Propensity to sponsor bills when seated. */
  legislativeActivityMult: number;
  /** Share of surplus funds moved into savings/bonds/stocks rather than held idle (0..1-ish scale, base ~0.4). */
  saveInvestAppetiteMult: number;
  /** Tilt toward higher-risk investments (stocks/sector funds) vs safe (savings/sovereign bonds). */
  riskToleranceMult: number;
}

/**
 * Predefined modifier sets for each governing archetype.
 * Values are modest and within the safe bands defined by CAREER_ARCHETYPE_CLAMP.
 */
export const CAREER_ARCHETYPE_MODIFIERS: Record<GoverningArchetype, CareerArchetypeModifiers> = {
  reformer: {
    campaignAggressionMult: 1.3,
    fundraiseAppetiteMult: 1.1,
    officeSeekingMult: 1.4,
    legislativeActivityMult: 1.3,
    saveInvestAppetiteMult: 0.3,
    riskToleranceMult: 1.3,
  },
  ideologue: {
    campaignAggressionMult: 1.2,
    fundraiseAppetiteMult: 1.0,
    officeSeekingMult: 1.3,
    legislativeActivityMult: 1.4,
    saveInvestAppetiteMult: 0.4,
    riskToleranceMult: 1.0,
  },
  technocrat: {
    campaignAggressionMult: 0.9,
    fundraiseAppetiteMult: 1.4,
    officeSeekingMult: 1.0,
    legislativeActivityMult: 1.1,
    saveInvestAppetiteMult: 0.7,
    riskToleranceMult: 1.2,
  },
  steward: {
    campaignAggressionMult: 0.7,
    fundraiseAppetiteMult: 0.8,
    officeSeekingMult: 0.6,
    legislativeActivityMult: 0.7,
    saveInvestAppetiteMult: 0.8,
    riskToleranceMult: 0.6,
  },
};

/**
 * Safe clamping bands for each modifier field.
 * - campaignAggressionMult, fundraiseAppetiteMult, officeSeekingMult, legislativeActivityMult: [0.6, 1.5]
 * - saveInvestAppetiteMult: [0.2, 0.8]
 * - riskToleranceMult: [0.5, 1.4]
 */
export const CAREER_ARCHETYPE_CLAMP: Record<keyof CareerArchetypeModifiers, [number, number]> = {
  campaignAggressionMult: [0.6, 1.5],
  fundraiseAppetiteMult: [0.6, 1.5],
  officeSeekingMult: [0.6, 1.5],
  legislativeActivityMult: [0.6, 1.5],
  saveInvestAppetiteMult: [0.2, 0.8],
  riskToleranceMult: [0.5, 1.4],
};

/**
 * Clamps each field of a CareerArchetypeModifiers object into its safe band.
 * Pure and total.
 */
export function clampCareerModifiers(m: CareerArchetypeModifiers): CareerArchetypeModifiers {
  return {
    campaignAggressionMult: Math.min(
      Math.max(m.campaignAggressionMult, CAREER_ARCHETYPE_CLAMP.campaignAggressionMult[0]),
      CAREER_ARCHETYPE_CLAMP.campaignAggressionMult[1]
    ),
    fundraiseAppetiteMult: Math.min(
      Math.max(m.fundraiseAppetiteMult, CAREER_ARCHETYPE_CLAMP.fundraiseAppetiteMult[0]),
      CAREER_ARCHETYPE_CLAMP.fundraiseAppetiteMult[1]
    ),
    officeSeekingMult: Math.min(
      Math.max(m.officeSeekingMult, CAREER_ARCHETYPE_CLAMP.officeSeekingMult[0]),
      CAREER_ARCHETYPE_CLAMP.officeSeekingMult[1]
    ),
    legislativeActivityMult: Math.min(
      Math.max(m.legislativeActivityMult, CAREER_ARCHETYPE_CLAMP.legislativeActivityMult[0]),
      CAREER_ARCHETYPE_CLAMP.legislativeActivityMult[1]
    ),
    saveInvestAppetiteMult: Math.min(
      Math.max(m.saveInvestAppetiteMult, CAREER_ARCHETYPE_CLAMP.saveInvestAppetiteMult[0]),
      CAREER_ARCHETYPE_CLAMP.saveInvestAppetiteMult[1]
    ),
    riskToleranceMult: Math.min(
      Math.max(m.riskToleranceMult, CAREER_ARCHETYPE_CLAMP.riskToleranceMult[0]),
      CAREER_ARCHETYPE_CLAMP.riskToleranceMult[1]
    ),
  };
}

/**
 * Convenience function: derives the governing archetype from a personality,
 * looks up the corresponding career modifiers, clamps them, and returns the result.
 * Pure and total.
 */
export function careerArchetypeModifiers(personality: NPPPersonality): CareerArchetypeModifiers {
  const archetype = deriveGoverningArchetype(personality);
  const raw = CAREER_ARCHETYPE_MODIFIERS[archetype];
  return clampCareerModifiers(raw);
}

const MODIFIER_FIELDS: (keyof CareerArchetypeModifiers)[] = [
  "campaignAggressionMult",
  "fundraiseAppetiteMult",
  "officeSeekingMult",
  "legislativeActivityMult",
  "saveInvestAppetiteMult",
  "riskToleranceMult",
];

/**
 * Continuous variant of `careerArchetypeModifiers`.
 *
 * The bucketed version classifies on a hard midpoint-50 2×2, which means an NPP
 * with ambition 51 and one with ambition 99 are *the same politician* as far as
 * every downstream system is concerned — the single largest reason NPP behaviour
 * reads as templated. This blends the same four corner rows of
 * `CAREER_ARCHETYPE_MODIFIERS` bilinearly over (ambition, stubbornness), so the
 * personality sliders that already exist on every NPP finally produce a
 * continuum instead of four clusters.
 *
 * At the corners (0/100 on both axes) it returns the table values exactly, so
 * the archetype tuning that was hand-balanced stays meaningful; everything in
 * between interpolates. Output goes through the same `clampCareerModifiers`
 * bands, so nothing here can exceed limits the bucketed version respected.
 *
 * The bucketed function is deliberately kept and still exported — call sites
 * migrate individually, because some of them (sponsorship cooldowns) feed
 * throttles whose balance was tuned against the discrete values.
 */
export function careerArchetypeModifiersContinuous(
  personality: NPPPersonality
): CareerArchetypeModifiers {
  const a = Math.min(Math.max(personality.ambition, 0), 100) / 100;
  const s = Math.min(Math.max(personality.stubbornness, 0), 100) / 100;

  // Same axis semantics as deriveGoverningArchetype: high ambition + low
  // stubbornness = reformer, high + high = ideologue, low + low = technocrat,
  // low + high = steward.
  const weights: [GoverningArchetype, number][] = [
    ["reformer", a * (1 - s)],
    ["ideologue", a * s],
    ["technocrat", (1 - a) * (1 - s)],
    ["steward", (1 - a) * s],
  ];

  const blended = {} as CareerArchetypeModifiers;
  for (const field of MODIFIER_FIELDS) {
    let sum = 0;
    for (const [archetype, weight] of weights) {
      sum += CAREER_ARCHETYPE_MODIFIERS[archetype][field] * weight;
    }
    blended[field] = sum;
  }

  return clampCareerModifiers(blended);
}
