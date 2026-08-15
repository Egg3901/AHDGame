import { describe, expect, it } from "vitest";
import { UK_REGIONAL_COUNCIL_SEATS } from "@/lib/constants/states";
import { DEFAULT_CYCLE_ANCHOR_CONTEXT, getCycleAnchors } from "./cycleAnchorContext";
import {
  UK_REGIONAL_COUNCIL_COHORT_BY_REGION,
  getUKRegionalCouncilCycle1EndTurn,
  getUKRegionalCouncilElectionYear,
  isUKRegionalCouncilMidterm,
} from "./ukRegionalCouncilStagger";

describe("UK regional council stagger", () => {
  it("assigns every region exactly once and balances each annual cohort by seats", () => {
    expect(Object.keys(UK_REGIONAL_COUNCIL_COHORT_BY_REGION).sort()).toEqual(
      Object.keys(UK_REGIONAL_COUNCIL_SEATS).sort()
    );

    const seatsByCohort = new Map<number, number>();
    for (const [regionId, cohort] of Object.entries(UK_REGIONAL_COUNCIL_COHORT_BY_REGION)) {
      seatsByCohort.set(
        cohort,
        (seatsByCohort.get(cohort) ?? 0) + UK_REGIONAL_COUNCIL_SEATS[regionId]
      );
    }
    expect([...seatsByCohort.entries()].sort()).toEqual([
      [1, 129],
      [2, 107],
      [3, 127],
      [4, 110],
      [5, 105],
    ]);
  });

  it("closes one cohort per year and aligns cohort 5 with the next Commons election", () => {
    const commons = getCycleAnchors(DEFAULT_CYCLE_ANCHOR_CONTEXT).ukCommons;
    expect(getUKRegionalCouncilCycle1EndTurn("SCO", DEFAULT_CYCLE_ANCHOR_CONTEXT)).toBe(
      commons + 48
    );
    expect(getUKRegionalCouncilCycle1EndTurn("WMI", DEFAULT_CYCLE_ANCHOR_CONTEXT)).toBe(
      commons + 240
    );
    expect(getUKRegionalCouncilElectionYear("SCO", 1, DEFAULT_CYCLE_ANCHOR_CONTEXT)).toBe(2025);
    expect(getUKRegionalCouncilElectionYear("WMI", 1, DEFAULT_CYCLE_ANCHOR_CONTEXT)).toBe(2029);
    expect(getUKRegionalCouncilElectionYear("SCO", 2, DEFAULT_CYCLE_ANCHOR_CONTEXT)).toBe(2030);
  });

  it("treats transition cycle 0 and the Commons-aligned cohort as neutral", () => {
    expect(
      isUKRegionalCouncilMidterm({
        countryId: "UK",
        electionType: "regionalCouncil",
        state: "SCO",
        cycle: 0,
      })
    ).toBe(false);
    expect(
      isUKRegionalCouncilMidterm({
        countryId: "UK",
        electionType: "regionalCouncil",
        state: "WMI",
        cycle: 1,
      })
    ).toBe(false);
    expect(
      isUKRegionalCouncilMidterm({
        countryId: "UK",
        electionType: "regionalCouncil",
        state: "SCO",
        cycle: 1,
      })
    ).toBe(true);
  });
});
