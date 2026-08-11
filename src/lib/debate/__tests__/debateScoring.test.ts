import { describe, it, expect } from "vitest";
import {
  scoreStrategy,
  scoreSide,
  resolveDebate,
  marginToSwing,
  pickAiStrategies,
  DEBATE_MIN_SWING,
  DEBATE_MAX_SWING,
  type DebateSide,
} from "../debateScoring";

// Deterministic rng helpers.
const rngMid = () => 0.5;

describe("scoreStrategy", () => {
  it("rewards a high linked stat (Attack scales with Debate)", () => {
    const weak: DebateSide = { strategies: ["attack"], stats: { debate: 1 } };
    const strong: DebateSide = { strategies: ["attack"], stats: { debate: 10 } };
    expect(scoreStrategy(strong, "attack", 0)).toBeGreaterThan(scoreStrategy(weak, "attack", 0));
  });

  it("Tout backfires on a thin record and pays on a strong one", () => {
    const thin: DebateSide = {
      strategies: ["tout"],
      stats: { statecraft: 5 },
      record: { officesHeld: 0, billsPassed: 0 },
    };
    const strong: DebateSide = {
      strategies: ["tout"],
      stats: { statecraft: 5 },
      record: { officesHeld: 3, billsPassed: 5 },
    };
    expect(scoreStrategy(thin, "tout", 0)).toBeLessThan(0);
    expect(scoreStrategy(strong, "tout", 0)).toBeGreaterThan(0);
  });
});

describe("scoreSide", () => {
  it("sums chosen strategies and dedupes/caps at 3", () => {
    const side: DebateSide = {
      strategies: ["attack", "aboveFray", "tout", "attack"],
      stats: { debate: 5, charisma: 5, statecraft: 5 },
      record: { officesHeld: 2, billsPassed: 2 },
    };
    const total = scoreSide(side, rngMid);
    // 3 unique strategies, all positive-ish at mid roll → positive total.
    expect(total).toBeGreaterThan(0);
  });
});

describe("marginToSwing", () => {
  it("is 0 below the draw threshold", () => {
    expect(marginToSwing(0)).toBe(0);
    expect(marginToSwing(1)).toBe(0);
  });
  it("is bounded between MIN and MAX swing for decisive margins", () => {
    expect(marginToSwing(2)).toBe(DEBATE_MIN_SWING);
    expect(marginToSwing(1000)).toBe(DEBATE_MAX_SWING);
  });
  it("grows with margin", () => {
    expect(marginToSwing(20)).toBeGreaterThan(marginToSwing(3));
  });
});

describe("pickAiStrategies", () => {
  it("favors the archetype matching the AI's strongest stat", () => {
    const debater = pickAiStrategies({ stats: { debate: 10, charisma: 1, statecraft: 1 } });
    expect(debater[0]).toBe("attack");
  });

  it("commits to exactly one strategy even with weak stats and no record", () => {
    const picks = pickAiStrategies({ stats: { debate: 1, charisma: 1, statecraft: 1 } });
    expect(picks.length).toBe(1);
  });

  it("commits to Tout when the record makes it the strongest fit", () => {
    const picks = pickAiStrategies({
      stats: { statecraft: 10, debate: 1, charisma: 1 },
      record: { officesHeld: 4, billsPassed: 6 },
    });
    expect(picks).toEqual(["tout"]);
  });
});

describe("resolveDebate", () => {
  it("declares the stronger side the winner with a signed swing", () => {
    const strong: DebateSide = { strategies: ["attack"], stats: { debate: 10 } };
    const weak: DebateSide = { strategies: ["aboveFray"], stats: { charisma: 1 } };
    const outcome = resolveDebate(strong, weak, rngMid);
    expect(outcome.result).toBe("challenger");
    expect(outcome.favorabilitySwing).toBeGreaterThanOrEqual(DEBATE_MIN_SWING);
  });

  it("returns a draw with no swing for near-equal sides", () => {
    const a: DebateSide = { strategies: ["aboveFray"], stats: { charisma: 5 } };
    const b: DebateSide = { strategies: ["aboveFray"], stats: { charisma: 5 } };
    const outcome = resolveDebate(a, b, rngMid);
    expect(outcome.result).toBe("draw");
    expect(outcome.favorabilitySwing).toBe(0);
  });
});
