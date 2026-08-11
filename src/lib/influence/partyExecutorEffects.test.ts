import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { ExecutePartyInfluenceInput } from "./partyExecutorTypes";
import type { NPP, PoliticalParty } from "@/lib/db/types";
import { applyPartyInfluenceEffects } from "./partyExecutorEffects";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/electionEngine/tallyCleaner", () => ({
  removeWithdrawnCandidateFromTally: vi.fn(),
}));
vi.mock("@/lib/governors/senateVacancy", () => ({
  notifyGovernorOfSenateVacancy: vi.fn(),
}));

describe("applyPartyInfluenceEffects", () => {
  let db: MockDb;

  beforeEach(async () => {
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    db.collection("states");
    db.collection("npps");
    db.collection("elections");
    db.collection("electionCandidates");
    db.collection("electedOfficials");
  });

  it("relocates an NPP to the requested target state on success", async () => {
    const nppId = new ObjectId();
    const input: ExecutePartyInfluenceInput = {
      partyId: "1",
      partyObjectId: new ObjectId(),
      countryId: "US",
      nppId,
      influenceType: "relocate_state",
      fundAmount: 0,
      actorCharacterId: new ObjectId(),
      context: {
        targetStateId: "TX",
      },
    };

    const npp = {
      _id: nppId,
      name: "Latoya O'Connor",
      homeState: "AK",
      party: "1",
      favorability: 55,
      politicalInfluence: 10,
      currentOffice: null,
      retiredAt: null,
      personality: { loyalty: 60, ambition: 50, stubbornness: 35 },
      policies: { economic: 0, social: 0 },
      generatedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as NPP;

    const party = {
      _id: new ObjectId(),
      sequentialId: 1,
      countryId: "US",
      name: "Democratic Party",
    } as PoliticalParty;

    db.collectionMocks.states.findOne.mockResolvedValue({
      _id: "TX",
      name: "Texas",
      countryId: "US",
    });
    db.collectionMocks.electionCandidates.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const result = await applyPartyInfluenceEffects(input, npp, party);

    expect(db.collectionMocks.npps.updateOne).toHaveBeenCalledWith(
      { _id: nppId },
      expect.objectContaining({
        $set: expect.objectContaining({
          homeState: "TX",
        }),
      })
    );
    expect(result).toEqual({
      messageOverride:
        "Latoya O'Connor has agreed to relocate to Texas at the Democratic Party's request.",
    });
  });

  it("auto-resigns and withdraws the NPP before relocating when they hold office and are in a race", async () => {
    const { removeWithdrawnCandidateFromTally } = await import("@/lib/electionEngine/tallyCleaner");
    const { notifyGovernorOfSenateVacancy } = await import("@/lib/governors/senateVacancy");
    const nppId = new ObjectId();
    const electionId = new ObjectId();
    const candidateId = new ObjectId();
    const input: ExecutePartyInfluenceInput = {
      partyId: "1",
      partyObjectId: new ObjectId(),
      countryId: "US",
      nppId,
      influenceType: "relocate_state",
      fundAmount: 0,
      actorCharacterId: new ObjectId(),
      context: {
        targetStateId: "TX",
      },
    };

    const npp = {
      _id: nppId,
      name: "Latoya O'Connor",
      homeState: "AK",
      party: "1",
      favorability: 55,
      politicalInfluence: 10,
      currentOffice: { type: "senate", state: "AK", senateClass: 2 },
      retiredAt: null,
      personality: { loyalty: 60, ambition: 50, stubbornness: 35 },
      policies: { economic: 0, social: 0 },
      generatedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as NPP;

    const party = {
      _id: new ObjectId(),
      sequentialId: 1,
      countryId: "US",
      name: "Democratic Party",
    } as PoliticalParty;

    db.collectionMocks.states.findOne.mockResolvedValue({
      _id: "TX",
      name: "Texas",
      countryId: "US",
    });
    db.collectionMocks.electionCandidates.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: candidateId,
          electionId,
          nppId,
          isNPP: true,
          status: "active",
        },
      ]),
    });
    db.collectionMocks.elections.find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([{ _id: electionId }]),
    });

    const result = await applyPartyInfluenceEffects(input, npp, party);

    expect(db.collectionMocks.electedOfficials.updateOne).toHaveBeenCalledWith(
      { nppId },
      expect.objectContaining({
        $set: expect.objectContaining({
          isNPP: false,
        }),
        $unset: expect.objectContaining({
          nppId: "",
        }),
      })
    );
    expect(db.collectionMocks.electionCandidates.updateMany).toHaveBeenCalledWith(
      { _id: { $in: [candidateId] } },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: "withdrawn",
        }),
      })
    );
    expect(removeWithdrawnCandidateFromTally).toHaveBeenCalledWith(
      db as unknown as Db,
      electionId,
      candidateId.toString()
    );
    expect(notifyGovernorOfSenateVacancy).toHaveBeenCalledWith(db as unknown as Db, "AK", 2);
    expect(db.collectionMocks.npps.updateOne).toHaveBeenCalledWith(
      { _id: nppId },
      expect.objectContaining({
        $set: expect.objectContaining({
          homeState: "TX",
          currentOffice: null,
        }),
      })
    );
    expect(result).toEqual({
      messageOverride:
        "Latoya O'Connor has agreed to relocate to Texas at the Democratic Party's request and resigned from office and withdrew from 1 active election.",
    });
  });
});
