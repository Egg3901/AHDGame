import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("cleanupPartyPositionsOnSwitch — campaigner cleanup (Phase D)", () => {
  let db: MockDb;
  const characterId = new ObjectId();
  const otherCampaignerId = new ObjectId();
  const partyObjectId = new ObjectId();

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("politicalParties");
    db.collection("statePartyOrg");
    db.collection("statePartyElections");
    db.collection("statePartyCandidates");
    db.collection("nationalPartyElections");
    db.collection("nationalPartyCandidates");
    db.collection("nationalCommitteeElections");
    db.collection("nationalCommitteeCandidates");
    db.collection("coalitions");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    // Default-empty active election lists. Cursor supports both `.toArray()`
    // (state/committee steps) and `.project().toArray()` (national step, via
    // withdrawFromPartyLeadershipElections).
    ["statePartyElections", "nationalPartyElections", "nationalCommitteeElections"].forEach((c) => {
      const cursor = { project: () => cursor, toArray: async () => [] };
      db.collectionMocks[c]!.find.mockReturnValue(cursor as never);
    });
  });

  it("pulls character from national campaignerIds when leaving party", async () => {
    db.collectionMocks["politicalParties"]!.findOne.mockResolvedValue({
      _id: partyObjectId,
      sequentialId: 1,
      countryId: "US",
      chairId: null,
      viceChairId: null,
      treasurerId: null,
      committeeIds: [],
      campaignerIds: [characterId, otherCampaignerId],
    });
    db.collectionMocks["statePartyOrg"]!.find.mockReturnValue({
      toArray: async () => [],
    } as never);

    const { cleanupPartyPositionsOnSwitch } = await import("./electionCandidacy");
    const result = await cleanupPartyPositionsOnSwitch(characterId, "1", "independent", "US");

    expect(result.clearedNationalLeadership).toContain("campaigner");
    expect(db.collectionMocks["politicalParties"]!.updateOne).toHaveBeenCalledWith(
      { _id: partyObjectId },
      expect.objectContaining({
        $pull: expect.objectContaining({ campaignerIds: characterId }),
      })
    );
  });

  it("clears state-party campaignerId when leaving party", async () => {
    db.collectionMocks["politicalParties"]!.findOne.mockResolvedValue({
      _id: partyObjectId,
      sequentialId: 1,
      countryId: "US",
      chairId: null,
      viceChairId: null,
      treasurerId: null,
      committeeIds: [],
      campaignerIds: [],
    });
    db.collectionMocks["statePartyOrg"]!.find.mockReturnValue({
      toArray: async () => [
        {
          _id: "CA_1",
          stateId: "CA",
          partyId: "1",
          chairId: null,
          viceChairId: null,
          treasurerId: null,
          campaignerId: characterId,
        },
      ],
    } as never);

    const { cleanupPartyPositionsOnSwitch } = await import("./electionCandidacy");
    const result = await cleanupPartyPositionsOnSwitch(characterId, "1", "independent", "US");

    expect(result.clearedStateLeadership).toEqual(
      expect.arrayContaining([expect.stringMatching(/CA: campaigner/)])
    );
    expect(db.collectionMocks["statePartyOrg"]!.updateOne).toHaveBeenCalledWith(
      { _id: "CA_1" },
      expect.objectContaining({
        $set: expect.objectContaining({ campaignerId: null }),
      })
    );
  });

  it("does not touch other parties' campaigner lists", async () => {
    // Character is a campaigner for party 1, but they're switching FROM party 2
    // (no party 1 entry will be returned by the partyId-scoped state-party find).
    db.collectionMocks["politicalParties"]!.findOne.mockResolvedValue({
      _id: partyObjectId,
      sequentialId: 2,
      countryId: "US",
      chairId: null,
      viceChairId: null,
      treasurerId: null,
      committeeIds: [],
      campaignerIds: [], // not a campaigner of party 2
    });
    db.collectionMocks["statePartyOrg"]!.find.mockReturnValue({
      toArray: async () => [],
    } as never);

    const { cleanupPartyPositionsOnSwitch } = await import("./electionCandidacy");
    const result = await cleanupPartyPositionsOnSwitch(characterId, "2", "independent", "US");

    // Should not log a campaigner clear.
    expect(result.clearedNationalLeadership).not.toContain("campaigner");
  });
});

