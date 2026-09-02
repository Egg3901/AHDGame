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
function makeDb(mode?: "shadow" | "active"): Db {
  return {
    collection: (name: string) => {
      if (name === "gameState") {
        return {
          findOne: vi
            .fn()
            .mockResolvedValue(mode ? { _id: "current", nppForeignPolicyMode: mode } : null),
        };
      }
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
  it("yields all ballots to the opinion planner when mode is absent", async () => {
    collectionDocs.proposals = [
      {
        _id: new ObjectId(),
        organizationId: "eu",
        proposingCountryId: "DE",
        votes: [],
      },
    ];
    getMembersMock.mockResolvedValue(["FR", "DE"]);
    isActiveMock.mockResolvedValue(true);

    const count = await castAutonomousOrgVotes(makeDb(), 10);

    expect(count).toBe(0);
    expect(getMembersMock).not.toHaveBeenCalled();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("does not vote on a membership proposal, whose ballot it can never be on", async () => {
    // Ticket #1257. An admission is decided by the player-enabled members alone,
    // and every country this speaks for is autonomy-active, which is defined as
    // NOT player-enabled. A ballot cast here could never be counted — it only
    // landed on the proposal for the panels to show consent the tally beside it
    // was ignoring.
    collectionDocs.proposals = [
      {
        _id: new ObjectId(),
        organizationId: "eu",
        proposingCountryId: "DE",
        votes: [],
      },
    ];
    getMembersMock.mockResolvedValue(["FR", "DE", "UK"]);
    isActiveMock.mockImplementation(async (_db: unknown, cid: string) => cid === "FR");

    const count = await castAutonomousOrgVotes(makeDb("shadow"), 10);

    expect(count).toBe(0);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("still votes in a leadership election, which is decided by the wider roll", async () => {
    // The counterpart to the test above: a chair is carried by a majority, where
    // an autonomy-active member does hold a vote, so silence there costs a yes
    // rather than vetoing. It skips whoever has already voted.
    const fr = new ObjectId();
    collectionDocs.elections = [
      {
        _id: new ObjectId(),
        organizationId: "eu",
        votes: [{ countryId: "FR", characterId: fr, characterName: "x", vote: "yes" }],
      },
    ];
    getMembersMock.mockResolvedValue(["FR", "UK"]);
    isActiveMock.mockImplementation(
      async (_db: unknown, cid: string) => cid === "FR" || cid === "UK"
    );

    const count = await castAutonomousOrgVotes(makeDb("shadow"), 5);

    expect(count).toBe(1);
    expect(upsertMock.mock.calls[0][2].countryId).toBe("UK");
    expect(upsertMock.mock.calls[0][2].vote).toBe("yes");
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

    const count = await castAutonomousOrgVotes(makeDb("shadow"), 7);
    expect(count).toBe(1);
    expect(upsertMock.mock.calls[0][2].countryId).toBe("FR");
  });

  it("does nothing when no member is autonomy-active", async () => {
    // Uses a leadership election, not a membership proposal: membership is no
    // longer voted here at all, so a proposal would make this pass vacuously.
    collectionDocs.elections = [{ _id: new ObjectId(), organizationId: "eu", votes: [] }];
    getMembersMock.mockResolvedValue(["FR", "UK"]);
    isActiveMock.mockResolvedValue(false);

    const count = await castAutonomousOrgVotes(makeDb("shadow"), 3);
    expect(count).toBe(0);
    expect(upsertMock).not.toHaveBeenCalled();
  });
});
