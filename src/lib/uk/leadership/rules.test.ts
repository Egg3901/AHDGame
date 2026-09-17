import { describe, it, expect } from "vitest";
import {
  LEADERSHIP_RULESET_BOUNDS,
  committeeNameForFamily,
  resolveCommitteeControl,
  validateRulesetAmendment,
} from "./rules";

describe("validateRulesetAmendment", () => {
  it("accepts a full in-bounds patch", () => {
    expect(
      validateRulesetAmendment({
        triggerThresholdPct: 0.2,
        electorate: "members",
        removalMajorityPct: 0.6,
        survivalImmunityTurns: 24,
      }).ok
    ).toBe(true);
  });

  it("accepts each field on its own", () => {
    expect(validateRulesetAmendment({ electorate: "mps" }).ok).toBe(true);
    expect(validateRulesetAmendment({ triggerThresholdPct: 0.05 }).ok).toBe(true);
    expect(validateRulesetAmendment({ removalMajorityPct: 0.75 }).ok).toBe(true);
    expect(validateRulesetAmendment({ survivalImmunityTurns: 0 }).ok).toBe(true);
  });

  it("rejects an empty patch so no-ops cannot burn the cooldown", () => {
    const r = validateRulesetAmendment({});
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("nothing");
  });

  it("rejects out-of-bounds thresholds and majorities", () => {
    expect(validateRulesetAmendment({ triggerThresholdPct: 0.01 }).ok).toBe(false);
    expect(validateRulesetAmendment({ triggerThresholdPct: 0.9 }).ok).toBe(false);
    // Ties keep the leader, so a bare half is not a valid removal majority.
    expect(validateRulesetAmendment({ removalMajorityPct: 0.5 }).ok).toBe(false);
    expect(validateRulesetAmendment({ removalMajorityPct: 0.9 }).ok).toBe(false);
  });

  it("rejects bad electorates and non-integer immunity", () => {
    expect(validateRulesetAmendment({ electorate: "peers" as never }).ok).toBe(false);
    expect(validateRulesetAmendment({ survivalImmunityTurns: 2.5 }).ok).toBe(false);
    expect(validateRulesetAmendment({ survivalImmunityTurns: -1 }).ok).toBe(false);
    expect(
      validateRulesetAmendment({
        survivalImmunityTurns: LEADERSHIP_RULESET_BOUNDS.survivalImmunityTurns.max + 1,
      }).ok
    ).toBe(false);
  });

  it("reports every problem in one pass", () => {
    const r = validateRulesetAmendment({
      triggerThresholdPct: 0.99,
      removalMajorityPct: 0.1,
    });
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(2);
  });
});

describe("resolveCommitteeControl", () => {
  it("reports an outright faction majority", () => {
    const control = resolveCommitteeControl([
      { memberId: "a", faction: "left" },
      { memberId: "b", faction: "left" },
      { memberId: "c", faction: "right" },
    ]);
    expect(control.totalSeats).toBe(3);
    expect(control.leadingFaction).toBe("left");
    expect(control.majorityHeld).toBe(true);
  });

  it("reports a divided committee on ties and pluralities", () => {
    const tied = resolveCommitteeControl([
      { memberId: "a", faction: "left" },
      { memberId: "b", faction: "right" },
    ]);
    expect(tied.majorityHeld).toBe(false);

    const plurality = resolveCommitteeControl([
      { memberId: "a", faction: "left" },
      { memberId: "b", faction: "right" },
      { memberId: "c", faction: null },
    ]);
    expect(plurality.majorityHeld).toBe(false);
    expect(plurality.seatsByFaction["(unaligned)"]).toBe(1);
  });

  it("handles an empty committee", () => {
    const control = resolveCommitteeControl([]);
    expect(control.totalSeats).toBe(0);
    expect(control.leadingFaction).toBeNull();
    expect(control.majorityHeld).toBe(false);
  });
});

describe("committeeNameForFamily", () => {
  it("names the 1922 / NEC analogues", () => {
    expect(committeeNameForFamily("con")).toBe("1922 Committee");
    expect(committeeNameForFamily("lab")).toBe("National Executive Committee");
    expect(committeeNameForFamily("other")).toBe("National Committee");
  });
});
