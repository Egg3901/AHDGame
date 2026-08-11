import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";

const { isActiveMock, getMembersMock, upsertMock } = vi.hoisted(() => ({
  isActiveMock: vi.fn(),
  getMembersMock: vi.fn(),
  upsertMock: vi.fn().mockResolvedValue({ matchedCount: 1 }),
}));

vi.mock("../featureFlag", () => ({
  isNppAutonomyActive: (...args: unknown[]) => isActiveMock(...args),
}));
vi.mock("@/lib/internationalOrganizations/service", () => ({
  getMembers: (...args: unknown[]) => getMembersMock(...args),
}));
vi.mock("@/lib/internationalOrganizations/voteWrite", () => ({
  upsertPendingOrganizationVote: (...args: unknown[]) => upsertMock(...args),
}));

const collectionDocs: Record<string, unknown[]> = {
  proposals: [],
  legislation: [],
  elections: [],
};
vi.mock("@/lib/db/collections", () => ({
  getOrganizationProposalsCollection: vi.fn(async () => ({
    find: () => ({ toArray: async () => collectionDocs.proposals }),
  })),
  getOrganizationLegislationCollection: vi.fn(async () => ({
    find: () => ({ toArray: async () => collectionDocs.legislation }),
  })),
  getOrganizationLeadershipElectionsCollection: vi.fn(async () => ({
    find: () => ({ toArray: async () => collectionDocs.elections }),
  })),
}));

import { castAutonomousOrgVotes } from "../autonomousOrgVoting";

// Minimal db whose only used collection is "npps" (voter identity lookup).
function makeDb(): Db {
  return {
    collection: (name: string) => {
      if (name === "npps") {
        return {
          findOne: vi.fn().mockResolvedValue({ _id: new ObjectId(), name: "Rep NPP" }),
        };
      }
      return { findOne: vi.fn().mockResolvedValue(null) };
    },
  } as unknown as Db;
}

beforeEach(() => {
  isActiveMock.mockReset();
  getMembersMock.mockReset();
  upsertMock.mockClear().mockResolvedValue({ matchedCount: 1 });
  collectionDocs.proposals = [];
  collectionDocs.legislation = [];
  collectionDocs.elections = [];
});

describe("castAutonomousOrgVotes", () => {
  it("casts yes for an autonomy-active member that hasn't voted on a membership proposal", async () => {
    collectionDocs.proposals = [
      {
        _id: new ObjectId(),
        organizationId: "eu",
        proposingCountryId: "DE",
        votes: [],
      },
    ];
    // Members: FR (autonomous), DE (applicant — skipped), UK (player-enabled).
    getMembersMock.mockResolvedValue(["FR", "DE", "UK"]);
    isActiveMock.mockImplementation(async (_db: unknown, cid: string) => cid === "FR");

    const count = await castAutonomousOrgVotes(makeDb(), 10);

    expect(count).toBe(1);
    expect(upsertMock).toHaveBeenCalledTimes(1);
    const voteArg = upsertMock.mock.calls[0][2];
    expect(voteArg.countryId).toBe("FR");
    expect(voteArg.vote).toBe("yes");
    expect(voteArg.castOnTurn).toBe(10);
    expect(voteArg.characterName).toBe("Rep NPP");
  });

  it("does not vote for the applicant, for player-enabled members, or for those who already voted", async () => {
    const fr = new ObjectId();
    collectionDocs.proposals = [
      {
        _id: new ObjectId(),
        organizationId: "eu",
        proposingCountryId: "DE",
        // FR already has a vote on record → must be skipped.
        votes: [{ countryId: "FR", characterId: fr, characterName: "x", vote: "yes" }],
      },
    ];
    getMembersMock.mockResolvedValue(["FR", "DE", "UK"]);
    isActiveMock.mockImplementation(
      async (_db: unknown, cid: string) => cid === "FR" || cid === "UK"
    );

    const count = await castAutonomousOrgVotes(makeDb(), 5);
    // FR already voted; UK is autonomy-active=true here but DE is applicant.
    // Only UK is eligible+unvoted+active → exactly one vote.
    expect(count).toBe(1);
    expect(upsertMock.mock.calls[0][2].countryId).toBe("UK");
  });

  it("casts yes for autonomy-active named parties on FTA legislation", async () => {
    collectionDocs.legislation = [
      {
        _id: new ObjectId(),
        organizationId: "eu",
        parties: ["FR", "UK"],
        votes: [],
      },
    ];
    isActiveMock.mockImplementation(async (_db: unknown, cid: string) => cid === "FR");

    const count = await castAutonomousOrgVotes(makeDb(), 7);
    expect(count).toBe(1);
    expect(upsertMock.mock.calls[0][2].countryId).toBe("FR");
  });

  it("does nothing when no member is autonomy-active", async () => {
    collectionDocs.proposals = [
      { _id: new ObjectId(), organizationId: "eu", proposingCountryId: "DE", votes: [] },
    ];
    getMembersMock.mockResolvedValue(["FR", "UK"]);
    isActiveMock.mockResolvedValue(false);

    const count = await castAutonomousOrgVotes(makeDb(), 3);
    expect(count).toBe(0);
    expect(upsertMock).not.toHaveBeenCalled();
  });
});
