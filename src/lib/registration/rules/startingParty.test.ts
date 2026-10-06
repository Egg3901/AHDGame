import { describe, it, expect } from "vitest";
import { isStartingPartyEligible } from "./startingParty";

describe("starting party eligibility", () => {
  it.each([
    { party: { frontierRegions: ["WA", "OR"] }, home: "WA", admin: false, expected: true },
    { party: { frontierRegions: ["WA", "OR"] }, home: "OR", admin: false, expected: true },
    { party: { frontierRegions: ["WA", "OR"] }, home: "NY", admin: false, expected: false },
    { party: { frontierRegions: null }, home: "NY", admin: false, expected: true },
    { party: { frontierRegions: null }, home: "", admin: false, expected: false },
    { party: {}, home: "NY", admin: false, expected: false },
    {
      party: { membershipMode: "approval", frontierRegions: null },
      home: "NY",
      admin: false,
      expected: false,
    },
    {
      party: { membershipMode: "approval", frontierRegions: [] },
      home: "NY",
      admin: true,
      expected: true,
    },
  ])("checks $home with $party (admin $admin)", ({ party, home, admin, expected }) => {
    expect(isStartingPartyEligible(party, home, admin)).toBe(expected);
  });
});
