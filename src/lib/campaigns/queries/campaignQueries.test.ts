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
});
