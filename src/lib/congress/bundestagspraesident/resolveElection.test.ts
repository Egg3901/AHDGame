import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

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

describe("resolveBundestagspraesidentElection", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("bundestagspraesidentElections");
    db.collection("bundestagspraesidentNominations");
    db.collection("congressLeaders");
  });

  function mockNominationsCursor(docs: unknown[]) {
    const cursor = {
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue(docs),
    };
    db.collectionMocks.bundestagspraesidentNominations!.find.mockReturnValue(cursor as never);
  }

  function seedVotingElectionWithWinner() {
    db.collectionMocks.bundestagspraesidentElections!.findOne.mockResolvedValue({
      _id: "current",
      status: "voting",
    });
    const winnerId = new ObjectId();
    mockNominationsCursor([
      {
        _id: new ObjectId(),
        nomineeId: winnerId,
        nomineeName: "Winner",
        nomineeParty: "spd",
        nominatedById: winnerId,
        votesFor: 9,
        status: "voting",
      },
    ]);
  }

  it("announces exactly once when it wins the atomic election close", async () => {
    seedVotingElectionWithWinner();
    db.collectionMocks.bundestagspraesidentElections!.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });

    const { resolveBundestagspraesidentElection } = await import("./resolveElection");
    const { sendCountryGameEvent } = await import("@/lib/discordWebhooks");
    const resolved = await resolveBundestagspraesidentElection(
      db as unknown as Db,
      new Map(),
      true
    );

    expect(resolved).toBe(true);
    expect(sendCountryGameEvent).toHaveBeenCalledTimes(1);
  });

  it("does not announce when another worker already closed the election", async () => {
    seedVotingElectionWithWinner();
    // Simulate the concurrent loser: the guarded close matches zero documents.
    db.collectionMocks.bundestagspraesidentElections!.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    });

    const { resolveBundestagspraesidentElection } = await import("./resolveElection");
    const { sendCountryGameEvent } = await import("@/lib/discordWebhooks");
    const resolved = await resolveBundestagspraesidentElection(
      db as unknown as Db,
      new Map(),
      true
    );

    expect(resolved).toBe(true);
    expect(sendCountryGameEvent).not.toHaveBeenCalled();
  });
});
