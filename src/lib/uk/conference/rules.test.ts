import { describe, expect, it } from "vitest";
import {
  CONFERENCE_APPROVAL_DELTA,
  CONFERENCE_CADENCE_TURNS,
  CONFERENCE_COHESION_PS,
  CONFERENCE_MAX_PAYOFF_GROUPS,
  CONFERENCE_MOTION_QUORUM_FLOOR,
  CONFERENCE_OPEN_LEAD_TURNS,
  CONFERENCE_PAYOFF_DURATION_TURNS,
  CONFERENCE_PLATFORM_QUORUM_FLOOR,
  CONFERENCE_VOTING_TURNS,
  conferenceOpensAtTurn,
  conferenceVotingClosesTurn,
  conferenceYearForTurn,
  conferenceYearStartTurn,
  isConferencePayoffEnabled,
  payoffGroupsForPledges,
  quorumFor,
  resolveConferenceMotion,
  resolvePlatformRatification,
} from "./rules";

describe("conference cadence", () => {
  it("maps turns 1-48 to year 1 and rolls over at turn 49", () => {
    expect(conferenceYearForTurn(1)).toBe(1);
    expect(conferenceYearForTurn(48)).toBe(1);
    expect(conferenceYearForTurn(49)).toBe(2);
    expect(conferenceYearForTurn(96)).toBe(2);
    expect(conferenceYearForTurn(97)).toBe(3);
  });

  it("clamps non-positive turns to year 1", () => {
    expect(conferenceYearForTurn(0)).toBe(1);
    expect(conferenceYearForTurn(-10)).toBe(1);
  });

  it("starts each year on its first turn", () => {
    expect(conferenceYearStartTurn(1)).toBe(1);
    expect(conferenceYearStartTurn(2)).toBe(CONFERENCE_CADENCE_TURNS + 1);
    expect(conferenceYearStartTurn(3)).toBe(2 * CONFERENCE_CADENCE_TURNS + 1);
  });

  it("opens a few turns into the year with a window that fits inside it", () => {
    const opensAt = conferenceOpensAtTurn(2);
    expect(opensAt).toBe(conferenceYearStartTurn(2) + CONFERENCE_OPEN_LEAD_TURNS);
    const closesAt = conferenceVotingClosesTurn(opensAt);
    expect(closesAt).toBe(opensAt + CONFERENCE_VOTING_TURNS);
    expect(closesAt).toBeLessThan(conferenceYearStartTurn(3));
  });

  it("keeps the year-1 window inside year 1", () => {
    const closesAt = conferenceVotingClosesTurn(conferenceOpensAtTurn(1));
    expect(closesAt).toBeLessThan(conferenceYearStartTurn(2));
  });
});

describe("quorumFor", () => {
  it("caps the floor at the eligible roll", () => {
    expect(quorumFor(10, CONFERENCE_PLATFORM_QUORUM_FLOOR)).toBe(CONFERENCE_PLATFORM_QUORUM_FLOOR);
    expect(quorumFor(1, CONFERENCE_PLATFORM_QUORUM_FLOOR)).toBe(1);
    expect(quorumFor(0, CONFERENCE_PLATFORM_QUORUM_FLOOR)).toBe(0);
  });

  it("uses the smaller committee floor for motions", () => {
    expect(quorumFor(10, CONFERENCE_MOTION_QUORUM_FLOOR)).toBe(CONFERENCE_MOTION_QUORUM_FLOOR);
    expect(quorumFor(1, CONFERENCE_MOTION_QUORUM_FLOOR)).toBe(1);
  });
});

describe("resolvePlatformRatification", () => {
  it("ratifies on a strict majority with quorum met", () => {
    expect(
      resolvePlatformRatification({ votesFor: 3, votesAgainst: 1, eligibleCount: 10 })
    ).toEqual({ passed: true, reason: "ratified" });
  });

  it("rejects ties (no majority)", () => {
    const result = resolvePlatformRatification({
      votesFor: 2,
      votesAgainst: 2,
      eligibleCount: 10,
    });
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("majority");
  });

  it("rejects minorities", () => {
    const result = resolvePlatformRatification({
      votesFor: 1,
      votesAgainst: 4,
      eligibleCount: 10,
    });
    expect(result.passed).toBe(false);
  });

  it("rejects below-quorum turnouts even with unanimity", () => {
    const result = resolvePlatformRatification({
      votesFor: 2,
      votesAgainst: 0,
      eligibleCount: 10,
    });
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("quorum");
  });

  it("lets a tiny electorate act (quorum capped by the roll)", () => {
    expect(resolvePlatformRatification({ votesFor: 1, votesAgainst: 0, eligibleCount: 1 })).toEqual(
      { passed: true, reason: "ratified" }
    );
  });
});

describe("resolveConferenceMotion", () => {
  it("passes on a strict majority with the committee quorum met", () => {
    expect(resolveConferenceMotion({ votesFor: 2, votesAgainst: 0, eligibleCount: 5 })).toEqual({
      passed: true,
      reason: "passed",
    });
  });

  it("rejects ties and below-quorum turnouts", () => {
    expect(resolveConferenceMotion({ votesFor: 1, votesAgainst: 1, eligibleCount: 5 }).passed).toBe(
      false
    );
    expect(resolveConferenceMotion({ votesFor: 1, votesAgainst: 0, eligibleCount: 5 }).passed).toBe(
      false
    );
  });
});

describe("payoff constants and group selection", () => {
  it("keeps the approval delta vote-sub-threshold and the cohesion credit small", () => {
    expect(CONFERENCE_APPROVAL_DELTA).toBeLessThanOrEqual(2);
    expect(CONFERENCE_COHESION_PS).toBeLessThanOrEqual(30);
    expect(CONFERENCE_PAYOFF_DURATION_TURNS).toBeGreaterThan(0);
  });

  it("selects the union of salient groups, sorted and capped", () => {
    const salience = new Map([
      ["pledge-b", ["wealth:low", "age:senior"]],
      ["pledge-a", ["age:senior", "wealth:high"]],
    ]);
    expect(payoffGroupsForPledges(["pledge-a", "pledge-b"], salience)).toEqual([
      "age:senior",
      "wealth:high",
      "wealth:low",
    ]);
  });

  it("caps groups and ignores pledges with no salience", () => {
    const salience = new Map(
      Array.from({ length: CONFERENCE_MAX_PAYOFF_GROUPS + 5 }, (_, i) => [
        `pledge-${i}`,
        [`group-${String(i).padStart(2, "0")}`],
      ])
    );
    const groups = payoffGroupsForPledges(
      Array.from(salience.keys()),
      salience as Map<string, string[]>
    );
    expect(groups).toHaveLength(CONFERENCE_MAX_PAYOFF_GROUPS);
    expect(payoffGroupsForPledges(["unknown-pledge"], new Map())).toEqual([]);
  });

  it("gates the vote-affecting approval payoff on the UK_CONFERENCE_PAYOFF flag", () => {
    // Pure predicate: the shell reads process.env and passes the raw value in,
    // so the rules core stays free of environment access.
    expect(isConferencePayoffEnabled(undefined)).toBe(false);
    expect(isConferencePayoffEnabled("1")).toBe(true);
    expect(isConferencePayoffEnabled("0")).toBe(false);
  });
});
