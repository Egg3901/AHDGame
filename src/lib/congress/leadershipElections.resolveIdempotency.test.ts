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
vi.mock("@/lib/congress/governmentVoteBreakdown", () => ({
  computeCongressLeadershipTally: vi.fn().mockResolvedValue({ votesFor: 10 }),
}));

describe("resolveLeadershipElection — announce idempotency", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("houseLeadershipElections");
    db.collection("houseLeadershipNominations");
    db.collection("congressLeaders");
  });

  function seedVotingElectionWithWinner() {
    db.collectionMocks["houseLeadershipElections"]!.findOne.mockResolvedValue({
      _id: "minority_leader",
      status: "voting",
    });
    const winnerId = new ObjectId();
    const cursor = {
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        {
          _id: new ObjectId(),
          role: "minority_leader",
          nomineeId: winnerId,
          nomineeName: "Winner",
          nomineeParty: "OPP",
          nominatedById: winnerId,
          votesFor: 10,
          votes: {},
          status: "voting",
          createdAt: new Date(0),
        },
      ]),
    };
    db.collectionMocks["houseLeadershipNominations"]!.find.mockReturnValue(cursor as never);
  }

  it("announces exactly once when it wins the atomic election close", async () => {
    seedVotingElectionWithWinner();
    db.collectionMocks["houseLeadershipElections"]!.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });

    const { resolveLeadershipElection } = await import("./leadershipElections");
    const { sendCountryGameEvent } = await import("@/lib/discordWebhooks");
    const resolved = await resolveLeadershipElection(
      db as unknown as Db,
      "minority_leader",
      "minority_leader_house",
      "house",
      true
    );

    expect(resolved).toBe(true);
    expect(sendCountryGameEvent).toHaveBeenCalledTimes(1);
  });

  it("does not announce when another worker already closed the election", async () => {
    seedVotingElectionWithWinner();
    db.collectionMocks["houseLeadershipElections"]!.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    });

    const { resolveLeadershipElection } = await import("./leadershipElections");
    const { sendCountryGameEvent } = await import("@/lib/discordWebhooks");
    const resolved = await resolveLeadershipElection(
      db as unknown as Db,
      "minority_leader",
      "minority_leader_house",
      "house",
      true
    );

    expect(resolved).toBe(true);
    expect(sendCountryGameEvent).not.toHaveBeenCalled();
  });
});
