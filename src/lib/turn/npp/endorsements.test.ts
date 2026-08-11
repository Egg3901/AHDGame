import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { Election, ElectionCandidate, NPP, NPPEndorsement } from "@/lib/db/types";
import type { NPPContext } from "./context";
import { processNppEndorsements } from "./endorsements";

function makeNpp(overrides: Partial<NPP> = {}): NPP {
  return {
    _id: new ObjectId(),
    name: "Endorser",
    countryId: "US",
    homeState: "CA",
    party: "democrat",
    favorability: 55,
    politicalInfluence: 35,
    policies: { economic: -2, social: -2 },
    personality: { loyalty: 50, ambition: 50, stubbornness: 25 },
    currentOffice: null,
    retiredAt: null,
    generatedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as NPP;
}

function makeElection(overrides: Partial<Election> = {}): Election {
  return {
    _id: new ObjectId(),
    countryId: "US",
    electionType: "house",
    state: "CA",
    primaryEndTime: new Date("2026-05-20T00:00:00Z"),
    endTime: new Date("2026-05-27T00:00:00Z"),
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Election;
}

function makeCandidate(
  electionId: ObjectId,
  overrides: Partial<ElectionCandidate> = {}
): ElectionCandidate {
  return {
    _id: new ObjectId(),
    electionId,
    characterId: new ObjectId(),
    characterName: "Candidate",
    party: "democrat",
    status: "active",
    isNPP: false,
    enteredAt: new Date("2026-05-01T00:00:00Z"),
    ...overrides,
  } as ElectionCandidate;
}

function makeContext(db: Db, npp: NPP, now: Date, currentTurn: number): NPPContext {
  return {
    now,
    db,
    allNPPs: [npp],
    nppMap: new Map([[npp._id.toString(), npp]]),
    openPrimaries: [],
    nppCandidacies: new Set(),
    candidatesByElection: new Map(),
    nppOfficials: [],
    officialsByNPP: new Map(),
    activeBills: [],
    billWhips: new Map(),
    activeStateBills: [],
    stateBillWhips: new Map(),
    speakerElection: null,
    speakerNominations: [],
    houseLeadershipElections: [],
    houseLeadershipNominations: [],
    senateLeadershipElections: [],
    senateLeadershipNominations: [],
    leadershipWhips: [],
    statePartyOrgs: new Map(),
    partyByCompositeKey: new Map(),
    partyCountries: new Map(),
    legislationTypeMap: new Map(),
    stateDemographicsMap: new Map(),
    statesById: new Map(),
    currentTurn,
  };
}

function makeDb(params: {
  elections?: Election[];
  candidates?: ElectionCandidate[];
  endorsements: NPPEndorsement[];
  updateOne?: ReturnType<typeof vi.fn>;
}): Db {
  const updateOne = params.updateOne ?? vi.fn().mockResolvedValue({ modifiedCount: 1 });
  return {
    collection: vi.fn((name: string) => {
      if (name === "elections") {
        return {
          find: vi.fn().mockReturnValue({
            project: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue(params.elections ?? []),
            }),
          }),
        };
      }
      if (name === "electionCandidates") {
        return {
          find: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue(params.candidates ?? []),
          }),
        };
      }
      if (name === "nppEndorsements") {
        return {
          find: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue(params.endorsements),
          }),
          updateOne,
        };
      }
      return {
        find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      };
    }),
  } as unknown as Db;
}

describe("processNppEndorsements", () => {
  it("withdraws legacy organic endorsements now that endorsements are manual-only", async () => {
    const now = new Date("2026-05-08T00:00:00Z");
    const npp = makeNpp();
    const election = makeElection();
    const candidate = makeCandidate(election._id);
    const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const db = makeDb({
      elections: [election],
      candidates: [candidate],
      endorsements: [
        {
          _id: new ObjectId(),
          nppId: npp._id,
          nppName: npp.name,
          electionId: election._id,
          candidateId: candidate.characterId,
          candidateName: candidate.characterName,
          candidateIsNPP: false,
          source: "organic",
          isActive: true,
          createdAt: new Date("2026-05-01T00:00:00Z"),
        },
      ],
      updateOne,
    });

    const summary = await processNppEndorsements(makeContext(db, npp, now, 8));

    expect(summary.withdrawn).toBe(1);
    expect(updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: true }),
      expect.objectContaining({
        $set: expect.objectContaining({
          withdrawnReason: "manual_only",
        }),
      })
    );
  });

  it("keeps arranged endorsements when the campaign is still active and relevant", async () => {
    const now = new Date("2026-05-08T00:00:00Z");
    const npp = makeNpp();
    const election = makeElection();
    const candidate = makeCandidate(election._id);
    const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const db = makeDb({
      elections: [election],
      candidates: [candidate],
      endorsements: [
        {
          _id: new ObjectId(),
          nppId: npp._id,
          nppName: npp.name,
          electionId: election._id,
          candidateId: candidate.characterId,
          candidateName: candidate.characterName,
          candidateIsNPP: false,
          source: "arranged",
          isActive: true,
          createdAt: new Date("2026-05-01T00:00:00Z"),
        },
      ],
      updateOne,
    });

    const summary = await processNppEndorsements(makeContext(db, npp, now, 8));

    expect(summary.withdrawn).toBe(0);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("withdraws arranged endorsements when the election's country no longer matches the NPP", async () => {
    const now = new Date("2026-05-08T00:00:00Z");
    const npp = makeNpp({ countryId: "US" });
    const election = makeElection({ countryId: "UK", state: "London" });
    const candidate = makeCandidate(election._id);
    const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const db = makeDb({
      elections: [election],
      candidates: [candidate],
      endorsements: [
        {
          _id: new ObjectId(),
          nppId: npp._id,
          nppName: npp.name,
          electionId: election._id,
          candidateId: candidate.characterId,
          candidateName: candidate.characterName,
          candidateIsNPP: false,
          source: "arranged",
          isActive: true,
          createdAt: new Date("2026-05-01T00:00:00Z"),
        },
      ],
      updateOne,
    });

    const summary = await processNppEndorsements(makeContext(db, npp, now, 8));

    expect(summary.withdrawn).toBe(1);
    expect(updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: true }),
      expect.objectContaining({
        $set: expect.objectContaining({
          withdrawnReason: "country_mismatch",
        }),
      })
    );
  });

  it("withdraws arranged endorsements when the candidate leaves the campaign", async () => {
    const now = new Date("2026-05-08T00:00:00Z");
    const npp = makeNpp();
    const election = makeElection();
    const candidate = makeCandidate(election._id);
    const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const db = makeDb({
      elections: [election],
      candidates: [],
      endorsements: [
        {
          _id: new ObjectId(),
          nppId: npp._id,
          nppName: npp.name,
          electionId: election._id,
          candidateId: candidate.characterId,
          candidateName: candidate.characterName,
          candidateIsNPP: false,
          source: "arranged",
          isActive: true,
          createdAt: new Date("2026-05-01T00:00:00Z"),
        },
      ],
      updateOne,
    });

    const summary = await processNppEndorsements(makeContext(db, npp, now, 8));

    expect(summary.withdrawn).toBe(1);
    expect(updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: true }),
      expect.objectContaining({
        $set: expect.objectContaining({
          withdrawnReason: "candidate_inactive",
        }),
      })
    );
  });
});
