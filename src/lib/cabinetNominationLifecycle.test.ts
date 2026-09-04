import { beforeEach, describe, it, expect, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { didPass } from "./billLifecycleHelpers";

/**
 * Cabinet nominations use the same didPass logic as bills (simple majority).
 * This test verifies the shared helper used by cabinetNominationLifecycle.
 */
describe("cabinetNominationLifecycle (didPass)", () => {
  it("uses didPass for simple majority: votesFor > votesAgainst confirms", () => {
    expect(didPass(52, 48)).toBe(true);
    expect(didPass(51, 49)).toBe(true);
  });

  it("votesFor <= votesAgainst rejects", () => {
    expect(didPass(48, 52)).toBe(false);
    expect(didPass(50, 50)).toBe(false);
  });
});

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotifications: vi.fn() }));
vi.mock("@/lib/congress/governmentVoteBreakdown", () => ({
  computeCabinetNominationTally: vi.fn(),
}));

describe("processCabinetNominationLifecycle — holder seating", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({ currentTurn: 100 } as never);
    db.collection("cabinetNominations");
    db.collection("cabinetMembers");
    db.collection("cabinetSettings");
    db.collection("characters");
    db.collection("electedOfficials");
  });

  it("resets the position's setting cooldowns when a nominee is confirmed", async () => {
    const nomination = {
      _id: new ObjectId(),
      status: "active",
      countryId: "US",
      positionId: "secretary_of_treasury",
      nomineeCharacterId: new ObjectId(),
      nomineeCharacterName: "New Secretary",
      nomineeParty: "democrat",
      proposedByPresidentId: new ObjectId(),
      votes: {},
    };

    // The lifecycle runs two finds against cabinetNominations: active (votingEndsOnTurn $gt)
    // then expired (votingEndsOnTurn $lte). Only the expired query should return our doc.
    db.collectionMocks.cabinetNominations.find.mockImplementation(
      (query: Record<string, unknown>) => {
        const orClause = (query?.$or as Array<{ votingEndsOnTurn?: Record<string, unknown> }>)?.[0]
          ?.votingEndsOnTurn;
        const isExpiredQuery = !!orClause && "$lte" in orClause;
        return {
          toArray: vi.fn().mockResolvedValue(isExpiredQuery ? [nomination] : []),
        } as never;
      }
    );

    // Senate passes the nomination.
    const { computeCabinetNominationTally } =
      await import("@/lib/congress/governmentVoteBreakdown");
    vi.mocked(computeCabinetNominationTally).mockResolvedValue({
      votesFor: 60,
      votesAgainst: 40,
      votesAbstain: 0,
    } as never);

    const { processCabinetNominationLifecycle } = await import("./cabinetNominationLifecycle");
    await processCabinetNominationLifecycle(new Date(0));

    expect(db.collectionMocks.cabinetSettings.updateOne).toHaveBeenCalledWith(
      { _id: "US_secretary_of_treasury" },
      {
        $unset: {
          lastChangedTurn: "",
          lastAllocationChangedTurn: "",
          lastRegionChangedTurn: "",
          lastTargetCountryChangedTurn: "",
          lastAidPriorityChangedTurn: "",
        },
      }
    );
  });

  it("vacates the nominee's existing seat before seating them in the new one", async () => {
    // Regression: a sitting secretary confirmed to a second position tripped
    // the cabinetMembers_countryId_characterId unique index on insert, so the
    // nomination stayed active and the phase failed every turn (turns 524-536,
    // 2026-08-31). A confirmed move must vacate the old office first.
    const nomineeId = new ObjectId();
    const nomination = {
      _id: new ObjectId(),
      status: "active",
      countryId: "US",
      positionId: "attorney_general",
      nomineeCharacterId: nomineeId,
      nomineeCharacterName: "Sitting Secretary",
      nomineeParty: "republican",
      proposedByPresidentId: new ObjectId(),
      votes: {},
    };
    db.collectionMocks.cabinetNominations.find.mockImplementation(
      (query: Record<string, unknown>) => {
        const orClause = (query?.$or as Array<{ votingEndsOnTurn?: Record<string, unknown> }>)?.[0]
          ?.votingEndsOnTurn;
        const isExpiredQuery = !!orClause && "$lte" in orClause;
        return {
          toArray: vi.fn().mockResolvedValue(isExpiredQuery ? [nomination] : []),
        } as never;
      }
    );

    const { computeCabinetNominationTally } =
      await import("@/lib/congress/governmentVoteBreakdown");
    vi.mocked(computeCabinetNominationTally).mockResolvedValue({
      votesFor: 60,
      votesAgainst: 40,
      votesAbstain: 0,
    } as never);

    const { processCabinetNominationLifecycle } = await import("./cabinetNominationLifecycle");
    await processCabinetNominationLifecycle(new Date(0));

    expect(db.collectionMocks.cabinetMembers.deleteMany).toHaveBeenCalledWith({
      countryId: "US",
      characterId: nomineeId,
    });
    // The vacate must land before the insert, or the unique index still throws.
    const vacateOrder = db.collectionMocks.cabinetMembers.deleteMany.mock.invocationCallOrder[0];
    const insertOrder = db.collectionMocks.cabinetMembers.insertOne.mock.invocationCallOrder[0];
    expect(vacateOrder).toBeLessThan(insertOrder);
    const inserted = db.collectionMocks.cabinetMembers.insertOne.mock.calls[0][0];
    expect(inserted.positionId).toBe("attorney_general");
    expect(inserted.characterId).toBe(nomineeId);
  });

  it("does not reset cooldowns when a nominee is rejected", async () => {
    const nomination = {
      _id: new ObjectId(),
      status: "active",
      countryId: "US",
      positionId: "secretary_of_treasury",
      nomineeCharacterId: new ObjectId(),
      nomineeCharacterName: "Rejected Pick",
      nomineeParty: "democrat",
      proposedByPresidentId: new ObjectId(),
      votes: {},
    };
    db.collectionMocks.cabinetNominations.find.mockImplementation(
      (query: Record<string, unknown>) => {
        const orClause = (query?.$or as Array<{ votingEndsOnTurn?: Record<string, unknown> }>)?.[0]
          ?.votingEndsOnTurn;
        const isExpiredQuery = !!orClause && "$lte" in orClause;
        return {
          toArray: vi.fn().mockResolvedValue(isExpiredQuery ? [nomination] : []),
        } as never;
      }
    );

    const { computeCabinetNominationTally } =
      await import("@/lib/congress/governmentVoteBreakdown");
    vi.mocked(computeCabinetNominationTally).mockResolvedValue({
      votesFor: 40,
      votesAgainst: 60,
      votesAbstain: 0,
    } as never);

    const { processCabinetNominationLifecycle } = await import("./cabinetNominationLifecycle");
    await processCabinetNominationLifecycle(new Date(0));

    expect(db.collectionMocks.cabinetSettings.updateOne).not.toHaveBeenCalled();
  });

  it("scopes NPP catch-up votes to the nomination's own country, not the US preload (#2889)", async () => {
    // A non-US (NG) active nomination must resolve its own country-scoped NPP
    // officials inside castNPPCabinetVotes, rather than reusing the US preload —
    // otherwise US NPP senators' votes leak into the foreign nomination (ticket #923).
    const ngNomination = {
      _id: new ObjectId(),
      status: "active",
      countryId: "NG",
      positionId: "minister_of_finance",
      nomineeCharacterId: new ObjectId(),
      nomineeCharacterName: "NG Finance Nominee",
      nomineeParty: "apc",
      proposedByPresidentId: new ObjectId(),
      votes: {},
    };

    // Return the NG nomination only for the ACTIVE query ($gt current turn);
    // the expired query ($lte) is empty.
    db.collectionMocks.cabinetNominations.find.mockImplementation(
      (query: Record<string, unknown>) => {
        const orClause = (query?.$or as Array<{ votingEndsOnTurn?: Record<string, unknown> }>)?.[0]
          ?.votingEndsOnTurn;
        const isActiveQuery = !!orClause && "$gt" in orClause;
        return {
          toArray: vi.fn().mockResolvedValue(isActiveQuery ? [ngNomination] : []),
        } as never;
      }
    );

    // No NPP officials anywhere — castNPPCabinetVotes early-returns after its
    // country-scoped find, which is all we need to assert the scoping.
    db.collectionMocks.electedOfficials.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    db.collectionMocks.electedOfficials.findOne.mockResolvedValue(null as never);

    const { processCabinetNominationLifecycle } = await import("./cabinetNominationLifecycle");
    await processCabinetNominationLifecycle(new Date(0));

    // The catch-up path queried NG NPP officials directly — which only happens
    // because the US preload was correctly withheld for the non-US nomination.
    // (If the preload leaked in, castNPPCabinetVotes would reuse it and never
    // issue this NG-scoped find.)
    expect(db.collectionMocks.electedOfficials.find).toHaveBeenCalledWith(
      expect.objectContaining({ countryId: "NG", isNPP: true })
    );
  });

  it("replaces an acting holder on confirmation, carrying no acting fields, and never refunds the charge", async () => {
    db.collection("actingAppointmentCharges");
    const nomination = {
      _id: new ObjectId(),
      status: "active",
      countryId: "US",
      positionId: "secretary_of_treasury",
      nomineeCharacterId: new ObjectId(),
      nomineeCharacterName: "Confirmed Secretary",
      nomineeParty: "democrat",
      proposedByPresidentId: new ObjectId(),
      votes: {},
    };
    db.collectionMocks.cabinetNominations.find.mockImplementation(
      (query: Record<string, unknown>) => {
        const orClause = (query?.$or as Array<{ votingEndsOnTurn?: Record<string, unknown> }>)?.[0]
          ?.votingEndsOnTurn;
        const isExpiredQuery = !!orClause && "$lte" in orClause;
        return {
          toArray: vi.fn().mockResolvedValue(isExpiredQuery ? [nomination] : []),
        } as never;
      }
    );

    const { computeCabinetNominationTally } =
      await import("@/lib/congress/governmentVoteBreakdown");
    vi.mocked(computeCabinetNominationTally).mockResolvedValue({
      votesFor: 60,
      votesAgainst: 40,
      votesAbstain: 0,
    } as never);

    const { processCabinetNominationLifecycle } = await import("./cabinetNominationLifecycle");
    await processCabinetNominationLifecycle(new Date(0));

    // Confirmation ends any acting term for the seat: the seat is cleared
    // country-scoped (position ids repeat across countries) and the incoming
    // holder carries none of the acting tenure stamps.
    expect(db.collectionMocks.cabinetMembers.deleteOne).toHaveBeenCalledWith({
      countryId: "US",
      positionId: "secretary_of_treasury",
    });
    const inserted = db.collectionMocks.cabinetMembers.insertOne.mock.calls[0][0];
    expect(inserted.acting).toBeUndefined();
    expect(inserted.actingSinceTurn).toBeUndefined();
    expect(inserted.actingExpiresOnTurn).toBeUndefined();

    // The charge stays spent, so the seat cannot be acting-filled again this
    // presidency even though confirmation has now happened.
    expect(db.collectionMocks.actingAppointmentCharges.deleteOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.actingAppointmentCharges.deleteMany).not.toHaveBeenCalled();
  });
});
