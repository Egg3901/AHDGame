import { describe, it, expect } from "vitest";
import { computeNextCrisisState } from "../crisisState";
import type { SovereignCrisisState } from "@/lib/db/types/budget";
import type { AuctionOutcome } from "../auctionOutcome";

const stateFrom = (current: SovereignCrisisState, outcome: AuctionOutcome, count: number) =>
  computeNextCrisisState({ current, outcome, newConsecutiveFailedCount: count });

describe("computeNextCrisisState — recoverable states", () => {
  it("normal + fullySubscribed stays normal, no fire", () => {
    expect(stateFrom("normal", "fullySubscribed", 0)).toEqual({
      nextState: "normal",
      firedThisEvaluation: false,
    });
  });

  it("warning + fullySubscribed returns to normal, no fire", () => {
    expect(stateFrom("warning", "fullySubscribed", 0)).toEqual({
      nextState: "normal",
      firedThisEvaluation: false,
    });
  });

  it("normal + undersubscribed → warning, no fire", () => {
    expect(stateFrom("normal", "undersubscribed", 0)).toEqual({
      nextState: "warning",
      firedThisEvaluation: false,
    });
  });

  it("warning + undersubscribed stays warning, no fire", () => {
    expect(stateFrom("warning", "undersubscribed", 0)).toEqual({
      nextState: "warning",
      firedThisEvaluation: false,
    });
  });

  it("normal + failed (count 1) → warning, no fire", () => {
    expect(stateFrom("normal", "failed", 1)).toEqual({
      nextState: "warning",
      firedThisEvaluation: false,
    });
  });

  it("warning + failed (count 2) → warning, no fire", () => {
    expect(stateFrom("warning", "failed", 2)).toEqual({
      nextState: "warning",
      firedThisEvaluation: false,
    });
  });

  it("warning + failed (count 3) → crisisPending, FIRES", () => {
    expect(stateFrom("warning", "failed", 3)).toEqual({
      nextState: "crisisPending",
      firedThisEvaluation: true,
    });
  });

  it("normal + failed (count somehow >= 3) → crisisPending, FIRES (defensive: stale count carried)", () => {
    expect(stateFrom("normal", "failed", 3)).toEqual({
      nextState: "crisisPending",
      firedThisEvaluation: true,
    });
  });

  it("warning + failed (count 4, defensive over-count) → crisisPending, FIRES", () => {
    expect(stateFrom("warning", "failed", 4)).toEqual({
      nextState: "crisisPending",
      firedThisEvaluation: true,
    });
  });
});

describe("computeNextCrisisState — terminal-for-detection states are no-ops", () => {
  const TERMINAL: SovereignCrisisState[] = ["crisisPending", "crisisResolving", "recovering"];
  const OUTCOMES: AuctionOutcome[] = ["fullySubscribed", "undersubscribed", "failed"];

  for (const current of TERMINAL) {
    for (const outcome of OUTCOMES) {
      it(`${current} + ${outcome} stays ${current}, no fire`, () => {
        expect(stateFrom(current, outcome, 5)).toEqual({
          nextState: current,
          firedThisEvaluation: false,
        });
      });
    }
  }
});
