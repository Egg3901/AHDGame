/**
 * Fundraise card parity (Game1724): the UI card advertises the same AP cost
 * and stat-scaled yield the shared rules quote credits, so the two cannot
 * drift (the label previously re-stated the raw $50K + $2K/level base,
 * dropping both the influence multiplier and the fundraising-stat scaling).
 */
import { describe, it, expect } from "vitest";
import type { Character } from "@/lib/db/types";
import { CARDS } from "./actionsConstants";
import { formatFundsCompact } from "@/lib/utils/formatters";
import {
  FUNDRAISE_ACTION_COST,
  fundraiseYieldAnchor,
  quoteFundraiseAction,
} from "@/lib/actions/rules";

function cardCharacter(donorBaseLevel: number, fundraising?: number): Character {
  return {
    donorBaseLevel,
    politicalInfluence: 40,
    ...(fundraising === undefined ? { stats: undefined } : { stats: { fundraising } }),
  } as Character;
}

describe("fundraise card parity", () => {
  it("advertises the quoted AP cost and the shared yield", () => {
    const card = CARDS.find((c) => c.type === "fundraise");
    expect(card).toBeDefined();
    if (!card) return;
    expect(card.actionCost).toBe(FUNDRAISE_ACTION_COST);
    const quote = quoteFundraiseAction({ donorBaseLevel: 10 });
    expect(quote.ok).toBe(true);
    if (!quote.ok) return;
    expect(card.actionCost).toBe(quote.apCost);
    // Level 10 at 40% influence, neutral stat: (50K + 20K) x 1.4 = 98K.
    const neutral = cardCharacter(10);
    expect(card.fundLabel(neutral)).toBe(`+${formatFundsCompact(98_000)}`);
    expect(card.fundLabel(neutral)).toBe(`+${formatFundsCompact(fundraiseYieldAnchor(neutral))}`);
    // Allocated stats flow through to the label (the old raw copy dropped them).
    const strong = cardCharacter(10, 10);
    expect(card.fundLabel(strong)).toBe(`+${formatFundsCompact(fundraiseYieldAnchor(strong))}`);
    expect(card.fundLabel(strong)).not.toBe(`+${formatFundsCompact(98_000)}`);
  });
});
