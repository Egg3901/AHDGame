import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { Election, ElectionCandidate, NPP } from "@/lib/db/types";
import {
  buildActiveVisibleNppEndorsementFilter,
  getRequestedEndorsementLikelihood,
  getRequestedEndorsementRelationshipRequirement,
  getNppElectionRelevanceScore,
  isSelfEndorsementCandidate,
  nppCanPlausiblyEndorseElection,
  upsertNppEndorsement,
} from "./nppEndorsements";

function makeNpp(overrides: Partial<NPP> = {}): NPP {
  return {
    _id: new ObjectId(),
    countryId: "US",
    party: "democrat",
    name: "Test NPP",
    homeState: "CA",
    favorability: 55,
    politicalInfluence: 40,
    policies: { economic: -2, social: -2 },
    retired: false,
    currentOffice: null,
    ...overrides,
  } as NPP;
}

function makeElection(overrides: Partial<Election> = {}): Election {
  return {
    _id: new ObjectId(),
    countryId: "US",
    electionType: "house",
    state: "CA",
    primaryEndTime: new Date("2026-05-10T00:00:00Z"),
    endTime: new Date("2026-05-20T00:00:00Z"),
    status: "active",
    ...overrides,
  } as Election;
}

function makeCandidate(overrides: Partial<ElectionCandidate> = {}): ElectionCandidate {
  return {
    _id: new ObjectId(),
    electionId: new ObjectId(),
    characterId: new ObjectId(),
    characterName: "Candidate One",
    party: "democrat",
    isNPP: false,
    status: "active",
    enteredAt: new Date("2026-05-01T00:00:00Z"),
    ...overrides,
  } as ElectionCandidate;
}

