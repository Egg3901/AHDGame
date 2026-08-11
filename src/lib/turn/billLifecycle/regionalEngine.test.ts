import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { BillVoteSnapshot } from "@/lib/db/types/voteSnapshot";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/notifications", () => ({
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/legislationEffects", () => ({
  applyLegislationEffect: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/billEnactment", () => ({ onBillEnacted: vi.fn().mockResolvedValue(undefined) }));

/**
 * Regression for NIR bill 6a539ded… ("Services Act"): a regional bill that won
 * its floor vote 43–28 was marked `failed` because the resolver required an
 * ABSOLUTE majority of the whole 90-seat chamber (46) rather than the game-wide
 * simple-majority rule (For > Against). State bills must pass on the same rule
 * as every national legislature.
 */
describe("processStateBillTimers — passage threshold", () => {
  let db: MockDb;

  // NPP ids from the live bill; seat weights sum to For=43 (42+1), Against=28 (6+10+11+1).
  const NPP = {
    a: "6a19c5a31ed3632485eb915e", // for, 42
    b: "6a19c5a31ed3632485eb910a", // against, 6
    c: "6a19c5a31ed3632485eb915c", // against, 10
    d: "6a20797a758aa87689c3ae02", // against, 11
    e: "6a209df047c97be4e82a81d6", // for, 1
    f: "6a267217a50c3c2f5f12a6ad", // against, 1
  };

  const billId = new ObjectId();

  // Seat weights per NPP: a=42, b=6, c=10, d=11, e=1, f=1.
  const WON_43_28 = {
    [`npp_${NPP.a}`]: "for",
    [`npp_${NPP.b}`]: "against",
    [`npp_${NPP.c}`]: "against",
    [`npp_${NPP.d}`]: "against",
    [`npp_${NPP.e}`]: "for",
    [`npp_${NPP.f}`]: "against",
  }; // For = 43, Against = 28
  const LOST_7_64 = {
    [`npp_${NPP.a}`]: "against",
    [`npp_${NPP.b}`]: "for",
    [`npp_${NPP.c}`]: "against",
    [`npp_${NPP.d}`]: "against",
    [`npp_${NPP.e}`]: "for",
    [`npp_${NPP.f}`]: "against",
  }; // For = 7, Against = 64

  function makeBill(votes: Record<string, string>, status = "active") {
    const votesFor = 43;
    return {
      _id: billId,
      stateId: "NIR",
      countryId: "UK",
      title: "Services Act",
      sponsorId: null,
      status,
      votesFor,
      votesAbstain: 0,
      votes,
      provisions: [],
      legislationTypeId: "uk_regional_utilities",
      effectDirection: 1,
      votingEndsAt: new Date("2026-07-13T14:00:00.000Z"),
    };
  }

  function statusSetForBill() {
    const update = db.collectionMocks.stateBills!.updateOne.mock.calls.find((c) =>
      (c[0] as { _id?: ObjectId })?._id?.equals?.(billId)
    );
    expect(update, "expected stateBills.updateOne to be called for the bill").toBeTruthy();
    return (update![1] as { $set?: { status?: string } })?.$set?.status;
  }

  function official(npp: string, seatsHeld: number) {
    return {
      _id: new ObjectId(),
      characterId: null,
      nppId: new ObjectId(npp),
      countryId: "UK",
      officeType: "regionalCouncil",
      state: "NIR",
      seatsHeld,
    };
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    // Collections are created lazily on first access — touch the ones we configure.
    ["stateBills", "states", "electedOfficials", "characters", "gameState"].forEach((n) =>
      db.collection(n)
    );

    // Chamber = 90 seats.
    db.collectionMocks.states!.findOne.mockResolvedValue({
      _id: "NIR",
      countryId: "UK",
      stateSenateSeats: 90,
    });

    // scopeStateBillVotes reads the current seat holders via find().project().toArray().
    const officials = [
      official(NPP.a, 42),
      official(NPP.b, 6),
      official(NPP.c, 10),
      official(NPP.d, 11),
      official(NPP.e, 1),
      official(NPP.f, 1),
    ];
    db.collectionMocks.electedOfficials!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(officials),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });
    // Seated governor → bill routes to "passed" (awaiting signature) rather than auto-enact.
    db.collectionMocks.electedOfficials!.findOne.mockResolvedValue({
      characterId: new ObjectId(),
    });
    db.collectionMocks.characters!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      userId: "gov-user",
    });
  });

  it("passes a bill that won its floor vote 43–28 in a 90-seat chamber", async () => {
    db.collectionMocks
      .stateBills!.findOneAndUpdate.mockResolvedValueOnce(makeBill(WON_43_28))
      .mockResolvedValue(null);

    const { processStateBillTimers } = await import("./regionalEngine");
    await processStateBillTimers(new Date("2026-07-13T15:00:00.000Z"));

    expect(statusSetForBill()).toBe("passed");
  });

  it("fails a bill that lost its floor vote 7–64", async () => {
    db.collectionMocks
      .stateBills!.findOneAndUpdate.mockResolvedValueOnce(makeBill(LOST_7_64))
      .mockResolvedValue(null);

    const { processStateBillTimers } = await import("./regionalEngine");
    await processStateBillTimers(new Date("2026-07-13T15:00:00.000Z"));

    expect(statusSetForBill()).toBe("failed");
  });

  function voteSnapshotForBill() {
    const update = db.collectionMocks.stateBills!.updateOne.mock.calls.find((c) =>
      (c[0] as { _id?: ObjectId })?._id?.equals?.(billId)
    );
    expect(update, "expected stateBills.updateOne to be called for the bill").toBeTruthy();
    return (update![1] as { $set?: { voteSnapshot?: BillVoteSnapshot } })?.$set?.voteSnapshot;
  }

  it("freezes a voteSnapshot whose totals match the scoped decision totals on passage", async () => {
    db.collectionMocks
      .stateBills!.findOneAndUpdate.mockResolvedValueOnce(makeBill(WON_43_28))
      .mockResolvedValue(null);

    const { processStateBillTimers } = await import("./regionalEngine");
    await processStateBillTimers(new Date("2026-07-13T15:00:00.000Z"));

    expect(statusSetForBill()).toBe("passed");
    const snapshot = voteSnapshotForBill();
    expect(snapshot).toBeDefined();
    // Scoped survivors: a(42)+e(1)=43 for; b(6)+c(10)+d(11)+f(1)=28 against.
    expect(snapshot!.totals).toEqual({ for: 43, against: 28, abstain: 0 });
    // Every current-seat NPP that voted is preserved (raw map untouched, subset frozen).
    expect(Object.keys(snapshot!.votes).length).toBe(6);
    expect(snapshot!.weights[`npp_${NPP.a}`]).toBe(42);
  });

  function overrideSnapshotForBill() {
    const update = db.collectionMocks.stateBills!.updateOne.mock.calls.find((c) =>
      (c[0] as { _id?: ObjectId })?._id?.equals?.(billId)
    );
    expect(update, "expected stateBills.updateOne to be called for the override bill").toBeTruthy();
    return (update![1] as { $set?: { overrideVoteSnapshot?: BillVoteSnapshot } })?.$set
      ?.overrideVoteSnapshot;
  }

  it("auto-enacts a passing bill when no regional executive is seated", async () => {
    // No governor: the executive lookup finds nothing.
    db.collectionMocks.electedOfficials!.findOne.mockResolvedValue(null);
    db.collectionMocks
      .stateBills!.findOneAndUpdate.mockResolvedValueOnce(makeBill(WON_43_28))
      .mockResolvedValue(null);

    const { processStateBillTimers } = await import("./regionalEngine");
    await processStateBillTimers(new Date("2026-07-13T15:00:00.000Z"));

    expect(statusSetForBill()).toBe("enacted");
    const { applyLegislationEffect } = await import("@/lib/legislationEffects");
    expect(vi.mocked(applyLegislationEffect)).toHaveBeenCalledTimes(1);
  });

  it("auto-signs a passed bill once the governor deadline lapses", async () => {
    const passedBill = {
      ...makeBill({}, "passed"),
      governorActionDeadline: new Date("2026-07-13T14:00:00.000Z"),
    };
    // Loop 1 (active) claims nothing; loop 2 (passed → enacted) claims the bill once.
    db.collectionMocks
      .stateBills!.findOneAndUpdate.mockResolvedValueOnce(null)
      .mockResolvedValueOnce(passedBill)
      .mockResolvedValue(null);

    const { processStateBillTimers } = await import("./regionalEngine");
    const result = await processStateBillTimers(new Date("2026-07-13T15:00:00.000Z"));

    expect(result.billsProcessed).toBe(1);
    // Auto-sign happens inside the atomic claim itself — assert the claim's $set.
    const claim = db.collectionMocks.stateBills!.findOneAndUpdate.mock.calls.find(
      (c) => (c[1] as { $set?: { status?: string } })?.$set?.status === "enacted"
    );
    expect(claim).toBeTruthy();
    expect((claim![1] as { $set: { governorAction?: string } }).$set.governorAction).toBe("signed");
    const { applyLegislationEffect } = await import("@/lib/legislationEffects");
    expect(vi.mocked(applyLegislationEffect)).toHaveBeenCalledTimes(1);
  });

  it("enacts on override at exactly the two-thirds-of-seats supermajority", async () => {
    // 90 seats → ceil(2/3 · 90) = 60 = a(42) + b(6) + c(10) + e(1) + f(1).
    const overrideBill = {
      ...makeBill({}, "veto_override"),
      overrideVotes: {
        [`npp_${NPP.a}`]: "for",
        [`npp_${NPP.b}`]: "for",
        [`npp_${NPP.c}`]: "for",
        [`npp_${NPP.e}`]: "for",
        [`npp_${NPP.f}`]: "for",
      },
      overrideVotesFor: 60,
      overrideVotesAgainst: 0,
      overrideVotingEndsAt: new Date("2026-07-13T14:00:00.000Z"),
    };
    db.collectionMocks
      .stateBills!.findOneAndUpdate.mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(overrideBill)
      .mockResolvedValue(null);

    const { processStateBillTimers } = await import("./regionalEngine");
    await processStateBillTimers(new Date("2026-07-13T15:00:00.000Z"));

    expect(statusSetForBill()).toBe("enacted");
    const { applyLegislationEffect } = await import("@/lib/legislationEffects");
    expect(vi.mocked(applyLegislationEffect)).toHaveBeenCalledTimes(1);
  });

  it("reverts the transient vote_closing claim when the resolver throws (#2991)", async () => {
    db.collectionMocks
      .stateBills!.findOneAndUpdate.mockResolvedValueOnce(makeBill(WON_43_28))
      .mockResolvedValue(null);
    // Force a mid-resolve failure: the state lookup rejects.
    db.collectionMocks.states!.findOne.mockRejectedValueOnce(new Error("db down"));

    const { processStateBillTimers } = await import("./regionalEngine");
    await expect(processStateBillTimers(new Date("2026-07-13T15:00:00.000Z"))).rejects.toThrow(
      "db down"
    );

    const revert = db.collectionMocks.stateBills!.updateOne.mock.calls.find(
      (c) =>
        (c[0] as { status?: string })?.status === "vote_closing" &&
        (c[1] as { $set?: { status?: string } })?.$set?.status === "active"
    );
    expect(revert, "expected the vote_closing claim to be reverted to active").toBeTruthy();
  });

  it("freezes overrideVoteSnapshot when a veto override resolves", async () => {
    const overrideBill = {
      ...makeBill({}, "veto_override"),
      overrideVotes: { [`npp_${NPP.a}`]: "for" }, // 42 seats for, below the 60 supermajority
      overrideVotesFor: 42,
      overrideVotesAgainst: 0,
      overrideVotingEndsAt: new Date("2026-07-13T14:00:00.000Z"),
    };
    // Loop 1 (active→vote_closing) and loop 2 (passed→enacted) get nothing;
    // loop 3 (veto_override→override_closing) claims the override bill once.
    db.collectionMocks
      .stateBills!.findOneAndUpdate.mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(overrideBill)
      .mockResolvedValue(null);

    const { processStateBillTimers } = await import("./regionalEngine");
    await processStateBillTimers(new Date("2026-07-13T15:00:00.000Z"));

    expect(statusSetForBill()).toBe("override_failed");
    const snapshot = overrideSnapshotForBill();
    expect(snapshot).toBeDefined();
    expect(snapshot!.totals.for).toBe(42);
    expect(snapshot!.weights[`npp_${NPP.a}`]).toBe(42);
  });
});
