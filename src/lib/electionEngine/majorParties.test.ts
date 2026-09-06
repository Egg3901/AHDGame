import { describe, expect, it } from "vitest";
import { partitionMajorParties } from "./majorParties";
import { getMajorPartiesForRegion } from "@/lib/constants/countries";

describe("partitionMajorParties (#811)", () => {
  it("resolves UK majors through the abbreviation when party is a sequential id", () => {
    const set = getMajorPartiesForRegion("UK", "ENG");
    const cands = [
      { party: "1", partyAbbr: "LAB", w: 40 },
      { party: "2", partyAbbr: "CON", w: 35 },
      { party: "3", partyAbbr: "SDP", w: 15 },
    ];
    const { major, third, resolvedBy } = partitionMajorParties(cands, set, (c) => c.w);
    expect(resolvedBy).toBe("config");
    expect(major.map((c) => c.party)).toEqual(["1", "2"]);
    expect(third.map((c) => c.party)).toEqual(["3"]);
  });

  it("falls back to the two heaviest parties when no encoding matches (1953 Japan roster)", () => {
    const set = getMajorPartiesForRegion("JP");
    const cands = [
      { party: "1", partyAbbr: "RYO", w: 50 },
      { party: "2", partyAbbr: "JDP", w: 30 },
      { party: "3", partyAbbr: "JCP", w: 5 },
      { party: "4", partyAbbr: "JSP", w: 15 },
    ];
    const { major, third, resolvedBy } = partitionMajorParties(cands, set, (c) => c.w);
    expect(resolvedBy).toBe("weight");
    expect(major.map((c) => c.party).sort()).toEqual(["1", "2"]);
    expect(third.map((c) => c.party).sort()).toEqual(["3", "4"]);
  });

  it("keeps a two-party race un-spoiled", () => {
    const set = getMajorPartiesForRegion("JP");
    const cands = [
      { party: "1", partyAbbr: "RYO", w: 50 },
      { party: "2", partyAbbr: "JDP", w: 30 },
    ];
    const { third, resolvedBy } = partitionMajorParties(cands, set, (c) => c.w);
    expect(resolvedBy).toBe("none");
    expect(third).toEqual([]);
  });

  it("does not invent majors for a fixture race with no abbreviations and no config match", () => {
    const set = getMajorPartiesForRegion("US");
    const cands = [
      { party: "p1", w: 1 },
      { party: "p2", w: 5 },
      { party: "p3", w: 9 },
    ];
    const { third, resolvedBy } = partitionMajorParties(cands, set, (c) => c.w);
    expect(resolvedBy).toBe("none");
    expect(third).toEqual([]);
  });

  it("still honours seed slugs for fixtures", () => {
    const set = getMajorPartiesForRegion("UK", "SCO");
    const cands = [
      { party: "uk_snp", w: 1 },
      { party: "uk_labour", w: 1 },
      { party: "uk_conservative", w: 1 },
    ];
    const { third } = partitionMajorParties(cands, set, (c) => c.w);
    expect(third.map((c) => c.party)).toEqual(["uk_conservative"]);
  });
});
