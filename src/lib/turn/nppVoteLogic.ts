/**
 * Pure NPP voting calculations - no DB access, no side effects.
 * Random parameter allows deterministic testing.
 */

import type { NPP, Bill } from "@/lib/db/types";

export type VoteResult = "for" | "against" | "abstain";

export interface WhipDirective {
  direction: "for" | "against";
}

/**
 * Calculate base ideology vote without whip influence.
 */
export function calculateBaseVote(
  npp: NPP,
  bill: Bill,
  random: () => number = Math.random
): VoteResult {
  const loyalty = (npp.personality?.loyalty ?? 50) / 100;
  /*
   * Abstain chance scales inversely with loyalty. A perfectly loyal NPP (1.0) still
   * has a 5% floor to model unavoidable absences (travel, illness, indecision).
   * A fully disloyal NPP (0.0) has a 25% abstain rate — engaged enough to show up,
   * but unlikely to commit. Range: [0.05, 0.25].
   */
  const abstainChance = Math.max(0.05, (1 - loyalty) * 0.25);

  const r = random();
  if (r < abstainChance) return "abstain";

  let supportChance = 0.5;

  // Policy-aware: bias by alignment with bill's legislation type
  if (bill.legislationTypeId && bill.effectDirection != null && bill.effectDirection !== 0) {
    const domainPos = npp.policies?.domainPositions?.[bill.legislationTypeId];
    if (domainPos != null && typeof domainPos === "number") {
      /*
       * domainPos is -5 to +5. Dividing by 5 normalises to [-1, 1].
       * effectDirection (+1 or -1) flips the alignment for bills that move a
       * metric in the opposite direction from the NPP's preference.
       * The 0.35 weight caps the swing at ±35 percentage points from the 50%
       * baseline — enough to produce consistent ideological patterns without
       * making votes fully deterministic. Clamped to [0.1, 0.9] so there is
       * always at least a 10% chance of a cross-ideological vote.
       */
      const alignment = (domainPos / 5) * (bill.effectDirection > 0 ? 1 : -1);
      supportChance = Math.max(0.1, Math.min(0.9, supportChance + alignment * 0.35));
    }
  }

  // Normalize random after abstain check
  const normalizedR = (r - abstainChance) / (1 - abstainChance);
  return normalizedR < supportChance ? "for" : "against";
}

/**
 * Calculate NPP vote with optional whip influence.
 * Whip compliance based on loyalty (higher = more compliant) and stubbornness (lower = more compliant).
 */
export function calculateWhippedVote(
  npp: NPP,
  bill: Bill,
  whip: WhipDirective | null,
  random: () => number = Math.random
): VoteResult {
  if (!whip) {
    return calculateBaseVote(npp, bill, random);
  }

  const loyalty = (npp.personality?.loyalty ?? 50) / 100;
  const stubbornness = (npp.personality?.stubbornness ?? 50) / 100;

  /*
   * Compliance formula weights loyalty more heavily than stubbornness (70/30).
   * Loyalty reflects party allegiance as the primary driver of whip compliance —
   * a loyal NPP follows the party line even when they personally disagree.
   * Stubbornness acts as a secondary resistance factor — a stubborn NPP may defy
   * even their own instincts. The 70/30 split keeps ideology (loyalty) dominant
   * while still giving personality (stubbornness) meaningful influence.
   *
   * Range at extreme personalities:
   *   Max loyal, min stubborn (1.0, 0.0): 0.7 + 0.3 = 1.0 (always complies)
   *   Min loyal, max stubborn (0.0, 1.0): 0.0 + 0.0 = 0.0 (never complies)
   *   Default (0.5, 0.5):                 0.35 + 0.15 = 0.5 (coin flip)
   */
  const complianceChance = loyalty * 0.7 + (1 - stubbornness) * 0.3;

  const r = random();
  if (r < complianceChance) {
    return whip.direction;
  }

  // Did not comply - use base ideology vote
  return calculateBaseVote(npp, bill, random);
}

/**
 * Calculate compliance chance for display purposes.
 */
export function calculateComplianceChance(npp: NPP): number {
  const loyalty = (npp.personality?.loyalty ?? 50) / 100;
  const stubbornness = (npp.personality?.stubbornness ?? 50) / 100;
  return loyalty * 0.7 + (1 - stubbornness) * 0.3;
}
