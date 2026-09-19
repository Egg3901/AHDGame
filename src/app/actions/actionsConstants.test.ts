/**
 * Debate Prep card parity (Game1724): the UI card advertises the same cost
 * and odds the shared rules quote gates execution on, so the two cannot
 * drift (the label previously advertised 10% while the roll resolved 15%).
 */
import { describe, it, expect } from "vitest";
import { CARDS } from "./actionsConstants";
import {
  DEBATE_PREP_ACTION_COST,
  describeDebatePrepEffect,
  quoteDebatePrepAction,
} from "@/lib/actions/rules";

describe("debate prep card parity", () => {
  it("advertises the quoted AP cost and the resolved odds", () => {
    const card = CARDS.find((c) => c.type === "debatePrep");
    expect(card).toBeDefined();
    if (!card) return;
    expect(card.actionCost).toBe(DEBATE_PREP_ACTION_COST);
    expect(card.effect).toBe(describeDebatePrepEffect());
    const quote = quoteDebatePrepAction({ debate: 5, hasStats: true });
    expect(quote.ok).toBe(true);
    if (!quote.ok) return;
    expect(card.actionCost).toBe(quote.apCost);
    expect(card.effect).toBe(`${Math.round(quote.successChance * 100)}% chance: +1 Debate`);
  });
});
