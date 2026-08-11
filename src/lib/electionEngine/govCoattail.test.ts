import { describe, it, expect } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import {
  isCoattailEligibleRace,
  isOwnRegionalExecutiveRace,
  buildGovModifierByParty,
  govModifierToPct,
  resolveGovExecutiveApproval,
} from "./govCoattail";

describe("isOwnRegionalExecutiveRace", () => {
  const base = {
    isGeneralElection: true,
    electionType: "governor",
    regionalExecOfficeType: "governor",
    hasState: true,
  };

  it("is true for the governor's own state race", () => {
    expect(isOwnRegionalExecutiveRace(base)).toBe(true);
  });

  it("is false for a down-ballot race in the same state", () => {
    expect(isOwnRegionalExecutiveRace({ ...base, electionType: "house" })).toBe(false);
  });

  it("is false during primaries", () => {
    expect(isOwnRegionalExecutiveRace({ ...base, isGeneralElection: false })).toBe(false);
  });

  it("is false for a governor race with no state scope", () => {
    expect(isOwnRegionalExecutiveRace({ ...base, hasState: false })).toBe(false);
  });

  it("is false when the country has no regional executive office", () => {
    expect(isOwnRegionalExecutiveRace({ ...base, regionalExecOfficeType: null })).toBe(false);
  });
});

describe("isCoattailEligibleRace", () => {
  it("is eligible for an in-state down-ballot general (senate)", () => {
    expect(
      isCoattailEligibleRace({
        isGeneralElection: true,
        electionType: "senate",
        regionalExecOfficeType: "governor",
        isOwnHeadOfGovernmentRace: false,
      })
    ).toBe(true);
  });

  it("is NOT eligible for the executive's own race (governor)", () => {
    expect(
      isCoattailEligibleRace({
        isGeneralElection: true,
        electionType: "governor",
        regionalExecOfficeType: "governor",
        isOwnHeadOfGovernmentRace: false,
      })
    ).toBe(false);
  });

  it("is NOT eligible for a head-of-government / presidential race", () => {
    expect(
      isCoattailEligibleRace({
        isGeneralElection: true,
        electionType: "president",
        regionalExecOfficeType: "governor",
        isOwnHeadOfGovernmentRace: true,
      })
    ).toBe(false);
  });

  it("is NOT eligible in a primary", () => {
    expect(
      isCoattailEligibleRace({
        isGeneralElection: false,
        electionType: "senate",
        regionalExecOfficeType: "governor",
        isOwnHeadOfGovernmentRace: false,
      })
    ).toBe(false);
  });
});

describe("buildGovModifierByParty (approval-based)", () => {
  const inState = new Set(["2", "3"]);

  it("returns neutral (empty) when no governor", () => {
    expect(buildGovModifierByParty(null, inState).size).toBe(0);
  });

  it("returns neutral when governor's party has no state-party-org row", () => {
    expect(buildGovModifierByParty({ partyId: "9", approval: 75 }, inState).size).toBe(0);
  });

  it("50% approval → neutral 1.0x", () => {
    expect(buildGovModifierByParty({ partyId: "2", approval: 50 }, inState).get("2")).toBeCloseTo(
      1.0
    );
  });

  it("75% approval → +9% (ceiling)", () => {
    expect(buildGovModifierByParty({ partyId: "2", approval: 75 }, inState).get("2")).toBeCloseTo(
      1.09
    );
  });

  it("25% approval → -9% drag", () => {
    expect(buildGovModifierByParty({ partyId: "2", approval: 25 }, inState).get("2")).toBeCloseTo(
      0.91
    );
  });

  it("clamps beyond ±25-point swing", () => {
    expect(buildGovModifierByParty({ partyId: "2", approval: 100 }, inState).get("2")).toBeCloseTo(
      1.09
    );
    expect(buildGovModifierByParty({ partyId: "2", approval: 0 }, inState).get("2")).toBeCloseTo(
      0.91
    );
  });
});

describe("govModifierToPct", () => {
  it("converts the multiplier map to signed percentage tilts", () => {
    const out = govModifierToPct(new Map([["2", 1.045]]));
    expect(out["2"]).toBeCloseTo(4.5, 5);
  });

  it("empty map → empty record", () => {
    expect(govModifierToPct(new Map())).toEqual({});
  });
});

function makeStateMetrics(stateId: string) {
  return {
    _id: stateId,
    countryId: "US",
    economic: { medianIncome: { value: 60000 }, unemploymentRate: { value: 4 } },
    education: { highSchoolGradRate: { value: 92 } },
    healthcare: { uninsuredRate: { value: 8 } },
  };
}

describe("resolveGovExecutiveApproval", () => {
  it("returns the governor's party + computed approval", async () => {
    const db = createMockDb();
    db.collection("electedOfficials").findOne.mockResolvedValue({
      party: "2",
      officeType: "governor",
      state: "CA",
      countryId: "US",
    } as never);
    db.collection("macroMetrics").findOne.mockResolvedValue(makeStateMetrics("CA") as never);
    db.collection("macroMetrics").find.mockReturnValue({
      toArray: () => Promise.resolve([makeStateMetrics("CA"), makeStateMetrics("TX")]),
    } as never);
    const res = await resolveGovExecutiveApproval(db as unknown as Db, "US", "CA");
    expect(res?.partyId).toBe("2");
    expect(typeof res?.approval).toBe("number");
  });

  it("returns null when the office is vacant", async () => {
    const db = createMockDb();
    db.collection("electedOfficials").findOne.mockResolvedValue(null as never);
    const res = await resolveGovExecutiveApproval(db as unknown as Db, "US", "CA");
    expect(res).toBeNull();
  });
});
