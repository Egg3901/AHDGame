import { describe, it, expect } from "vitest";
import { resolveDebateSession, type DebateResolveInput } from "../resolveDebateSession";

const rngMid = () => 0.5;
const emptyRecord = { officesHeld: 0, billsPassed: 0 };

describe("resolveDebateSession", () => {
  it("AI-fills a non-submitted side from its stats", () => {
    const challenger: DebateResolveInput = {
      stats: { debate: 5, charisma: 5, statecraft: 5 },
      record: emptyRecord,
      strategies: ["aboveFray"],
    };
    const opponent: DebateResolveInput = {
      stats: { debate: 10, charisma: 1, statecraft: 1 },
      record: emptyRecord,
      strategies: null, // not submitted → AI picks
    };
    const r = resolveDebateSession(challenger, opponent, rngMid);
    expect(r.opponentStrategies.length).toBeGreaterThanOrEqual(1);
    // A debate-10 AI should favor the Attack archetype.
    expect(r.opponentStrategies).toContain("attack");
  });

  it("gives the winner a positive delta and the loser the negation", () => {
    const strong: DebateResolveInput = {
      stats: { debate: 10 },
      record: emptyRecord,
      strategies: ["attack"],
    };
    const weak: DebateResolveInput = {
      stats: { charisma: 1 },
      record: emptyRecord,
      strategies: ["aboveFray"],
    };
    const r = resolveDebateSession(strong, weak, rngMid);
    expect(r.outcome.result).toBe("challenger");
    expect(r.deltas.challenger).toBeGreaterThan(0);
    expect(r.deltas.opponent).toBe(-r.deltas.challenger);
  });

  it("applies zero deltas on a draw", () => {
    const side: DebateResolveInput = {
      stats: { charisma: 5 },
      record: emptyRecord,
      strategies: ["aboveFray"],
    };
    const r = resolveDebateSession(side, { ...side }, rngMid);
    expect(r.outcome.result).toBe("draw");
    expect(r.deltas).toEqual({ challenger: 0, opponent: 0 });
  });

  it("caps a submitted side to its single lead strategy", () => {
    const side: DebateResolveInput = {
      stats: { debate: 5, charisma: 5, statecraft: 5 },
      record: emptyRecord,
      strategies: ["attack", "aboveFray", "tout"],
    };
    const r = resolveDebateSession(side, { ...side }, rngMid);
    expect(r.challengerStrategies).toEqual(["attack"]);
  });
});
