import { describe, it, expect } from "vitest";
import {
  seatDesiredStep,
  directionFromStep,
  seatPreferredVote,
  proposeChairMotion,
  ballotAgrees,
  majorityThreshold,
  tallyMeeting,
  FOMC_MOVE_THRESHOLD,
  type FomcMacroContext,
} from "./fomc";
import type { FomcBallot, FomcVote } from "@/lib/db/types/centralBank";

// Neutral rate 4, target inflation 2. Vary inflation/growth to drive the rule.
function ctx(overrides: Partial<FomcMacroContext> = {}): FomcMacroContext {
  return {
    neutralRate: 4,
    inflationRate: 2,
    targetInflation: 2,
    gdpGrowth: 2,
    currentRate: 4,
    ...overrides,
  };
}

function ballot(seatId: string, vote: FomcVote, auto = true): FomcBallot {
  return { seatId, vote, auto, castAt: new Date(0) };
}

describe("directionFromStep deadband", () => {
  it("holds inside the threshold, moves outside it", () => {
    expect(directionFromStep(0)).toBe("hold");
    expect(directionFromStep(FOMC_MOVE_THRESHOLD - 0.001)).toBe("hold");
    expect(directionFromStep(FOMC_MOVE_THRESHOLD + 0.01)).toBe("hike");
    expect(directionFromStep(-(FOMC_MOVE_THRESHOLD + 0.01))).toBe("cut");
  });
});

describe("seat views react to macro conditions", () => {
  it("wants a hike when inflation runs hot", () => {
    const step = seatDesiredStep("hawk", ctx({ inflationRate: 8 }));
    expect(step).toBeGreaterThan(0);
    expect(seatPreferredVote("hawk", ctx({ inflationRate: 8 }))).toBe("hike");
  });

  it("wants a cut when growth collapses and inflation is tame", () => {
    expect(seatPreferredVote("dove", ctx({ inflationRate: 1, gdpGrowth: -3 }))).toBe("cut");
  });

  it("holds when inflation sits at the seat's own tolerance", () => {
    // Hawk tolerates 1.5% (target −0.5), dove tolerates 2.5% (target +0.5).
    expect(seatPreferredVote("hawk", ctx({ inflationRate: 1.5 }))).toBe("hold");
    expect(seatPreferredVote("dove", ctx({ inflationRate: 2.5 }))).toBe("hold");
  });

  it("hawks and doves diverge in the same conditions", () => {
    // Mild inflation overshoot: hawk leans tighten, dove tolerates.
    const hawk = seatDesiredStep("hawk", ctx({ inflationRate: 3.5 }));
    const dove = seatDesiredStep("dove", ctx({ inflationRate: 3.5 }));
    expect(hawk).toBeGreaterThan(dove);
  });
});

describe("proposeChairMotion", () => {
  it("tables a hold when the cap/cooldown blocks a change", () => {
    const m = proposeChairMotion("hawk", ctx({ inflationRate: 12 }), { canChangeRate: false });
    expect(m.motion).toBe("hold");
    expect(m.proposedDelta).toBe(0);
  });

  it("proposes a signed delta matching the direction when a change is allowed", () => {
    const m = proposeChairMotion("hawk", ctx({ inflationRate: 12 }), { canChangeRate: true });
    expect(m.motion).toBe("hike");
    expect(m.proposedDelta).toBeGreaterThan(0);
  });
});

describe("majorityThreshold", () => {
  it("is a strict majority of the seated members", () => {
    expect(majorityThreshold(7)).toBe(4);
    expect(majorityThreshold(5)).toBe(3);
    expect(majorityThreshold(2)).toBe(2);
    expect(majorityThreshold(1)).toBe(1);
  });
});

describe("tallyMeeting — majority of seated members", () => {
  it("passes only with a seated-majority; abstains count against", () => {
    // 7 seats, motion hike. 4 agree ⇒ pass.
    const ballots = [
      ballot("1", "hike"),
      ballot("2", "hike"),
      ballot("3", "hike"),
      ballot("4", "hike"),
      ballot("5", "cut"),
    ];
    const t = tallyMeeting(ballots, "hike", 7);
    expect(t.agree).toBe(4);
    expect(t.needed).toBe(4);
    expect(t.passed).toBe(true);
    expect(t.decided).toBe(true);
  });

  it("fails when abstentions deny a majority even with no explicit opposition", () => {
    // 7 seats, 4 seated members. 2 voted hike; 2 seated members never voted
    // (no-show ⇒ abstain). Threshold is 3 of 4 seated, so 2 agrees are short,
    // and the 2 still-outstanding votes could still supply the third ⇒ open.
    const ballots = [ballot("1", "hike"), ballot("2", "hike")];
    const t = tallyMeeting(ballots, "hike", 7, 4);
    expect(t.agree).toBe(2);
    expect(t.abstain).toBe(2);
    expect(t.needed).toBe(3);
    expect(t.passed).toBe(false);
    expect(t.decided).toBe(false);
  });

  it("decides early once a majority is mathematically impossible", () => {
    // 7 seats, 4 seated members, motion hike. 3 have voted cut ⇒ at most 1
    // more can agree, which is short of 3 ⇒ dead.
    const ballots = [ballot("1", "cut"), ballot("2", "cut"), ballot("3", "cut")];
    const t = tallyMeeting(ballots, "hike", 7, 4);
    expect(t.passed).toBe(false);
    expect(t.decided).toBe(true);
  });

  it("treats a hold ballot as disagreement with a hike motion", () => {
    expect(ballotAgrees("hold", "hike")).toBe(false);
    expect(ballotAgrees("hike", "hike")).toBe(true);
  });
});

describe("tallyMeeting — vacant seats are outside the quorum", () => {
  it("lets a lone chair carry a motion on their own vote", () => {
    // 7-seat board, 6 vacant. 1 ballot (the chair) ⇒ majority of 1 seated = 1.
    const t = tallyMeeting([ballot("1", "hike")], "hike", 7, 1);
    expect(t.agree).toBe(1);
    expect(t.abstain).toBe(0);
    expect(t.needed).toBe(1);
    expect(t.passed).toBe(true);
    expect(t.decided).toBe(true);
  });

  it("does not silently shrink the quorum for voter no-shows", () => {
    // 7-seat board, only 1 member ever ballots but 4 are seated. Needs 3 of 4.
    const t = tallyMeeting([ballot("1", "hike")], "hike", 7, 4);
    expect(t.agree).toBe(1);
    expect(t.abstain).toBe(3);
    expect(t.needed).toBe(3);
    expect(t.passed).toBe(false);
  });

  it("defaults the quorum to the full board when seats are not passed in", () => {
    const t = tallyMeeting([ballot("1", "hike")], "hike", 7);
    expect(t.needed).toBe(4);
    expect(t.abstain).toBe(6);
    expect(t.passed).toBe(false);
  });
});
