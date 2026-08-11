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

describe("resolveNpcscChairElection", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    // Prime the collection mocks so per-test overrides can be set before the
    // resolver runs (collections are otherwise created lazily on first access).
    db.collection("npcscChairElections");
    db.collection("npcscChairNominations");
    db.collection("congressLeaders");
  });

  function mockNominationsCursor(docs: unknown[]) {
    const cursor = {
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue(docs),
    };
    db.collectionMocks.npcscChairNominations!.find.mockReturnValue(cursor as never);
  }

  it("elects the top vote-getter and writes them to congressLeaders as chair_npcsc", async () => {
    db.collectionMocks.npcscChairElections!.findOne.mockResolvedValue({
      _id: "current",
      status: "voting",
    });
    const winnerId = new ObjectId();
    const loserId = new ObjectId();
    mockNominationsCursor([
      {
        _id: new ObjectId(),
        nomineeId: winnerId,
        nomineeName: "Winner",
        nomineeParty: "ccp",
        nominatedById: winnerId,
        votesFor: 12,
        status: "voting",
      },
      {
        _id: new ObjectId(),
        nomineeId: loserId,
        nomineeName: "Runner-up",
        nomineeParty: "ccp",
        nominatedById: loserId,
        votesFor: 3,
        status: "voting",
      },
    ]);

    const { resolveNpcscChairElection } = await import("./resolveElection");
    const resolved = await resolveNpcscChairElection(db as unknown as Db, new Map(), true);

    expect(resolved).toBe(true);
    const leaderUpdate = db.collectionMocks.congressLeaders!.updateOne;
    expect(leaderUpdate).toHaveBeenCalledTimes(1);
    const [filter, update] = leaderUpdate.mock.calls[0];
    expect(filter).toEqual({ role: "chair_npcsc" });
    expect(update.$set.characterId).toBe(winnerId);
    expect(update.$set.characterName).toBe("Winner");
    // Election is closed afterward via the atomic voting→closed claim.
    expect(db.collectionMocks.npcscChairElections!.updateOne).toHaveBeenCalledWith(
      { _id: "current", status: "voting" },
      { $set: expect.objectContaining({ status: "closed" }) }
    );
  });

  it("does not announce when another worker already closed the election", async () => {
    db.collectionMocks.npcscChairElections!.findOne.mockResolvedValue({
      _id: "current",
      status: "voting",
    });
    const winnerId = new ObjectId();
    mockNominationsCursor([
      {
        _id: new ObjectId(),
        nomineeId: winnerId,
        nomineeName: "Winner",
        nomineeParty: "ccp",
        nominatedById: winnerId,
        votesFor: 12,
        status: "voting",
      },
    ]);
    // Simulate the concurrent loser: the guarded close matches zero documents.
    db.collectionMocks.npcscChairElections!.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    });

    const { resolveNpcscChairElection } = await import("./resolveElection");
    const { sendCountryGameEvent } = await import("@/lib/discordWebhooks");
    const resolved = await resolveNpcscChairElection(db as unknown as Db, new Map(), true);

    expect(resolved).toBe(true);
    expect(sendCountryGameEvent).not.toHaveBeenCalled();
  });

  it("vacates the role when there are no candidacies", async () => {
    db.collectionMocks.npcscChairElections!.findOne.mockResolvedValue({
      _id: "current",
      status: "voting",
    });
    mockNominationsCursor([]);

    const { resolveNpcscChairElection } = await import("./resolveElection");
    const { vacateCongressLeadershipRole } = await import("@/lib/congress/leadershipElections");

    const resolved = await resolveNpcscChairElection(db as unknown as Db, new Map(), true);

    expect(resolved).toBe(true);
    expect(vacateCongressLeadershipRole).toHaveBeenCalledWith(
      expect.anything(),
      "chair_npcsc",
      expect.any(Date)
    );
    expect(db.collectionMocks.congressLeaders!.updateOne).not.toHaveBeenCalled();
  });

  it("is a no-op when no open election exists", async () => {
    db.collectionMocks.npcscChairElections!.findOne.mockResolvedValue(null);

    const { resolveNpcscChairElection } = await import("./resolveElection");
    const resolved = await resolveNpcscChairElection(db as unknown as Db, new Map(), true);

    expect(resolved).toBe(false);
  });
});
