import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  verifyAuth: vi.fn().mockRejectedValue(new Error("unauthenticated")),
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
});
