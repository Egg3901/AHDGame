import { describe, it, expect } from "vitest";
import { rollDebatePrep, rollDebatePractice } from "../debatePrep";
import {
  DEBATE_PREP_SUCCESS_CHANCE,
  DEBATE_PRACTICE_WIN_CHANCE,
  DEBATE_PRACTICE_BASE_CHANCE,
} from "../statsConstants";

describe("rollDebatePrep", () => {
  it("raises Debate by 1 on a successful roll (rng < chance)", () => {
    const r = rollDebatePrep(() => DEBATE_PREP_SUCCESS_CHANCE - 0.01, 4);
    expect(r.success).toBe(true);
    expect(r.debate).toBe(5);
  });

  it("does not change Debate on a failed roll (rng >= chance)", () => {
    const r = rollDebatePrep(() => 0.5, 4);
    expect(r.success).toBe(false);
    expect(r.debate).toBe(4);
  });

  it("treats exactly the chance as a failure (strict <)", () => {
    expect(rollDebatePrep(() => DEBATE_PREP_SUCCESS_CHANCE, 4).success).toBe(false);
  });

  it("clamps Debate at the cap on success", () => {
    const r = rollDebatePrep(() => 0, 10);
    expect(r.success).toBe(true);
    expect(r.debate).toBe(10);
  });
});

describe("rollDebatePractice", () => {
  it("gives the winner better odds than the loser", () => {
    // An rng between the two chances succeeds only for the winner.
    const rng = () => (DEBATE_PRACTICE_WIN_CHANCE + DEBATE_PRACTICE_BASE_CHANCE) / 2;
    expect(rollDebatePractice(rng, 4, true).success).toBe(true);
    expect(rollDebatePractice(rng, 4, false).success).toBe(false);
  });

  it("raises Debate by 1 on success", () => {
    expect(rollDebatePractice(() => 0, 4, false).debate).toBe(5);
  });

  it("does not exceed the cap", () => {
    const r = rollDebatePractice(() => 0, 10, true);
    expect(r.success).toBe(false);
    expect(r.debate).toBe(10);
  });
});
