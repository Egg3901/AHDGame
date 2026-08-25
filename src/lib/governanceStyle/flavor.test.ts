import { describe, expect, it } from "vitest";
import { governanceStyleFlavor } from "./flavor";
import type { GovernanceStyleScore } from "./score";

function score(health: number, direction = 50): GovernanceStyleScore {
  return {
    name: "Governance Style",
    variant: "liberal-democracy",
    leftRight: { value: direction, label: "Centre" },
    democraticHealth: { value: health, label: "" },
    competition: null,
  };
}

describe("governanceStyleFlavor", () => {
  it("describes institutions fading at the failed pole", () => {
    const flavor = governanceStyleFlavor(score(10));
    expect(flavor.headline).toBe("Institutions in Name Only");
    expect(flavor.institutionalNarrative).toContain("Courts wait for signals");
  });

  it("describes self-reinforcing institutions at the healthy pole", () => {
    const flavor = governanceStyleFlavor(score(90));
    expect(flavor.headline).toBe("Democratic Renewal");
    expect(flavor.institutionalNarrative).toContain("expect to lose someday");
  });

  it("names a lopsided-party penalty in player-facing terms", () => {
    const input = score(55);
    input.competition = {
      dominantPartyId: "dem",
      dominantSeatShare: 75,
      chambersMeasured: 2,
      uninterruptedControlTurns: 60,
      consecutiveExecutiveTerms: 3,
      penalty: 17.5,
    };
    expect(governanceStyleFlavor(input).competitionNarrative).toContain("subtract 17.5 points");
    expect(governanceStyleFlavor(input).competitionNarrative).toContain("2 elected chambers");
  });
});
