import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import {
  canDeclarePartyPosition,
  canRelocateOrRecruit,
  canSpendOnStateParty,
  canUseNationalPartyInfluence,
  canViewNationalTreasuryInsights,
  canViewPartyAnalytics,
  getNationalPartyLeadershipRole,
  isNationalCampaigner,
  isNationalPartyMember,
  isStateCampaigner,
  resolveSpenderScope,
  resolveSpenderScopeEligibility,
} from "@/lib/parties/access";

describe("party access helpers", () => {
  const chairId = new ObjectId();
  const viceChairId = new ObjectId();
  const treasurerId = new ObjectId();
  const party = {
    sequentialId: 7,
    countryId: "US",
    chairId,
    viceChairId,
    treasurerId,
  };

  it("scopes party membership by both sequential id and country", () => {
    expect(isNationalPartyMember(party as never, { party: "7", countryId: "US" })).toBe(true);
    expect(isNationalPartyMember(party as never, { party: "7", countryId: "UK" })).toBe(false);
    expect(isNationalPartyMember(party as never, { party: "8", countryId: "US" })).toBe(false);
  });

  it("returns the correct leadership role for a leader character id", () => {
    expect(getNationalPartyLeadershipRole(party as never, chairId)).toBe("chair");
    expect(getNationalPartyLeadershipRole(party as never, viceChairId)).toBe("viceChair");
    expect(getNationalPartyLeadershipRole(party as never, treasurerId)).toBe("treasurer");
    expect(getNationalPartyLeadershipRole(party as never, new ObjectId())).toBeNull();
  });

  it("allows only chair, vice chair, or admins to use national party influence", () => {
    expect(
      canUseNationalPartyInfluence(
        party as never,
        {
          isAdmin: false,
          character: { _id: chairId },
        } as never
      )
    ).toBe(true);
    expect(
      canUseNationalPartyInfluence(
        party as never,
        {
          isAdmin: false,
          character: { _id: viceChairId },
        } as never
      )
    ).toBe(true);
    expect(
      canUseNationalPartyInfluence(
        party as never,
        {
          isAdmin: false,
          character: { _id: treasurerId },
        } as never
      )
    ).toBe(false);
    expect(
      canUseNationalPartyInfluence(
        party as never,
        {
          isAdmin: true,
          character: undefined,
        } as never
      )
    ).toBe(true);
  });

  it("allows treasurers to view treasury insights even when they cannot manage influence", () => {
    expect(
      canViewNationalTreasuryInsights(
        party as never,
        {
          isAdmin: false,
          character: { _id: treasurerId },
        } as never
      )
    ).toBe(true);
  });

  it("allows moderator override on treasury insights and analytics without party membership", () => {
    const moderatorUser = {
      isAdmin: false,
      isModerator: true,
      character: { _id: new ObjectId(), party: "999", countryId: "US" },
    } as never;

    expect(canViewNationalTreasuryInsights(party as never, moderatorUser, true)).toBe(true);
    expect(canViewPartyAnalytics(party as never, moderatorUser, true)).toBe(true);
    expect(canViewPartyAnalytics(party as never, moderatorUser, false)).toBe(false);
  });
});

