import { describe, it, expect } from "vitest";
import { computeOrgDerived, ORG_ASSESSED_RATE } from "./orgDerivedMetrics";

describe("computeOrgDerived", () => {
  const members = [
    { countryId: "US" as const, gdpMillions: 27_000_000 },
    { countryId: "IE" as const, gdpMillions: 550_000 },
  ];

  it("derives contribution %, influence index, world share, budget", () => {
    const d = computeOrgDerived(members, "IE", 55_100_000);
    const us = d.members.find((m) => m.countryId === "US")!;
    const ie = d.members.find((m) => m.countryId === "IE")!;
    expect(us.contributionPct).toBeCloseTo(0.98, 2);
    expect(us.influenceIndex).toBe(100);
    expect(ie.influenceIndex).toBe(2);
    expect(d.worldEconomySharePct).toBe(50); // 27.55M of a 55.1M world
    expect(d.notionalBudgetMillions).toBeCloseTo(27_550_000 * ORG_ASSESSED_RATE, 5);
    expect(d.yourInfluence).toBe(2);
  });

  it("returns zeros for an empty member set without NaN", () => {
    const d = computeOrgDerived([], null);
    expect(d.members).toEqual([]);
    expect(d.worldEconomySharePct).toBe(0);
    expect(d.notionalBudgetMillions).toBe(0);
    expect(d.yourInfluence).toBe(0);
  });

  it("yourInfluence is 0 when the viewer is not a member", () => {
    expect(computeOrgDerived(members, "CN").yourInfluence).toBe(0);
  });

  it("has no world share when the world has not been priced", () => {
    // Division by an unknown denominator must read as "unknown", not as 100%.
    expect(computeOrgDerived(members, null).worldEconomySharePct).toBe(0);
  });

  it("rises when an ally is admitted, however small", () => {
    // The metric it replaced FELL here: averaging influence indices, a small
    // member dragged the mean down, so growing the bloc lost you standing.
    const world = 55_100_000;
    const before = computeOrgDerived(members, null, world).worldEconomySharePct;
    const after = computeOrgDerived(
      [...members, { countryId: "JP" as const, gdpMillions: 4_000_000 }],
      null,
      world
    ).worldEconomySharePct;
    expect(after).toBeGreaterThan(before);
  });

  it("never reports more of the world than there is", () => {
    // Float dust on a bloc holding effectively everything must not print 100.1%.
    const d = computeOrgDerived(members, null, 27_549_999);
    expect(d.worldEconomySharePct).toBe(100);
  });

  it("keeps one decimal, so a small bloc is not rounded to nothing", () => {
    const d = computeOrgDerived(
      [{ countryId: "IE" as const, gdpMillions: 550_000 }],
      null,
      100_000_000
    );
    expect(d.worldEconomySharePct).toBe(0.6);
  });
});
