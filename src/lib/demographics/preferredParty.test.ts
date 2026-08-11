import { describe, it, expect } from "vitest";
import {
  computeGroupPartyMatches,
  computeStateProjection,
  classifyLean,
  type RegionPartyPosition,
} from "./preferredParty";

const parties: RegionPartyPosition[] = [
  {
    partyId: "1",
    name: "Democratic",
    abbreviation: "DEM",
    color: "#3b82f6",
    economicPosition: -3,
    socialPosition: -3,
  },
  {
    partyId: "2",
    name: "Republican",
    abbreviation: "GOP",
    color: "#ef4444",
    economicPosition: 3,
    socialPosition: 3,
  },
];

describe("computeGroupPartyMatches", () => {
  it("ranks the aligned party first for a right-leaning group", () => {
    const matches = computeGroupPartyMatches(3, 3, parties);
    expect(matches[0].abbreviation).toBe("GOP");
    expect(matches[0].matchPct).toBeGreaterThan(matches[1].matchPct);
  });

  it("ranks the aligned party first for a left-leaning group", () => {
    const matches = computeGroupPartyMatches(-3, -3, parties);
    expect(matches[0].abbreviation).toBe("DEM");
  });

  it("match percentages sum to ~100 across supplied parties", () => {
    const matches = computeGroupPartyMatches(0, 0, parties);
    const total = matches.reduce((s, m) => s + m.matchPct, 0);
    expect(total).toBeGreaterThanOrEqual(99);
    expect(total).toBeLessThanOrEqual(101);
  });

  it("returns [] for no parties", () => {
    expect(computeGroupPartyMatches(1, 1, [])).toEqual([]);
  });
});

describe("computeStateProjection", () => {
  it("projects the aligned party ahead when the electorate leans its way", () => {
    const proj = computeStateProjection(
      [
        { economicLean: 3, socialLean: 3, weight: 70 },
        { economicLean: -3, socialLean: -3, weight: 30 },
      ],
      parties
    );
    expect(proj[0].abbreviation).toBe("GOP");
    const total = proj.reduce((s, p) => s + p.matchPct, 0);
    expect(total).toBeGreaterThanOrEqual(99);
    expect(total).toBeLessThanOrEqual(101);
  });

  it("ignores zero-weight archetypes and returns [] for no parties", () => {
    expect(computeStateProjection([{ economicLean: 1, socialLean: 1, weight: 0 }], [])).toEqual([]);
  });
});

describe("classifyLean", () => {
  it("marks a clear favorite as leaning that party", () => {
    const c = classifyLean(computeGroupPartyMatches(4, 4, parties));
    expect(c.isTossUp).toBe(false);
    expect(c.label).toBe("Leans GOP");
    expect(c.partyId).toBe("2");
  });

  it("marks an evenly-split group as persuadable", () => {
    const c = classifyLean(computeGroupPartyMatches(0, 0, parties));
    expect(c.isTossUp).toBe(true);
    expect(c.label).toBe("Persuadable");
    expect(c.partyId).toBeNull();
  });
});
