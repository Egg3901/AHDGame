import { describe, expect, it } from "vitest";
import { governanceStyleFlavor } from "./flavor";
import { democraticHealthPressure } from "./rules/democraticConsequences";
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
  it("states the heaviest penalties at the failed pole", () => {
    const flavor = governanceStyleFlavor(score(10));
    expect(flavor.headline).toBe("Institutions in Name Only");
    expect(flavor.institutionalNarrative).toContain("2.5 to 4 percentage points lower");
  });

  it("states that no penalty applies at the healthy pole", () => {
    const flavor = governanceStyleFlavor(score(90));
    expect(flavor.headline).toBe("Democratic Renewal");
    expect(flavor.institutionalNarrative).toContain("carry no institutional penalty");
  });

  it("quotes penalty ranges that match the consequence curve at each band edge", () => {
    const points = (n: number) => String(Math.round(n * 10) / 10);
    const percent = (n: number) => `${Math.round(n * 100)}%`;
    const extra = (h: number) => {
      const p = democraticHealthPressure(h);
      return percent(p.currentRulerPenalty - p.partyPenalty);
    };
    const bands = [
      { inside: 10, mild: 20, harsh: 0 },
      { inside: 30, mild: 40, harsh: 20 },
    ];
    for (const { inside, mild, harsh } of bands) {
      const lo = democraticHealthPressure(mild);
      const hi = democraticHealthPressure(harsh);
      const text = governanceStyleFlavor(score(inside)).institutionalNarrative;
      expect(text).toContain(
        `${points(lo.gdpGrowthDrag)} to ${points(hi.gdpGrowthDrag)} percentage`
      );
      expect(text).toContain(
        `${points(lo.sovereignSpread)} to ${points(hi.sovereignSpread)} percentage`
      );
      expect(text).toContain(`${percent(lo.partyPenalty)} to ${percent(hi.partyPenalty)}`);
      expect(text).toContain(`up to a further ${extra(harsh)}`);
    }
    const strain = governanceStyleFlavor(score(50)).institutionalNarrative;
    const edge = democraticHealthPressure(40);
    expect(strain).toContain(`up to ${points(edge.gdpGrowthDrag)} percentage`);
    expect(strain).toContain(`up to ${points(edge.sovereignSpread)} percentage`);
    expect(strain).toContain(`up to ${percent(edge.partyPenalty)}`);
    expect(strain).toContain(`up to a further ${extra(40)}`);
    expect(democraticHealthPressure(60).severity).toBe(0);
  });

  it("names a lopsided-party penalty in player-facing terms", () => {
    const input = score(55);
    input.competition = {
      dominantPartyId: "dem",
      dominantSeatShare: 75,
      chambersMeasured: 2,
      executivePartyId: "dem",
      executiveAlignedWithLegislature: true,
      uninterruptedControlTurns: 60,
      consecutiveExecutiveTerms: 3,
      seatMarginPenalty: 12,
      legislativeContinuityPenalty: 1.5,
      executiveContinuityPenalty: 4,
      courtDominantPartyId: "dem",
      courtDominantShare: 77.8,
      courtSeated: 9,
      courtPenalty: 10.7,
      penalty: 28.2,
    };
    expect(governanceStyleFlavor(input).competitionNarrative).toContain(
      "total democratic-health penalty of 28.2"
    );
    expect(governanceStyleFlavor(input).competitionNarrative).toContain("2 elected chambers");
    expect(governanceStyleFlavor(input).competitionNarrative).toContain("presidency");
    expect(governanceStyleFlavor(input).competitionNarrative).toContain("continuity");
    expect(governanceStyleFlavor(input).competitionNarrative).toContain(
      "Supreme Court is 77.8% one party"
    );
  });
});
