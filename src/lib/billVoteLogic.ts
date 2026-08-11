/**
 * Pure bill voting calculations — no DB access, no side effects.
 *
 * Extracted from billLifecycle.ts so that NPP voting logic can be
 * unit-tested without a real database. The `random` parameter defaults
 * to Math.random but can be overridden in tests for deterministic behavior.
 */

import type { NPP, Bill } from "@/lib/db/types";

/**
 * Determine an NPP's vote based on ideology alignment with the bill sponsor/category.
 * When the bill has legislationTypeId and effectDirection, NPPs with domainPositions
 * for that type are biased by alignment: domainPosition * effectDirection > 0 → more
 * likely to support; < 0 → more likely to oppose.
 *
 * @param npp - The NPC politician to vote
 * @param bill - The bill being voted on
 * @param random - Random number source (0–1). Defaults to Math.random for production;
 *   inject a seeded value in tests for deterministic assertions.
 * @returns "for", "against", or "abstain"
 */
export function ideologyVote(
  npp: NPP,
  bill: Bill,
  random: () => number = Math.random
): "for" | "against" | "abstain" {
  const loyalty = (npp.personality?.loyalty ?? 50) / 100; // 0–1
  const ambition = (npp.personality?.ambition ?? 50) / 100;

  // Abstain probability: lower loyalty = higher abstain chance
  const abstainChance = Math.max(0.05, Math.min(0.25, (1 - loyalty) * 0.3 - ambition * 0.05));

  const r = random();
  if (r < abstainChance) return "abstain";

  let supportChance = 0.55 + loyalty * 0.1; // 55–65% base

  // Policy-aware: if bill has a legislation type and effect direction, and NPP has a domain
  // position, bias by alignment.
  if (bill.legislationTypeId && bill.effectDirection != null && bill.effectDirection !== 0) {
    const domainPos = npp.policies?.domainPositions?.[bill.legislationTypeId];
    if (domainPos != null && typeof domainPos === "number") {
      // Alignment: NPP position (−5 to +5) * effectDirection (−1, +1).
      // Positive = NPP favors this direction → more support.
      const alignment = (domainPos / 5) * (bill.effectDirection > 0 ? 1 : -1); // −1 to +1
      supportChance = Math.max(0.2, Math.min(0.9, supportChance + alignment * 0.25));
    }
  }

  return (r - abstainChance) / (1 - abstainChance) < supportChance ? "for" : "against";
}
