import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { DIVERGENT_TENURE_FLOOR_TURNS } from "@/lib/scotus/tenure";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotifications: vi.fn() }));
vi.mock("@/lib/congress/governmentVoteBreakdown", () => ({
  computeCabinetNominationTally: vi.fn(),
}));

describe("processScotusNominationLifecycle", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({ currentTurn: 100 } as never);
    db.collection("scotusNominations");
    db.collection("supremeCourtSeats");
    db.collection("characters");
    db.collection("npps");
    db.collection("politicalParties");
    db.collection("electedOfficials");
  });

  it("seats a confirmed NPP nominee, flips isDivergent, and computes ideology as 65% personal + 35% party", async () => {
    const nomineeNppId = new ObjectId();
    const nomination = {
      _id: new ObjectId(),
      countryId: "US",
      seatNumber: 5,
      status: "active",
      nomineeMode: "npp",
      nomineeCharacterId: null,
      nomineeNppId,
      nomineeName: "NPP Legal Scholar",
      nomineeParty: "12",
      votes: {},
      votingEndsOnTurn: 90, // already expired vs currentTurn=100
    };
    db.collectionMocks.scotusNominations!.find.mockImplementation(
      (query: Record<string, unknown>) => {
        const orClause = (query?.$or as Array<{ votingEndsOnTurn?: Record<string, unknown> }>)?.[0]
          ?.votingEndsOnTurn;
        const isExpiredQuery = !!orClause && "$lte" in orClause;
        return { toArray: vi.fn().mockResolvedValue(isExpiredQuery ? [nomination] : []) } as never;
      }
    );

    const { computeCabinetNominationTally } =
      await import("@/lib/congress/governmentVoteBreakdown");
    vi.mocked(computeCabinetNominationTally).mockResolvedValue({
      votesFor: 55,
      votesAgainst: 45,
      votesAbstain: 0,
    } as never);

    db.collectionMocks.npps!.findOne.mockResolvedValue({
      _id: nomineeNppId,
      policies: { economic: 2, social: -4 },
    });
    db.collectionMocks.politicalParties!.findOne.mockResolvedValue({
      sequentialId: 12,
      countryId: "US",
      economicPosition: -2,
      socialPosition: 4,
    });

    const { processScotusNominationLifecycle } = await import("./scotusNominationLifecycle");
    const result = await processScotusNominationLifecycle(new Date(0), db as unknown as Db);

    expect(result.confirmed).toBe(1);
    expect(result.rejected).toBe(0);

    // economic: 2*0.65 + -2*0.35 = 0.6 ; social: -4*0.65 + 4*0.35 = -1.2
    expect(db.collectionMocks.supremeCourtSeats!.updateOne).toHaveBeenCalledWith(
      { countryId: "US", seatNumber: 5 },
      expect.objectContaining({
        $set: expect.objectContaining({
          justiceMode: "npp",
          justiceNppId: nomineeNppId,
          isDivergent: true,
          economicLean: 0.6,
          socialLean: -1.2,
          seatedAtTurn: 100,
          divergentHazardStartsTurn: 100 + DIVERGENT_TENURE_FLOOR_TURNS,
        }),
      })
    );

    expect(db.collectionMocks.scotusNominations!.updateOne).toHaveBeenCalledWith(
      { _id: nomination._id },
      expect.objectContaining({ $set: expect.objectContaining({ status: "confirmed" }) })
    );
  });

  it("rejects a nomination when votesAgainst >= votesFor and never seats a justice", async () => {
    const nomination = {
      _id: new ObjectId(),
      countryId: "US",
      seatNumber: 6,
      status: "active",
      nomineeMode: "character",
      nomineeCharacterId: new ObjectId(),
      nomineeNppId: null,
      nomineeName: "Rejected Nominee",
      nomineeParty: "12",
      votes: {},
      votingEndsOnTurn: 90,
    };
    db.collectionMocks.scotusNominations!.find.mockImplementation(
      (query: Record<string, unknown>) => {
        const orClause = (query?.$or as Array<{ votingEndsOnTurn?: Record<string, unknown> }>)?.[0]
          ?.votingEndsOnTurn;
        const isExpiredQuery = !!orClause && "$lte" in orClause;
        return { toArray: vi.fn().mockResolvedValue(isExpiredQuery ? [nomination] : []) } as never;
      }
    );

    const { computeCabinetNominationTally } =
      await import("@/lib/congress/governmentVoteBreakdown");
    vi.mocked(computeCabinetNominationTally).mockResolvedValue({
      votesFor: 40,
      votesAgainst: 60,
      votesAbstain: 0,
    } as never);

    const { processScotusNominationLifecycle } = await import("./scotusNominationLifecycle");
    const result = await processScotusNominationLifecycle(new Date(0), db as unknown as Db);

    expect(result.rejected).toBe(1);
    expect(result.confirmed).toBe(0);
    expect(db.collectionMocks.supremeCourtSeats!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.scotusNominations!.updateOne).toHaveBeenCalledWith(
      { _id: nomination._id },
      expect.objectContaining({ $set: expect.objectContaining({ status: "rejected" }) })
    );
  });
});
