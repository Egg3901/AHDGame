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

describe("resolveCppccChairElection", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("cppccChairElections");
    db.collection("cppccChairNominations");
    db.collection("congressLeaders");
  });

  function mockNominationsCursor(docs: unknown[]) {
    const cursor = {
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue(docs),
    };
    db.collectionMocks.cppccChairNominations!.find.mockReturnValue(cursor as never);
  }

  it("elects the top vote-getter and writes them to congressLeaders as chair_cppcc", async () => {
    db.collectionMocks.cppccChairElections!.findOne.mockResolvedValue({
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
        votesFor: 9,
        status: "voting",
      },
    ]);

    const { resolveCppccChairElection } = await import("./resolveElection");
    const resolved = await resolveCppccChairElection(db as unknown as Db, new Map(), true);

    expect(resolved).toBe(true);
    const [filter, update] = db.collectionMocks.congressLeaders!.updateOne.mock.calls[0];
    expect(filter).toEqual({ role: "chair_cppcc" });
    expect(update.$set.characterId).toBe(winnerId);
  });

  it("vacates the role when there are no candidacies", async () => {
    db.collectionMocks.cppccChairElections!.findOne.mockResolvedValue({
      _id: "current",
      status: "voting",
    });
    mockNominationsCursor([]);

    const { resolveCppccChairElection } = await import("./resolveElection");
    const { vacateCongressLeadershipRole } = await import("@/lib/congress/leadershipElections");
    const resolved = await resolveCppccChairElection(db as unknown as Db, new Map(), true);

    expect(resolved).toBe(true);
    expect(vacateCongressLeadershipRole).toHaveBeenCalledWith(
      expect.anything(),
      "chair_cppcc",
      expect.any(Date)
    );
  });

  it("does not announce when another worker already closed the election", async () => {
    db.collectionMocks.cppccChairElections!.findOne.mockResolvedValue({
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
        votesFor: 9,
        status: "voting",
      },
    ]);
    // Simulate the concurrent loser: the guarded close matches zero documents.
    db.collectionMocks.cppccChairElections!.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    });

    const { resolveCppccChairElection } = await import("./resolveElection");
    const { sendCountryGameEvent } = await import("@/lib/discordWebhooks");
    const resolved = await resolveCppccChairElection(db as unknown as Db, new Map(), true);

    expect(resolved).toBe(true);
    expect(sendCountryGameEvent).not.toHaveBeenCalled();
  });
});
