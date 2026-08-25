import { describe, it, expect } from "vitest";
import {
  defaultRulesetFor,
  canTriggerChallenge,
  resolveLeadershipBallot,
  DEFAULT_CON_RULESET,
  DEFAULT_LAB_RULESET,
} from "./leadershipRemoval";

describe("defaultRulesetFor", () => {
  it("maps party families to their starting configs", () => {
    expect(defaultRulesetFor("Labour")).toBe(DEFAULT_LAB_RULESET);
    expect(defaultRulesetFor("con")).toBe(DEFAULT_CON_RULESET);
    expect(defaultRulesetFor("Tory")).toBe(DEFAULT_CON_RULESET);
    expect(defaultRulesetFor("something-else")).toBe(DEFAULT_CON_RULESET);
  });
  it("CON and LAB differ (the whole point of item 7)", () => {
    expect(DEFAULT_CON_RULESET.electorate).toBe("mps");
    expect(DEFAULT_LAB_RULESET.electorate).toBe("members");
    expect(DEFAULT_LAB_RULESET.triggerThresholdPct).toBeGreaterThan(
      DEFAULT_CON_RULESET.triggerThresholdPct
    );
  });
});

describe("canTriggerChallenge", () => {
  it("triggers when backers meet the threshold", () => {
    // CON: 15% of 100 MPs = 15
    expect(canTriggerChallenge(15, 100, DEFAULT_CON_RULESET).canTrigger).toBe(true);
    expect(canTriggerChallenge(14, 100, DEFAULT_CON_RULESET).canTrigger).toBe(false);
  });
  it("blocks during a survival-immunity window (CON)", () => {
    const r = canTriggerChallenge(50, 100, DEFAULT_CON_RULESET, { turnsSinceLastSurvival: 10 });
    expect(r.canTrigger).toBe(false);
    expect(r.reason).toContain("immunity");
  });
  it("allows once the immunity window has passed", () => {
    expect(
      canTriggerChallenge(50, 100, DEFAULT_CON_RULESET, { turnsSinceLastSurvival: 60 }).canTrigger
    ).toBe(true);
  });
  it("LAB has no immunity window", () => {
    expect(
      canTriggerChallenge(25, 100, DEFAULT_LAB_RULESET, { turnsSinceLastSurvival: 1 }).canTrigger
    ).toBe(true);
  });
  it("guards an empty parliamentary party", () => {
    expect(canTriggerChallenge(5, 0, DEFAULT_CON_RULESET).canTrigger).toBe(false);
  });
});

describe("resolveLeadershipBallot", () => {
  it("removes only on a strict majority to remove", () => {
    expect(resolveLeadershipBallot(51, 100, DEFAULT_CON_RULESET).removed).toBe(true);
    expect(resolveLeadershipBallot(50, 100, DEFAULT_CON_RULESET).removed).toBe(false); // tie survives
    expect(resolveLeadershipBallot(49, 100, DEFAULT_CON_RULESET).removed).toBe(false);
  });
  it("respects a custom (committee-amended) majority", () => {
    const supermajority = { ...DEFAULT_CON_RULESET, removalMajorityPct: 0.66 };
    expect(resolveLeadershipBallot(60, 100, supermajority).removed).toBe(false);
    expect(resolveLeadershipBallot(67, 100, supermajority).removed).toBe(true);
  });
  it("handles no votes cast", () => {
    expect(resolveLeadershipBallot(0, 0, DEFAULT_CON_RULESET).removed).toBe(false);
  });
});