describe("campaigner role helpers", () => {
  const chairId = new ObjectId();
  const viceChairId = new ObjectId();
  const treasurerId = new ObjectId();
  const stateCampaignerId = new ObjectId();
  const nationalCampaignerId = new ObjectId();
  const outsiderId = new ObjectId();

  const party = {
    sequentialId: 1,
    countryId: "US",
    chairId,
    viceChairId,
    treasurerId,
    campaignerIds: [nationalCampaignerId],
  };

  const stateParty = {
    chairId: new ObjectId(),
    viceChairId: new ObjectId(),
    campaignerId: stateCampaignerId,
  };

  const mkUser = (cid: ObjectId, isAdmin = false) =>
    ({ isAdmin, character: { _id: cid } }) as never;

  it("isNationalCampaigner — matches assigned ids only", () => {
    expect(isNationalCampaigner(party as never, nationalCampaignerId)).toBe(true);
    expect(isNationalCampaigner(party as never, outsiderId)).toBe(false);
    expect(isNationalCampaigner(party as never, null)).toBe(false);
  });

  it("isStateCampaigner — matches assigned id only", () => {
    expect(isStateCampaigner(stateParty as never, stateCampaignerId)).toBe(true);
    expect(isStateCampaigner(stateParty as never, outsiderId)).toBe(false);
    expect(isStateCampaigner(null, stateCampaignerId)).toBe(false);
  });

  it("canUseNationalPartyInfluence excludes national campaigner (Build Org only)", () => {
    expect(canUseNationalPartyInfluence(party as never, mkUser(nationalCampaignerId))).toBe(false);
  });

  it("canSpendOnStateParty — chair / vice / state campaigner / national chair / national campaigner / admin all allowed", () => {
    expect(
      canSpendOnStateParty(party as never, stateParty as never, mkUser(stateParty.chairId))
    ).toBe(true);
    expect(
      canSpendOnStateParty(party as never, stateParty as never, mkUser(stateParty.viceChairId))
    ).toBe(true);
    expect(
      canSpendOnStateParty(party as never, stateParty as never, mkUser(stateCampaignerId))
    ).toBe(true);
    expect(canSpendOnStateParty(party as never, stateParty as never, mkUser(chairId))).toBe(true);
    expect(canSpendOnStateParty(party as never, stateParty as never, mkUser(viceChairId))).toBe(
      true
    );
    expect(
      canSpendOnStateParty(party as never, stateParty as never, mkUser(nationalCampaignerId))
    ).toBe(true);
    expect(
      canSpendOnStateParty(party as never, stateParty as never, mkUser(outsiderId, true))
    ).toBe(true);
  });

  it("canSpendOnStateParty — treasurer and outsider are NOT allowed", () => {
    expect(canSpendOnStateParty(party as never, stateParty as never, mkUser(treasurerId))).toBe(
      false
    );
    expect(canSpendOnStateParty(party as never, stateParty as never, mkUser(outsiderId))).toBe(
      false
    );
  });

  it("canRelocateOrRecruit — campaigners EXCLUDED, chair / vice / admin only", () => {
    // Both campaigner roles should fail
    expect(
      canRelocateOrRecruit(party as never, stateParty as never, mkUser(nationalCampaignerId))
    ).toBe(false);
    expect(
      canRelocateOrRecruit(party as never, stateParty as never, mkUser(stateCampaignerId))
    ).toBe(false);

    // Chair + vice + admin should succeed
    expect(canRelocateOrRecruit(party as never, stateParty as never, mkUser(chairId))).toBe(true);
    expect(canRelocateOrRecruit(party as never, stateParty as never, mkUser(viceChairId))).toBe(
      true
    );
    expect(
      canRelocateOrRecruit(party as never, stateParty as never, mkUser(stateParty.chairId))
    ).toBe(true);
    expect(
      canRelocateOrRecruit(party as never, stateParty as never, mkUser(outsiderId, true))
    ).toBe(true);
  });
});

