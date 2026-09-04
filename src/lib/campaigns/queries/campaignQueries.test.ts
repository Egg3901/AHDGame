import { describe, expect, it, beforeEach, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { AuthUserWithCharacter } from "@/lib/auth";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Campaign, Character, Election } from "@/lib/db/types";

// getCampaignDetail reads game time via getGameTime to detect the general-phase
// upgrade surcharge; stub it (keep real hasGameTimePassed for the Date fallback).
// currentTurn=5 leaves bound-less elections in the primary phase (no surcharge).
vi.mock("@/lib/time/gameTime", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/time/gameTime")>()),
  getGameTime: vi.fn().mockResolvedValue({
    currentTurn: 5,
    effectiveNow: new Date(),
    lastTurnProcessed: new Date(),
    isActive: true,
    pausedAt: null,
    startingYear: 2019,
  }),
}));

import { getCampaignDetail, getViewerCampaigns } from "./campaignQueries";

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
});

describe("getViewerCampaigns", () => {
  it("finds a user's campaign when the candidate is an inactive owned profile", async () => {
    const userId = new ObjectId();
    const activeCharacterId = new ObjectId();
    const inactiveCandidateId = new ObjectId();
    const campaignId = new ObjectId();
    const electionId = new ObjectId();

    const user: AuthUserWithCharacter = {
      userId: userId.toString(),
      username: "tester",
      email: "test@example.com",
      role: "user",
      hasCharacter: true,
      character: {
        _id: activeCharacterId,
        userId,
        name: "Active Profile",
        countryId: "US",
        party: "1",
      } as Character,
    };

    db.collection("characters");
    db.collection("campaigns");
    db.collection("elections");

    db.collectionMocks["characters"]!.find.mockReturnValue({
      toArray: async () => [{ _id: activeCharacterId }, { _id: inactiveCandidateId }],
    } as never);

    db.collectionMocks["campaigns"]!.findOne.mockImplementation(async (query) => {
      if ("$or" in (query as Record<string, unknown>)) {
        return {
          _id: campaignId,
          electionId,
          candidateId: inactiveCandidateId,
          candidateIsNPP: false,
        } as Campaign;
      }
      return null;
    });

    db.collectionMocks["elections"]!.find.mockReturnValue({
      toArray: async () => [
        {
          _id: electionId,
          countryId: "US",
          electionType: "president",
        } as Election,
      ],
    } as never);

    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: inactiveCandidateId,
      name: "Inactive Candidate",
    });

    const result = await getViewerCampaigns(db as never, user);

    expect(result.myCampaign).toEqual({
      id: campaignId.toString(),
      candidateName: "Inactive Candidate",
      electionType: "president",
    });
  });

  it("finds the same-country party campaign instead of dropping it on sequentialId collisions", async () => {
    const userId = new ObjectId();
    const activeCharacterId = new ObjectId();
    const myCampaignId = new ObjectId();
    const foreignCampaignId = new ObjectId();
    const sameCountryCampaignId = new ObjectId();
    const myElectionId = new ObjectId();
    const foreignElectionId = new ObjectId();
    const sameCountryElectionId = new ObjectId();

    const user: AuthUserWithCharacter = {
      userId: userId.toString(),
      username: "tester",
      email: "test@example.com",
      role: "user",
      hasCharacter: true,
      character: {
        _id: activeCharacterId,
        userId,
        name: "Active Profile",
        countryId: "US",
        party: "6",
      } as Character,
    };

    db.collection("characters");
    db.collection("campaigns");
    db.collection("elections");

    db.collectionMocks["characters"]!.find.mockReturnValue({
      toArray: async () => [{ _id: activeCharacterId }],
    } as never);

    db.collectionMocks["campaigns"]!.findOne.mockImplementation(async (query) => {
      const record = query as Record<string, unknown>;
      if ("$or" in record) {
        return {
          _id: myCampaignId,
          electionId: myElectionId,
          candidateId: activeCharacterId,
          candidateIsNPP: false,
        } as Campaign;
      }
      if (record.party === "6" && "electionId" in record) {
        return {
          _id: sameCountryCampaignId,
          electionId: sameCountryElectionId,
          candidateId: new ObjectId(),
          candidateIsNPP: false,
        } as Campaign;
      }
      if (record.party === "6") {
        return {
          _id: foreignCampaignId,
          electionId: foreignElectionId,
          candidateId: new ObjectId(),
          candidateIsNPP: false,
        } as Campaign;
      }
      return null;
    });

    db.collectionMocks["elections"]!.find.mockImplementation((query) => {
      const record = query as Record<string, unknown>;
      if ("countryId" in record) {
        return {
          toArray: async () => [
            { _id: sameCountryElectionId, countryId: "US", electionType: "president" } as Election,
          ],
        } as never;
      }
      return {
        toArray: async () => [
          { _id: myElectionId, countryId: "US", electionType: "president" } as Election,
          { _id: sameCountryElectionId, countryId: "US", electionType: "president" } as Election,
        ],
      } as never;
    });

    db.collectionMocks["characters"]!.findOne.mockResolvedValue({ name: "Candidate" });

    const result = await getViewerCampaigns(db as never, user);

    expect(result.partyCampaign).toEqual({
      id: sameCountryCampaignId.toString(),
      candidateName: "Candidate",
      electionType: "president",
    });
  });
});

