import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  seatDesiredStep,
  directionFromStep,
  seatPreferredVote,
  proposeChairMotion,
  ballotAgrees,
  majorityThreshold,
  tallyMeeting,
  boardCanCarryMotions,
  FOMC_MOVE_THRESHOLD,
  type FomcMacroContext,
} from "./fomc";
import type { FomcBallot, FomcSeat, FomcVote } from "@/lib/db/types/centralBank";

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
  it("is a strict majority of the full board", () => {
    expect(majorityThreshold(7)).toBe(4);
    expect(majorityThreshold(5)).toBe(3);
  });
});

describe("boardCanCarryMotions — the carry-a-motion threshold", () => {
  const seat = (seatId: string, occupant: FomcSeat["occupantType"] = "npp"): FomcSeat => ({
    seatId,
    isChair: seatId === "seat-1",
    occupantType: occupant,
    characterId: null,
    characterName: occupant === "npp" ? "Governor" : null,
    nppId: occupant === "npp" ? new ObjectId() : null,
    alignment: "hawk",
    appointedByPresidentId: null,
    appointedAtTurn: 1,
    termExpiresAtTurn: null,
  });

  it("is functional while seated members can reach a full-board majority", () => {
    // 7 seats, 4 seated: 4 >= 4 needed, so the board can carry a motion.
    const board = ["seat-1", "seat-2", "seat-3", "seat-4"].map((s) => seat(s));
    expect(boardCanCarryMotions(board)).toBe(true);
  });

  it("is dead once seated members fall below the majority threshold", () => {
    // The ticket #1238 prod shape: player chair + 6 vacant.
    const board = [seat("seat-1", "player"), seat("seat-2", "vacant"), seat("seat-3", "vacant")];
    expect(boardCanCarryMotions(board)).toBe(false);
  });

  it("needs 3 of 5 seated to carry", () => {
    const live3 = ["seat-1", "seat-2", "seat-3"].map((s) => seat(s));
    expect(boardCanCarryMotions(live3)).toBe(true);
    // A 5-seat board with only 2 seated: 2 < 3 needed, so it is dead.
    const live2 = [
      seat("seat-1"),
      seat("seat-2"),
      ...["seat-3", "seat-4", "seat-5"].map((s) => seat(s, "vacant")),
    ];
    expect(boardCanCarryMotions(live2)).toBe(false);
  });
});

describe("tallyMeeting — majority of the FULL board", () => {
  it("passes only with a full-board majority; abstains count against", () => {
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
    expect(t.passed).toBe(true);
    expect(t.decided).toBe(true);
  });

  it("fails when abstentions deny a majority even with no explicit opposition", () => {
    // Only 3 of 7 voted hike; 4 seats never voted (no-show ⇒ abstain).
    const ballots = [ballot("1", "hike"), ballot("2", "hike"), ballot("3", "hike")];
    const t = tallyMeeting(ballots, "hike", 7);
    expect(t.agree).toBe(3);
    expect(t.abstain).toBe(4);
    expect(t.passed).toBe(false);
    // 3 agree + 4 possible = 7 ≥ 4, so not yet decided against.
    expect(t.decided).toBe(false);
  });

  it("decides early once a majority is mathematically impossible", () => {
    // 7 seats, motion hike. 4 have voted cut ⇒ at most 3 can agree ⇒ dead.
    const ballots = [
      ballot("1", "cut"),
      ballot("2", "cut"),
      ballot("3", "cut"),
      ballot("4", "cut"),
    ];
    const t = tallyMeeting(ballots, "hike", 7);
    expect(t.passed).toBe(false);
    expect(t.decided).toBe(true);
  });

  it("treats a hold ballot as disagreement with a hike motion", () => {
    expect(ballotAgrees("hold", "hike")).toBe(false);
    expect(ballotAgrees("hike", "hike")).toBe(true);
  });
});
