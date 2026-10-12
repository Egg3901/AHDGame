import { describe, expect, it } from "vitest";
import { constitutionalConsentForce } from "./consent";
import { nppReferendumDecision } from "./decisions";
import { cohortTurnout } from "./cohorts";
describe("constitutional referendum rules", () => {
  it("respects the mandate by default and explicit Yes/No party positions", () => {
    const snapshot = {
      yesShare: 60,
      partyPositions: [
        { partyId: "1", side: "yes" as const },
        { partyId: "2", side: "no" as const },
      ],
    };
    expect(constitutionalConsentForce(snapshot, "1")).toBe(40);
    expect(constitutionalConsentForce(snapshot, "2")).toBe(-20);
    expect(constitutionalConsentForce(snapshot, "3")).toBe(10);
    expect(constitutionalConsentForce(undefined, "3")).toBe(0);
  });
  it("gives officers 24 turns then applies the NPP ministry's regional stance", () => {
    expect(nppReferendumDecision(123, 100, "independence")).toBeNull();
    expect(nppReferendumDecision(124, 100, "independence")).toBe("grant");
    expect(nppReferendumDecision(124, 100, "pro")).toBe("grant");
    expect(nppReferendumDecision(124, 100, "anti")).toBe("decline");
  });
  it("reports weighted cohort turnout including mobilization", () => {
    const cohorts = [
      { groupId: "a", share: 0.25, turnout: 40 },
      { groupId: "b", share: 0.75, turnout: 80 },
    ];
    expect(cohortTurnout(cohorts, [], 20)).toBe(70);
    expect(cohortTurnout(cohorts, [{ groupId: "a", turnoutMod: 1000 }], 20)).toBeCloseTo(75, 6);
  });
});