describe("getCampaignDetail", () => {
  it("returns owner access and exact values for a user who owns the inactive candidate profile", async () => {
    const userId = new ObjectId();
    const activeCharacterId = new ObjectId();
    const inactiveCandidateId = new ObjectId();
    const campaignId = new ObjectId();
    const electionId = new ObjectId();

    const user: AuthUserWithCharacter = {
      userId: userId.toString(),
      username: "tester",
      email: "test@example.com",
      role: "user",
      hasCharacter: true,
      character: {
        _id: activeCharacterId,
        userId,
        name: "Active Profile",
        countryId: "US",
        party: "1",
      } as Character,
    };

    const campaign = {
      _id: campaignId,
      electionId,
      candidateId: inactiveCandidateId,
      candidateIsNPP: false,
      party: "1",
      managerId: null,
      managerCharacterId: null,
      funds: 125000,
      actions: 22,
      fundraisingLevel: 2,
      oppositionResearchLevel: 1,
      groundGameLevel: 0,
      mediaSpendingLevel: 0,
      oppositionTargetId: null,
      oppositionTargetName: null,
      oppositionResearchCooldownUntil: null,
      donationLog: [],
      publicFogOfWar: {
        fundraisingLevel: 1,
        oppositionResearchLevel: 0,
        groundGameLevel: 0,
        mediaSpendingLevel: 0,
        lastUpdated: new Date("2026-05-01T00:00:00Z"),
      },
      partyFogOfWar: {
        fundraisingLevel: 2,
        oppositionResearchLevel: 1,
        groundGameLevel: 0,
        mediaSpendingLevel: 0,
        lastUpdated: new Date("2026-05-01T00:00:00Z"),
      },
      activityHistory: [],
      totalFundsGenerated: 0,
      totalFundsSpent: 0,
      totalActionsGenerated: 0,
      totalActionsSpent: 0,
      campaignStrength: 7,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Campaign;

    db.collection("campaigns");
    db.collection("characters");
    db.collection("elections");
    db.collection("nppEndorsements");
    db.collection("playerEndorsements");
    db.collection("politicalParties");

    db.collectionMocks["campaigns"]!.findOne.mockResolvedValue(campaign);
    db.collectionMocks["characters"]!.findOne.mockImplementation(async (query) => {
      const record = query as Record<string, unknown>;
      if (
        record._id instanceof ObjectId &&
        record._id.equals(inactiveCandidateId) &&
        !record.userId
      ) {
        return { _id: inactiveCandidateId, name: "Inactive Candidate" };
      }
      if (
        record._id instanceof ObjectId &&
        record._id.equals(inactiveCandidateId) &&
        record.userId instanceof ObjectId &&
        record.userId.equals(userId)
      ) {
        return { _id: inactiveCandidateId };
      }
      return null;
    });
    db.collectionMocks["elections"]!.findOne.mockResolvedValue({
      _id: electionId,
      countryId: "US",
      state: "US",
      electionType: "president",
      cycle: 2028,
      senateClass: null,
      status: "active",
    });
    db.collectionMocks["nppEndorsements"]!.countDocuments.mockResolvedValue(0);
    db.collectionMocks["playerEndorsements"]!.countDocuments.mockResolvedValue(0);
    db.collectionMocks["politicalParties"]!.findOne.mockResolvedValue(null);

    const detail = await getCampaignDetail(db as never, campaignId, user);

    expect(detail.accessLevel).toBe("owner");
    expect(detail.funds).toBe(125000);
    expect(detail.actions).toBe(22);
    expect(detail.levels.fundraising).toBe(2);
  });

  it("applies the general-phase surcharge to nextUpgradeCosts so the UI matches the gate", async () => {
    const userId = new ObjectId();
    const candidateId = new ObjectId();
    const campaignId = new ObjectId();
    const electionId = new ObjectId();

    const user: AuthUserWithCharacter = {
      userId: userId.toString(),
      username: "tester",
      email: "test@example.com",
      role: "user",
      hasCharacter: true,
      character: {
        _id: candidateId,
        userId,
        name: "Nominee",
        countryId: "US",
        party: "1",
      } as Character,
    };

    const campaign = {
      _id: campaignId,
      electionId,
      candidateId,
      candidateIsNPP: false,
      party: "1",
      managerId: null,
      managerCharacterId: null,
      funds: 1_000_000,
      actions: 100,
      fundraisingLevel: 0, // next = L1: base $50k funds, 10 actions
      oppositionResearchLevel: 0,
      groundGameLevel: 0,
      mediaSpendingLevel: 0,
      oppositionTargetId: null,
      oppositionTargetName: null,
      oppositionResearchCooldownUntil: null,
      donationLog: [],
      publicFogOfWar: {
        fundraisingLevel: 0,
        oppositionResearchLevel: 0,
        groundGameLevel: 0,
        mediaSpendingLevel: 0,
        lastUpdated: new Date("2026-05-01T00:00:00Z"),
      },
      partyFogOfWar: {
        fundraisingLevel: 0,
        oppositionResearchLevel: 0,
        groundGameLevel: 0,
        mediaSpendingLevel: 0,
        lastUpdated: new Date("2026-05-01T00:00:00Z"),
      },
      activityHistory: [],
      totalFundsGenerated: 0,
      totalFundsSpent: 0,
      totalActionsGenerated: 0,
      totalActionsSpent: 0,
      campaignStrength: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Campaign;

    db.collection("campaigns");
    db.collection("characters");
    db.collection("elections");
    db.collection("nppEndorsements");
    db.collection("playerEndorsements");
    db.collection("politicalParties");
    db.collection("electionCandidates");
    db.collection("exchangeRates");

    db.collectionMocks["campaigns"]!.findOne.mockResolvedValue(campaign);
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: candidateId,
      name: "Nominee",
    });
    // General phase: primary closed (turn 5 >= 3), election not ended (5 < 10).
    db.collectionMocks["elections"]!.findOne.mockResolvedValue({
      _id: electionId,
      countryId: "US",
      state: "US",
      electionType: "president",
      cycle: 2028,
      senateClass: null,
      status: "active",
      primaryEndTurn: 3,
      endTurn: 10,
    });
    db.collectionMocks["nppEndorsements"]!.countDocuments.mockResolvedValue(0);
    db.collectionMocks["playerEndorsements"]!.countDocuments.mockResolvedValue(0);
    db.collectionMocks["politicalParties"]!.findOne.mockResolvedValue(null);
    db.collectionMocks["electionCandidates"]!.findOne.mockResolvedValue(null);
    db.collectionMocks["exchangeRates"]!.findOne.mockResolvedValue(null); // rate 1.0

    const detail = await getCampaignDetail(db as never, campaignId, user);

    // L1 fundraising base = $50k / 10 actions; general phase surcharges both ×1.5.
    expect(detail.nextUpgradeCosts?.fundraising?.funds).toBe(75_000);
    expect(detail.nextUpgradeCosts?.fundraising?.actions).toBe(15);
  });

  /** Minimal owner-nominee campaign fixture, president race. `candidateId` is
   *  the authenticated character so the nominee fast-path grants owner access. */
  function ownerPresidentCampaign(
    candidateId: ObjectId,
    electionId: ObjectId,
    campaignId: ObjectId
  ) {
    return {
      _id: campaignId,
      electionId,
      candidateId,
      candidateIsNPP: false,
      party: "1",
      managerId: null,
      managerCharacterId: null,
      funds: 500_000,
      actions: 40,
      fundraisingLevel: 1,
      oppositionResearchLevel: 0,
      groundGameLevel: 0,
      mediaSpendingLevel: 0,
      oppositionTargetId: null,
      oppositionTargetName: null,
      oppositionResearchCooldownUntil: null,
      donationLog: [],
      publicFogOfWar: {
        fundraisingLevel: 0,
        oppositionResearchLevel: 0,
        groundGameLevel: 0,
        mediaSpendingLevel: 0,
        lastUpdated: new Date("2026-05-01T00:00:00Z"),
      },
      partyFogOfWar: {
        fundraisingLevel: 0,
        oppositionResearchLevel: 0,
        groundGameLevel: 0,
        mediaSpendingLevel: 0,
        lastUpdated: new Date("2026-05-01T00:00:00Z"),
      },
      activityHistory: [],
      totalFundsGenerated: 0,
      totalFundsSpent: 0,
      totalActionsGenerated: 0,
      totalActionsSpent: 0,
      campaignStrength: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as Campaign;
  }

  function nomineeUser(candidateId: ObjectId, userId: ObjectId): AuthUserWithCharacter {
    return {
      userId: userId.toString(),
      username: "tester",
      email: "test@example.com",
      role: "user",
      hasCharacter: true,
      character: {
        _id: candidateId,
        userId,
        name: "Nominee",
        countryId: "US",
        party: "1",
      } as Character,
    };
  }

  function registerCampaignCollections() {
    db.collection("campaigns");
    db.collection("characters");
    db.collection("elections");
    db.collection("nppEndorsements");
    db.collection("playerEndorsements");
    db.collection("politicalParties");
    db.collection("electionCandidates");
    db.collection("electionVoteTallies");
    db.collection("gameState");
    db.collection("states");
    db.collection("gameConfig");
    db.collectionMocks["nppEndorsements"]!.countDocuments.mockResolvedValue(0);
    db.collectionMocks["playerEndorsements"]!.countDocuments.mockResolvedValue(0);
    db.collectionMocks["politicalParties"]!.findOne.mockResolvedValue(null);
    db.collectionMocks["gameState"]!.findOne.mockResolvedValue({
      _id: "current",
      preset: undefined,
    });
  }

  it("gives an owner a delegate-path briefing with coalition weakness in the primary phase", async () => {
    const userId = new ObjectId();
    const candidateId = new ObjectId();
    const campaignId = new ObjectId();
    const electionId = new ObjectId();
    const rowId = new ObjectId();
    const rivalId = new ObjectId();

    const campaign = ownerPresidentCampaign(candidateId, electionId, campaignId);
    registerCampaignCollections();
    db.collectionMocks["campaigns"]!.findOne.mockResolvedValue(campaign);
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: candidateId,
      name: "Nominee",
    });
    // Primary phase: primary still open (turn 5 < 8), not ended (5 < 12).
    db.collectionMocks["elections"]!.findOne.mockResolvedValue({
      _id: electionId,
      countryId: "US",
      state: "US",
      electionType: "president",
      cycle: 2028,
      senateClass: null,
      status: "active",
      primaryEndTurn: 8,
      endTurn: 12,
    });
    // The owner's electionCandidate row — id used as the tally/ledger/delegate key.
    db.collectionMocks["electionCandidates"]!.find.mockReturnValue({
      toArray: async () => [
        { _id: rowId, status: "withdrawn", electionId, characterId: candidateId },
      ],
    } as never);
    db.collectionMocks["electionVoteTallies"]!.findOne.mockResolvedValue({
      _id: electionId,
      electionId,
      candidateNames: { [rowId.toString()]: "Nominee", [rivalId.toString()]: "Rival" },
      primaryDelegates: { "1": { [rowId.toString()]: 120, [rivalId.toString()]: 80 } },
      factorLedger: {
        recordedTurn: 5,
        byCandidateNational: [
          {
            candidateId: rowId.toString(),
            nominalWeight: 0,
            finalVotes: 0,
            factors: [],
            bucketAppeal: [
              {
                candidateId: rowId.toString(),
                bucket: "race:white",
                appealShare: 0.5,
                demoEP: 0.1,
                demoSP: 0.2,
              },
              {
                candidateId: rowId.toString(),
                bucket: "race:black",
                appealShare: 0.1,
                demoEP: -0.3,
                demoSP: -0.2,
              },
            ],
          },
        ],
      },
      totalVotesByUnit: {},
    });

    const detail = await getCampaignDetail(
      db as never,
      campaignId,
      nomineeUser(candidateId, userId)
    );

    expect(detail.accessLevel).toBe("owner");
    expect(detail.briefing).toBeDefined();
    expect(detail.briefing?.path?.kind).toBe("delegate");
    if (detail.briefing?.path?.kind === "delegate") {
      expect(detail.briefing.path.won).toBe(120);
      expect(detail.briefing.path.needed).toBeGreaterThan(0);
      expect(detail.briefing.path.leaders[0]).toMatchObject({ delegates: 120, name: "Nominee" });
    }
    // Weakest census bucket sorts first (0.1 < 0.5) — buckets, never archetypes.
    expect(detail.briefing?.coalitionWeakness[0]?.bucket).toBe("race:black");
    expect(detail.briefing?.cashRunway.funds).toBe(500_000);
  });

  it("gives an owner a tipping-point EV briefing in the general phase", async () => {
    const userId = new ObjectId();
    const candidateId = new ObjectId();
    const campaignId = new ObjectId();
    const electionId = new ObjectId();
    const rowId = new ObjectId();
    const rivalId = new ObjectId();

    const campaign = ownerPresidentCampaign(candidateId, electionId, campaignId);
    registerCampaignCollections();
    db.collectionMocks["campaigns"]!.findOne.mockResolvedValue(campaign);
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: candidateId,
      name: "Nominee",
    });
    // General phase: primary closed (5 >= 3), not ended (5 < 10).
    db.collectionMocks["elections"]!.findOne.mockResolvedValue({
      _id: electionId,
      countryId: "US",
      state: "US",
      electionType: "president",
      cycle: 2028,
      senateClass: null,
      status: "active",
      primaryEndTurn: 3,
      endTurn: 10,
    });
    db.collectionMocks["electionCandidates"]!.find.mockReturnValue({
      toArray: async () => [
        { _id: rowId, status: "withdrawn", electionId, characterId: candidateId },
      ],
    } as never);
    // states.find backs both loadApportionment and the tipping name map.
    db.collectionMocks["states"]!.find.mockReturnValue({
      toArray: async () => [
        { _id: "CA", name: "California" },
        { _id: "TX", name: "Texas" },
      ],
    } as never);
    db.collectionMocks["electionVoteTallies"]!.findOne.mockResolvedValue({
      _id: electionId,
      electionId,
      candidateNames: { [rowId.toString()]: "Nominee", [rivalId.toString()]: "Rival" },
      totalVotesByUnit: {
        CA: { [rowId.toString()]: 100, [rivalId.toString()]: 90 },
        TX: { [rowId.toString()]: 40, [rivalId.toString()]: 100 },
      },
    });

    const detail = await getCampaignDetail(
      db as never,
      campaignId,
      nomineeUser(candidateId, userId)
    );

    expect(detail.accessLevel).toBe("owner");
    expect(detail.briefing?.path?.kind).toBe("tipping");
    if (detail.briefing?.path?.kind === "tipping") {
      expect(detail.briefing.path.evNeeded).toBe(270);
      expect(detail.briefing.path.evHave).toBeGreaterThan(0);
      // CA is the closest state (5.3pt) and sorts ahead of TX (42.9pt).
      expect(detail.briefing.path.tippingStates[0]).toMatchObject({
        stateId: "CA",
        name: "California",
      });
    }
  });

  it("withholds the briefing from a non-owner viewer (fog of war)", async () => {
    const userId = new ObjectId();
    const candidateId = new ObjectId();
    const viewerCharacterId = new ObjectId();
    const campaignId = new ObjectId();
    const electionId = new ObjectId();

    const campaign = ownerPresidentCampaign(candidateId, electionId, campaignId);
    registerCampaignCollections();
    db.collectionMocks["campaigns"]!.findOne.mockResolvedValue(campaign);
    // Candidate name lookup returns the candidate; ownership lookup returns null
    // so the viewer is neither nominee nor manager.
    db.collectionMocks["characters"]!.findOne.mockImplementation(async (query) => {
      const record = query as Record<string, unknown>;
      if (record._id instanceof ObjectId && record._id.equals(candidateId) && !record.userId) {
        return { _id: candidateId, name: "Nominee" };
      }
      return null;
    });
    db.collectionMocks["elections"]!.findOne.mockResolvedValue({
      _id: electionId,
      countryId: "US",
      state: "US",
      electionType: "president",
      cycle: 2028,
      senateClass: null,
      status: "active",
      primaryEndTurn: 8,
      endTurn: 12,
    });

    const viewer: AuthUserWithCharacter = {
      userId: userId.toString(),
      username: "rival",
      email: "rival@example.com",
      role: "user",
      hasCharacter: true,
      character: {
        _id: viewerCharacterId,
        userId,
        name: "Rival Op",
        countryId: "US",
        party: "2",
      } as Character,
    };

    const detail = await getCampaignDetail(db as never, campaignId, viewer);

    expect(detail.accessLevel).not.toBe("owner");
    expect(detail.briefing).toBeUndefined();
  });
});
