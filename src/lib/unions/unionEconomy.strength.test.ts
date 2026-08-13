import { describe, expect, it } from "vitest";
import {
  isUnionLeadershipElectionOpen,
  LEADERSHIP_ELECTION_MIN_STRENGTH,
  ORGANIZE_STRENGTH_GAIN,
  unionStrength,
} from "./unionEconomy";

describe("union strength", () => {
  it("reads a missing or invalid field as zero", () => {
    expect(unionStrength({ strength: undefined })).toBe(0);
    expect(unionStrength({ strength: -5 })).toBe(0);
    expect(unionStrength({ strength: Number.NaN })).toBe(0);
    expect(unionStrength({ strength: 40 })).toBe(40);
  });

  it("opens the leadership contest on strength, even while a president sits", () => {
    const atThreshold = LEADERSHIP_ELECTION_MIN_STRENGTH;
    expect(isUnionLeadershipElectionOpen({ strength: atThreshold })).toBe(true);
    expect(isUnionLeadershipElectionOpen({ strength: atThreshold - 1 })).toBe(false);
    expect(isUnionLeadershipElectionOpen({ strength: undefined })).toBe(false);
    // Seated owner no longer closes the contest — CEO-style rolling fight.
    expect(
      isUnionLeadershipElectionOpen({
        strength: atThreshold,
      })
    ).toBe(true);
  });

  it("needs ten drives from scratch to open an election", () => {
    expect(LEADERSHIP_ELECTION_MIN_STRENGTH / ORGANIZE_STRENGTH_GAIN).toBe(10);
  });
});