describe("nppEndorsements", () => {
  it("treats any same-country race as a plausible endorsement target while preserving the relevance score", () => {
    const npp = makeNpp();
    const homeStateHouse = makeElection({ electionType: "house", state: "CA" });
    const farAwayGovernor = makeElection({ electionType: "governor", state: "TX" });
    const presidential = makeElection({ electionType: "president", state: undefined });
    const foreignElection = makeElection({
      countryId: "UK",
      electionType: "house",
      state: "London",
    });

    expect(nppCanPlausiblyEndorseElection(npp, homeStateHouse)).toBe(true);
    expect(nppCanPlausiblyEndorseElection(npp, farAwayGovernor)).toBe(true);
    expect(nppCanPlausiblyEndorseElection(npp, presidential)).toBe(true);
    expect(nppCanPlausiblyEndorseElection(npp, foreignElection)).toBe(false);

    // Organic priority still distinguishes near vs. far races even though the
    // Campaign Manager gate has been relaxed.
    expect(getNppElectionRelevanceScore(npp, farAwayGovernor)).toBe(0);
    expect(getNppElectionRelevanceScore(npp, homeStateHouse)).toBeGreaterThan(0);
  });

  it("uses policy distance to set the hidden relationship requirement for endorsement requests", () => {
    const npp = makeNpp({ policies: { economic: -2, social: -2 } });

    expect(
      getRequestedEndorsementRelationshipRequirement(npp, {
        policies: { economic: -2, social: -2 },
      })
    ).toBe(40);
    expect(
      getRequestedEndorsementRelationshipRequirement(npp, {
        policies: { economic: 3, social: 3 },
      })
    ).toBe(50);
    expect(getRequestedEndorsementLikelihood(44, 44)).toBe("likely_accept");
    expect(getRequestedEndorsementLikelihood(39, 40)).toBe("likely_decline");
  });

  it("hides legacy organic endorsements while keeping arranged and source-less legacy rows visible", () => {
    expect(
      buildActiveVisibleNppEndorsementFilter({
        electionId: new ObjectId(),
        candidateId: new ObjectId(),
      })
    ).toEqual({
      $and: [
        {
          electionId: expect.any(ObjectId),
          candidateId: expect.any(ObjectId),
        },
        { isActive: true },
        {
          $or: [{ source: { $exists: false } }, { source: "arranged" }],
        },
      ],
    });
  });

  it("refuses self-endorsement for NPP candidates", () => {
    const nppId = new ObjectId();
    const npp = makeNpp({ _id: nppId });
    const candidate = makeCandidate({ isNPP: true, nppId, characterId: new ObjectId() });

    expect(isSelfEndorsementCandidate(npp, candidate)).toBe(true);
  });

  it("does not try to set and unset arranged metadata on the same update", async () => {
    const npp = makeNpp();
    const electionId = new ObjectId();
    const candidate = makeCandidate({ electionId });
    const existingId = new ObjectId();
    const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 0 });

    const db = {
      collection: vi.fn(() => ({
        find: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            {
              _id: existingId,
              nppId: npp._id,
              electionId,
              candidateId: candidate.characterId,
              isActive: true,
            },
          ]),
        }),
        updateOne,
        insertOne: vi.fn(),
        updateMany,
      })),
    } as unknown as Db;

    await upsertNppEndorsement(db, {
      npp,
      candidate,
      source: "organic",
      now: new Date("2026-05-01T00:00:00Z"),
      currentTurn: 8,
      candidateCountAtDecision: 2,
      electionPhaseAtDecision: "primary",
    });

    const [, update] = updateOne.mock.calls[0] as [
      Record<string, unknown>,
      { $set: Record<string, unknown>; $unset: Record<string, unknown> },
    ];
    expect(Object.keys(update.$set)).not.toContain("arrangedBy");
    expect(Object.keys(update.$set)).not.toContain("arrangedByParty");
    expect(update.$unset).toEqual(
      expect.objectContaining({
        arrangedBy: "",
        arrangedByParty: "",
      })
    );
  });

  it("no-ops self-endorsement upserts", async () => {
    const nppId = new ObjectId();
    const npp = makeNpp({ _id: nppId });
    const electionId = new ObjectId();
    const candidate = makeCandidate({
      electionId,
      isNPP: true,
      nppId,
      characterId: new ObjectId(),
    });
    const insertOne = vi.fn();
    const updateOne = vi.fn();

    const db = {
      collection: vi.fn(() => ({
        find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
        updateOne,
        insertOne,
        updateMany: vi.fn(),
      })),
    } as unknown as Db;

    await upsertNppEndorsement(db, {
      npp,
      candidate,
      source: "arranged",
      now: new Date("2026-05-01T00:00:00Z"),
      currentTurn: 8,
      candidateCountAtDecision: 2,
      electionPhaseAtDecision: "primary",
      arrangedBy: new ObjectId(),
    });

    expect(insertOne).not.toHaveBeenCalled();
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("clears duplicate active endorsements for the same candidate when refreshing an existing row", async () => {
    const npp = makeNpp();
    const electionId = new ObjectId();
    const candidate = makeCandidate({ electionId });
    const keptId = new ObjectId();
    const duplicateId = new ObjectId();
    const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 1 });

    const db = {
      collection: vi.fn(() => ({
        find: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            {
              _id: keptId,
              nppId: npp._id,
              electionId,
              candidateId: candidate.characterId,
              isActive: true,
            },
            {
              _id: duplicateId,
              nppId: npp._id,
              electionId,
              candidateId: candidate.characterId,
              isActive: true,
            },
          ]),
        }),
        updateOne,
        insertOne: vi.fn(),
        updateMany,
      })),
    } as unknown as Db;

    await upsertNppEndorsement(db, {
      npp,
      candidate,
      source: "organic",
      now: new Date("2026-05-01T00:00:00Z"),
      currentTurn: 8,
      candidateCountAtDecision: 2,
      electionPhaseAtDecision: "primary",
    });

    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith(
      { _id: { $in: [duplicateId] }, isActive: true },
      expect.objectContaining({
        $set: expect.objectContaining({
          withdrawnReason: "switched",
        }),
      }),
      undefined
    );
  });
});
