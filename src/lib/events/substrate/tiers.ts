import type { OutcomeTier } from "@/lib/db/types/events";

export function pickTier(outcomeTable: OutcomeTier[], roll: number): OutcomeTier {
  const tier = outcomeTable.find((t) => roll >= t.minRoll && roll <= t.maxRoll);
  if (!tier) {
    throw new Error(`pickTier: roll ${roll} not covered by outcome table`);
  }
  return tier;
}

/** Ensures tiers cover 1–100 without gaps or overlaps per option. */
export function validateOutcomeTable(outcomeTable: OutcomeTier[]): void {
  if (outcomeTable.length === 0) {
    throw new Error("validateOutcomeTable: empty outcome table");
  }

  const sorted = [...outcomeTable].sort((a, b) => a.minRoll - b.minRoll);
  let expectedStart = 1;

  for (const tier of sorted) {
    if (tier.minRoll > tier.maxRoll) {
      throw new Error(`validateOutcomeTable: tier "${tier.label}" has minRoll > maxRoll`);
    }
    if (tier.minRoll !== expectedStart) {
      throw new Error(
        `validateOutcomeTable: gap or overlap before roll ${expectedStart} (found ${tier.minRoll})`
      );
    }
    if (tier.maxRoll > 100) {
      throw new Error("validateOutcomeTable: maxRoll cannot exceed 100");
    }
    expectedStart = tier.maxRoll + 1;
  }

  if (expectedStart !== 101) {
    throw new Error(`validateOutcomeTable: table ends at ${expectedStart - 1}, expected 100`);
  }
}
