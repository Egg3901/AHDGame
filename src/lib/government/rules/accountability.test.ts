import { describe, expect, it } from "vitest";
import {
  accountabilityDrain,
  continuingPartySinceTurn,
  earnedOfficeholdingBonus,
  executiveIncumbencyBudget,
  responsibilityShares,
} from "./accountability";
import { planAutonomousSupport, chooseAutonomousCabinet } from "./autonomousSupport";

describe("shared government accountability", () => {
  it("attributes governing coalitions and an opposing legislative majority without party labels", () => {
    const shares = responsibilityShares({
      executiveParty: "a",
      coalitionParties: ["b"],
      seatsByParty: { a: 20, b: 20, c: 60 },
      chamberSize: 100,
    });
    expect(shares).toEqual({ a: 0.375, b: 0.375, c: 0.25 });
    expect(Object.values(shares).reduce((sum, n) => sum + n, 0)).toBe(1);
  });
  it("keeps party tenure through a nominee change and resets after losing responsibility", () => {
    expect(continuingPartySinceTurn({ sinceTurn: 1, lastObservedTurn: 600 }, 601)).toBe(1);
    expect(continuingPartySinceTurn({ sinceTurn: 1, lastObservedTurn: 598 }, 601)).toBe(601);
    expect(accountabilityDrain(20, 1, 768)).toBeGreaterThan(accountabilityDrain(20, 1, 1));
    expect(accountabilityDrain(70, 1, 5000)).toBe(0);
  });
  it("makes worse approval progressively costlier, with bounded registration and voting effects", () => {
    const ratings = [46, 40, 30, 20, 0];
    const budgets = ratings.map((a) => executiveIncumbencyBudget(a));
    expect(budgets.every((value, i) => i === 0 || value < budgets[i - 1])).toBe(true);
    expect(earnedOfficeholdingBonus(30)).toBe(0);
    expect(earnedOfficeholdingBonus(50)).toBe(0);
    expect(earnedOfficeholdingBonus(60)).toBe(0.5);
    expect(earnedOfficeholdingBonus(70)).toBe(1);
    expect(earnedOfficeholdingBonus(undefined)).toBe(0);
  });
  it("forms compatible coalitions and records minority tolerance", () => {
    const parties = [
      { id: "a", seats: 40, economic: 0, social: 0 },
      { id: "b", seats: 20, economic: 2, social: 0 },
      { id: "c", seats: 40, economic: -5, social: -5 },
    ];
    expect(planAutonomousSupport(parties, "a", 51)).toEqual({
      supporting: ["a", "b"],
      abstaining: [],
      seats: 60,
    });
    parties[1].economic = 4;
    expect(planAutonomousSupport(parties, "a", 51)).toEqual({
      supporting: ["a"],
      abstaining: ["b"],
      seats: 40,
    });
  });
  it("selects an alternative coalition instead of reinstalling a rejected plurality", () => {
    const parties = [
      { id: "a", seats: 40, economic: -5, social: -5 },
      { id: "b", seats: 35, economic: 4, social: 4 },
      { id: "c", seats: 25, economic: 5, social: 5 },
    ];
    expect(chooseAutonomousCabinet(parties, ["a", "b", "c"], 51)).toMatchObject({
      leadPartyId: "b",
      supporting: ["b", "c"],
      seats: 60,
    });
    parties[2].economic = -5;
    parties[2].social = 5;
    expect(chooseAutonomousCabinet(parties, ["a", "b", "c"], 51)).toBeNull();
  });
});