describe("resolveSpenderScopeEligibility + resolveSpenderScope (dual-pool)", () => {
  const nationalChairId = new ObjectId();
  const nationalCampaignerId = new ObjectId();
  const stateChairId = new ObjectId();
  const stateCampaignerId = new ObjectId();
  const dualId = new ObjectId(); // national chair AND state chair
  const outsiderId = new ObjectId();

  const party = {
    sequentialId: 1,
    countryId: "US",
    chairId: nationalChairId,
    viceChairId: new ObjectId(),
    treasurerId: new ObjectId(),
    campaignerIds: [nationalCampaignerId],
  };

  const stateParty = {
    chairId: stateChairId,
    viceChairId: new ObjectId(),
    campaignerId: stateCampaignerId,
  };

  const mkUser = (cid: ObjectId | undefined, isAdmin = false) =>
    ({ isAdmin, character: cid ? { _id: cid } : undefined }) as never;

  it("eligibility: state-only role → { state:true, national:false }", () => {
    expect(
      resolveSpenderScopeEligibility(party as never, stateParty as never, mkUser(stateChairId))
    ).toEqual({ state: true, national: false });
    expect(
      resolveSpenderScopeEligibility(party as never, stateParty as never, mkUser(stateCampaignerId))
    ).toEqual({ state: true, national: false });
  });

  it("eligibility: national-only role → { state:false, national:true }", () => {
    expect(
      resolveSpenderScopeEligibility(party as never, stateParty as never, mkUser(nationalChairId))
    ).toEqual({ state: false, national: true });
    expect(
      resolveSpenderScopeEligibility(
        party as never,
        stateParty as never,
        mkUser(nationalCampaignerId)
      )
    ).toEqual({ state: false, national: true });
  });

  it("eligibility: dual role → { state:true, national:true }", () => {
    const dualParty = { ...party, chairId: dualId };
    const dualStateParty = { ...stateParty, chairId: dualId };
    expect(
      resolveSpenderScopeEligibility(dualParty as never, dualStateParty as never, mkUser(dualId))
    ).toEqual({ state: true, national: true });
  });

  it("eligibility: admin follows real roles, not a blanket override; outsider/no-char → both false", () => {
    // Admin with no party role → no special pool eligibility.
    expect(
      resolveSpenderScopeEligibility(party as never, stateParty as never, mkUser(outsiderId, true))
    ).toEqual({ state: false, national: false });
    // Admin who is the national chair → national eligibility only.
    expect(
      resolveSpenderScopeEligibility(
        party as never,
        stateParty as never,
        mkUser(nationalChairId, true)
      )
    ).toEqual({ state: false, national: true });
    // Admin who is the state chair → state eligibility only.
    expect(
      resolveSpenderScopeEligibility(
        party as never,
        stateParty as never,
        mkUser(stateChairId, true)
      )
    ).toEqual({ state: true, national: false });
    // Non-admin outsider / no character → both false.
    expect(
      resolveSpenderScopeEligibility(party as never, stateParty as never, mkUser(outsiderId))
    ).toEqual({ state: false, national: false });
    expect(
      resolveSpenderScopeEligibility(party as never, stateParty as never, mkUser(undefined))
    ).toEqual({ state: false, national: false });
  });

  it("resolveSpenderScope: no preference keeps current state-first default", () => {
    expect(resolveSpenderScope(party as never, stateParty as never, mkUser(stateChairId))).toBe(
      "state"
    );
    expect(resolveSpenderScope(party as never, stateParty as never, mkUser(nationalChairId))).toBe(
      "national-targeted"
    );
  });

  it("resolveSpenderScope: dual holder honored to the requested pool", () => {
    const dualParty = { ...party, chairId: dualId };
    const dualStateParty = { ...stateParty, chairId: dualId };
    expect(
      resolveSpenderScope(dualParty as never, dualStateParty as never, mkUser(dualId), "state")
    ).toBe("state");
    expect(
      resolveSpenderScope(
        dualParty as never,
        dualStateParty as never,
        mkUser(dualId),
        "national-targeted"
      )
    ).toBe("national-targeted");
    // No preference → State default for the dual holder.
    expect(resolveSpenderScope(dualParty as never, dualStateParty as never, mkUser(dualId))).toBe(
      "state"
    );
  });

  it("resolveSpenderScope: ineligible preference is ignored, falls back to default", () => {
    // State-only chair asks for national → not eligible → default (state).
    expect(
      resolveSpenderScope(
        party as never,
        stateParty as never,
        mkUser(stateChairId),
        "national-targeted"
      )
    ).toBe("state");
    // National-only chair asks for state → not eligible → default (national).
    expect(
      resolveSpenderScope(party as never, stateParty as never, mkUser(nationalChairId), "state")
    ).toBe("national-targeted");
  });
});

describe("canDeclarePartyPosition", () => {
  const CHAR = new ObjectId();
  const party = (over: Record<string, unknown> = {}) =>
    ({ sequentialId: 8, countryId: "UK", chairId: null, viceChairId: null, ...over }) as never;
  const user = (over: Record<string, unknown> = {}) =>
    ({
      isAdmin: false,
      character: { _id: CHAR, party: "8", countryId: "UK" },
      ...over,
    }) as never;

  it("allows the state chair", () => {
    expect(
      canDeclarePartyPosition(party(), { chairId: CHAR, viceChairId: null } as never, user())
    ).toBe(true);
  });
  it("allows the state vice-chair", () => {
    expect(
      canDeclarePartyPosition(party(), { chairId: null, viceChairId: CHAR } as never, user())
    ).toBe(true);
  });
  it("allows the national chair / vice-chair", () => {
    expect(canDeclarePartyPosition(party({ chairId: CHAR }), null, user())).toBe(true);
    expect(canDeclarePartyPosition(party({ viceChairId: CHAR }), null, user())).toBe(true);
  });
  it("allows an admin", () => {
    expect(canDeclarePartyPosition(party(), null, user({ isAdmin: true }))).toBe(true);
  });
  it("denies a plain member / campaigner", () => {
    expect(
      canDeclarePartyPosition(
        party(),
        { chairId: new ObjectId(), viceChairId: null } as never,
        user()
      )
    ).toBe(false);
  });
});
