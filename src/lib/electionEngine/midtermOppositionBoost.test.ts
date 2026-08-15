import { describe, expect, it } from "vitest";
import type { Election } from "@/lib/db/types";
import {
  MIDTERM_OPPOSITION_MULTIPLIER,
  buildMidtermOppositionModifierByParty,
  isMidtermOppositionBoostEligible,
  midtermOppositionModifierToPct,
} from "./midtermOppositionBoost";

function election(overrides: Partial<Election>): Election {
  return {
    countryId: "UK",
    electionType: "regionalCouncil",
    state: "SCO",
    cycle: 1,
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Election;
}

describe("midterm opposition boost", () => {
  it("boosts opposition and independents while leaving the governing coalition neutral", () => {
    const modifiers = buildMidtermOppositionModifierByParty(
      new Set(["1", "3"]),
      new Set(["1", "2", "3", "independent"])
    );
    expect(modifiers).toEqual(
      new Map([
        ["2", MIDTERM_OPPOSITION_MULTIPLIER],
        ["independent", MIDTERM_OPPOSITION_MULTIPLIER],
      ])
    );
    const pct = midtermOppositionModifierToPct(modifiers);
    expect(pct["2"]).toBeCloseTo(5);
    expect(pct.independent).toBeCloseTo(5);
  });

  it("no-ops when there is no formed government", () => {
    expect(buildMidtermOppositionModifierByParty(new Set(), new Set(["1", "2"]))).toEqual(
      new Map()
    );
  });

  it("only activates for post-transition off-cycle UK cohorts", () => {
    expect(isMidtermOppositionBoostEligible(election({ state: "SCO", cycle: 1 }))).toBe(true);
    expect(isMidtermOppositionBoostEligible(election({ state: "SCO", cycle: 0 }))).toBe(false);
    expect(isMidtermOppositionBoostEligible(election({ state: "WMI", cycle: 1 }))).toBe(false);
    expect(
      isMidtermOppositionBoostEligible(election({ countryId: "JP", state: "HOK", cycle: 1 }))
    ).toBe(false);
  });
});