describe("cleanupPartyPositionsOnSwitch — congressional leadership follow-up election", () => {
  let db: MockDb;
  const characterId = new ObjectId();

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();
    for (const c of [
      "politicalParties",
      "statePartyOrg",
      "statePartyElections",
      "statePartyCandidates",
      "nationalPartyElections",
      "nationalPartyCandidates",
      "nationalCommitteeElections",
      "nationalCommitteeCandidates",
      "coalitions",
      "congressLeaders",
    ]) {
      db.collection(c);
    }

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    ["statePartyElections", "nationalPartyElections", "nationalCommitteeElections"].forEach((c) => {
      const cursor = { project: () => cursor, toArray: async () => [] };
      db.collectionMocks[c]!.find.mockReturnValue(cursor as never);
    });
    db.collectionMocks["politicalParties"]!.findOne.mockResolvedValue(null);
    db.collectionMocks["statePartyOrg"]!.find.mockReturnValue({
      toArray: async () => [],
    } as never);
  });

  it("hands every held role to the leadership module, with the party being joined", async () => {
    // The switch itself no longer decides who loses their office: only the
    // role's own eligibility policy can answer that, and it lives next to the
    // races it opens. Vacating here unconditionally is what emptied the
    // Speaker's chair, which is an `any-seated` office a switch cannot cost.
    db.collectionMocks["congressLeaders"]!.find.mockReturnValue({
      toArray: async () => [
        { role: "president_pro_tempore", characterId, characterName: "Estes Kefauver" },
        { role: "speaker_of_the_house", characterId, characterName: "Estes Kefauver" },
      ],
    } as never);

    const vacateLost = vi.fn().mockResolvedValue(["president_pro_tempore"]);
    vi.doMock("@/lib/congress/leadership/reconcilePartyEligibility", () => ({
      vacateRolesLostToPartySwitch: vacateLost,
    }));

    const { cleanupPartyPositionsOnSwitch } = await import("./electionCandidacy");
    await cleanupPartyPositionsOnSwitch(characterId, "1", "2", "US");

    // The outgoing holder's name is captured before the vacate, so the feed
    // notice can name them instead of reading "Vacant".
    expect(vacateLost).toHaveBeenCalledWith(
      db,
      [
        {
          leaderRole: "president_pro_tempore",
          holderId: characterId,
          formerHolderName: "Estes Kefauver",
        },
        {
          leaderRole: "speaker_of_the_house",
          holderId: characterId,
          formerHolderName: "Estes Kefauver",
        },
      ],
      "2",
      expect.any(Date)
    );
    // The cleanup no longer writes to congressLeaders itself.
    expect(db.collectionMocks["congressLeaders"]!.updateOne).not.toHaveBeenCalled();
  });

  it("skips the leadership work entirely when the character held no roles", async () => {
    db.collectionMocks["congressLeaders"]!.find.mockReturnValue({
      toArray: async () => [],
    } as never);

    const vacateLost = vi.fn();
    vi.doMock("@/lib/congress/leadership/reconcilePartyEligibility", () => ({
      vacateRolesLostToPartySwitch: vacateLost,
    }));

    const { cleanupPartyPositionsOnSwitch } = await import("./electionCandidacy");
    await cleanupPartyPositionsOnSwitch(characterId, "1", "independent", "US");

    expect(vacateLost).not.toHaveBeenCalled();
  });

  it("still completes the party switch when the leadership follow-up throws", async () => {
    db.collectionMocks["congressLeaders"]!.find.mockReturnValue({
      toArray: async () => [{ role: "majority_leader_senate", characterId }],
    } as never);

    vi.doMock("@/lib/congress/leadership/reconcilePartyEligibility", () => ({
      vacateRolesLostToPartySwitch: vi.fn().mockRejectedValue(new Error("composition unavailable")),
    }));

    const { cleanupPartyPositionsOnSwitch } = await import("./electionCandidacy");
    await expect(
      cleanupPartyPositionsOnSwitch(characterId, "1", "independent", "US")
    ).resolves.toMatchObject({ clearedNationalLeadership: expect.any(Array) });
  });
});
