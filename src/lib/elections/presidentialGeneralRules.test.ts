import { describe, expect, it } from "vitest";
import {
  applyTacticalMovement,
  blendIncumbentApproval,
  isClosingVotingTurn,
} from "./presidentialGeneralRules";

const candidates = [
  { id: "left", economicPosition: -2, socialPosition: -2 },
  { id: "right", economicPosition: 2, socialPosition: 2 },
  { id: "leftThird", economicPosition: -3, socialPosition: -2 },
  { id: "centerThird", economicPosition: 0, socialPosition: 0 },
];

describe("blendIncumbentApproval", () => {
  it("uses a 50/50 national-state blend", () => {
    expect(blendIncumbentApproval(60, 40, 0.5)).toBe(50);
  });

  it("clamps the state weight and degrades to an available input", () => {
    expect(blendIncumbentApproval(60, 40, -1)).toBe(60);
    expect(blendIncumbentApproval(60, 40, 2)).toBe(40);
    expect(blendIncumbentApproval(undefined, 43, 0.5)).toBe(43);
    expect(blendIncumbentApproval(57, undefined, 0.5)).toBe(57);
    expect(blendIncumbentApproval(undefined, undefined, 0.5)).toBeUndefined();
  });
});

describe("isClosingVotingTurn", () => {
  it("activates for the ramp and final bands only", () => {
    expect(isClosingVotingTurn(49, 36, 8, 4)).toBe(false);
    expect(isClosingVotingTurn(49, 37, 8, 4)).toBe(true);
    expect(isClosingVotingTurn(49, 48, 8, 4)).toBe(true);
    expect(isClosingVotingTurn(49, 49, 8, 4)).toBe(false);
  });
});

describe("applyTacticalMovement", () => {
  it("moves five percent of new ballots toward the nearest local top-two candidate", () => {
    const result = applyTacticalMovement({
      turnVotes: { left: 1_000, right: 900, leftThird: 200, centerThird: 100 },
      priorVotes: { left: 10_000, right: 9_000, leftThird: 3_000, centerThird: 2_000 },
      candidates,
      movementRate: 0.05,
    });

    expect(result).toEqual({ left: 1_012, right: 903, leftThird: 190, centerThird: 95 });
    expect(Object.values(result).reduce((sum, votes) => sum + votes, 0)).toBe(2_200);
  });

  it("can treat a third party as locally viable", () => {
    const result = applyTacticalMovement({
      turnVotes: { left: 1_000, right: 900, leftThird: 800, centerThird: 100 },
      priorVotes: { left: 10_000, right: 7_000, leftThird: 12_000, centerThird: 2_000 },
      candidates,
      movementRate: 0.05,
    });

    expect(result.leftThird).toBe(800);
    expect(result.left).toBe(1_050);
    expect(result.right).toBe(855);
    expect(result.centerThird).toBe(95);
  });

  it("does not rewrite prior votes or invent viability on the first turn", () => {
    const turnVotes = { left: 100, right: 90, leftThird: 20, centerThird: 10 };
    expect(
      applyTacticalMovement({
        turnVotes,
        priorVotes: {},
        candidates,
        movementRate: 0.05,
      })
    ).toEqual(turnVotes);
  });

  it("is identity for two-candidate races and a zero rate", () => {
    const turnVotes = { left: 100, right: 90 };
    expect(
      applyTacticalMovement({
        turnVotes,
        priorVotes: { left: 1_000, right: 900 },
        candidates: candidates.slice(0, 2),
        movementRate: 0.05,
      })
    ).toEqual(turnVotes);
    expect(
      applyTacticalMovement({
        turnVotes: { ...turnVotes, leftThird: 20 },
        priorVotes: { left: 1_000, right: 900, leftThird: 200 },
        candidates: candidates.slice(0, 3),
        movementRate: 0,
      })
    ).toEqual({ ...turnVotes, leftThird: 20 });
  });
});
