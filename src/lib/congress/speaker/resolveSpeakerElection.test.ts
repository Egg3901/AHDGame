import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

// External side-effect deps — stubbed so the resolver runs in isolation.
vi.mock("@/lib/wiki/markCongressLeadership", () => ({
  markCongressLeadershipHeld: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/discordWebhooks", () => ({
  sendCountryGameEvent: vi.fn().mockResolvedValue(undefined),
  DISCORD_COLORS: { leadership: 0 },
}));
vi.mock("@/lib/congress/leadershipElections", () => ({
  vacateCongressLeadershipRole: vi.fn().mockResolvedValue(undefined),
  isLeadershipElectionClosed: vi.fn().mockReturnValue(true),
}));
vi.mock("@/lib/congress/governmentVoteBreakdown", () => ({
  computeCongressLeadershipTally: vi.fn().mockResolvedValue({ votesFor: 10 }),
}));

describe("resolveSpeakerElection — announce idempotency", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("speakerElections");
    db.collection("speakerNominations");
    db.collection("congressLeaders");
  });

  function mockNominationsCursor(docs: unknown[]) {
    const cursor = {
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue(docs),
    };
    db.collectionMocks.speakerNominations!.find.mockReturnValue(cursor as never);
  }

  function seedVotingElectionWithWinner() {
    db.collectionMocks.speakerElections!.findOne.mockResolvedValue({
      _id: "current",
      status: "voting",
    });
    const winnerId = new ObjectId();
    mockNominationsCursor([
      {
        _id: new ObjectId(),
        nomineeId: winnerId,
        nomineeName: "Winner",
        nomineeParty: "2",
        nominatedById: winnerId,
        votesFor: 10,
        votes: {},
        status: "voting",
        createdAt: new Date(0),
      },
    ]);
  }

  it("announces exactly once when it wins the atomic election close", async () => {
    seedVotingElectionWithWinner();
    db.collectionMocks.speakerElections!.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });

    const { resolveSpeakerElection } = await import("./resolveSpeakerElection");
    const { sendCountryGameEvent } = await import("@/lib/discordWebhooks");
    const resolved = await resolveSpeakerElection(db as unknown as Db, new Map(), true);

    expect(resolved).toBe(true);
    expect(sendCountryGameEvent).toHaveBeenCalledTimes(1);
  });

  it("does not announce when another worker already closed the election", async () => {
    seedVotingElectionWithWinner();
    // Simulate the concurrent loser: the guarded close matches zero documents.
    db.collectionMocks.speakerElections!.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    });

    const { resolveSpeakerElection } = await import("./resolveSpeakerElection");
    const { sendCountryGameEvent } = await import("@/lib/discordWebhooks");
    const resolved = await resolveSpeakerElection(db as unknown as Db, new Map(), true);

    expect(resolved).toBe(true);
    expect(sendCountryGameEvent).not.toHaveBeenCalled();
  });
});
