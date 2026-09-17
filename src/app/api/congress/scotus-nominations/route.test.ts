import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  getAuthUser: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/congress/governmentVoteBreakdown", () => ({
  computeCabinetNominationTally: vi.fn().mockResolvedValue({
    votesFor: 2,
    votesAgainst: 1,
    votesAbstain: 0,
  }),
}));

describe("GET /api/congress/scotus-nominations", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("returns active SCOTUS nominations for the Senate list", async () => {
    const nominationId = new ObjectId();
    db.collection("scotusNominations");
    db.collectionMocks.scotusNominations!.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: nominationId,
            countryId: "US",
            seatNumber: 3,
            nomineeMode: "character",
            nomineeCharacterId: new ObjectId(),
            nomineeNppId: null,
            nomineeName: "Ada Justice",
            nomineeParty: "Democratic Party",
            proposedByPresidentName: "Test President",
            status: "active",
            votes: { a: "for", b: "for", c: "against" },
            votingEndsAt: new Date("2026-08-13T08:00:00.000Z"),
            proposedAt: new Date("2026-08-12T08:00:00.000Z"),
          },
        ]),
      }),
    });

    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.nominations).toHaveLength(1);
    expect(body.nominations[0]).toMatchObject({
      id: nominationId.toString(),
      kind: "scotus",
      seatNumber: 3,
      positionName: "Supreme Court Seat #3",
      nomineeCharacterName: "Ada Justice",
      votesFor: 2,
      votesAgainst: 1,
      votesAbstain: 0,
    });
    expect(db.collectionMocks.scotusNominations!.find).toHaveBeenCalledWith({
      status: "active",
      countryId: "US",
    });
  });

  it("does not personalize the public list for a revoked or banned account", async () => {
    const nominationId = new ObjectId();
    db.collection("scotusNominations");
    db.collectionMocks.scotusNominations!.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: nominationId,
            countryId: "US",
            seatNumber: 3,
            nomineeMode: "character",
            nomineeCharacterId: new ObjectId(),
            nomineeNppId: null,
            nomineeName: "Ada Justice",
            nomineeParty: "Democratic Party",
            proposedByPresidentName: "Test President",
            status: "active",
            votes: {},
            votingEndsAt: new Date("2026-08-13T08:00:00.000Z"),
            proposedAt: new Date("2026-08-12T08:00:00.000Z"),
          },
        ]),
      }),
    });

    const { getAuthUser } = await import("@/lib/auth");
    vi.mocked(getAuthUser).mockResolvedValue(null);
    const { GET } = await import("./route");

    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      isSenator: false,
      nominations: [{ myVote: null }],
    });
    expect(getAuthUser).toHaveBeenCalledOnce();
    expect(db.collectionMocks.characters?.findOne).toBeUndefined();
  });

  it("uses the current account principal when resolving senator privileges", async () => {
    const principalId = new ObjectId();
    const characterId = new ObjectId();
    db.collection("scotusNominations");
    db.collectionMocks.scotusNominations!.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    });
    db.collection("characters");
    db.collectionMocks.characters!.findOne.mockResolvedValue({
      _id: characterId,
      userId: principalId,
    });
    db.collection("electedOfficials");
    db.collectionMocks.electedOfficials!.findOne.mockResolvedValue({
      characterId,
      officeType: "senate",
      countryId: "US",
    });

    const { getAuthUser } = await import("@/lib/auth");
    vi.mocked(getAuthUser).mockResolvedValue({
      userId: principalId.toHexString(),
      username: "senator",
      email: "senator@example.test",
      role: "player",
      isAdmin: false,
      isModerator: false,
      isBanned: false,
    });
    const { GET } = await import("./route");

    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ isSenator: true });
    expect(db.collectionMocks.characters!.findOne).toHaveBeenCalledWith({
      userId: principalId,
    });
  });

  it("fails closed when current-account lookup is unavailable", async () => {
    const { getAuthUser } = await import("@/lib/auth");
    vi.mocked(getAuthUser).mockRejectedValueOnce(new Error("account database unavailable"));

    const { GET } = await import("./route");
    const res = await GET();

    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});
