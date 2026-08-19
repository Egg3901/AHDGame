import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { ObjectId } from "mongodb";
import { processReferendumLifecycle } from "./processReferendumLifecycle";
import { runReferendumActuation, cancelReferendum } from "./transfer/actuateReferendum";

const BILL_ID = new ObjectId();
const BILL_ID2 = new ObjectId();
import { SETTLED_COOLDOWN_TURNS, SETTLED_DESIRE_TARGET } from "@/lib/constants/referendum";
import type { Referendum } from "@/lib/db/types/referendum";

// Stub the actuation so the auto-convert branch doesn't run a real transfer.
vi.mock("./transfer/actuateReferendum", () => ({
  runReferendumActuation: vi.fn().mockResolvedValue({ ok: true }),
  cancelReferendum: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/referendum/referendumWebhooks", () => ({
  announceReferendumRequested: vi.fn().mockResolvedValue(undefined),
  announceReferendumDecision: vi.fn().mockResolvedValue(undefined),
  announceReferendumVoteResult: vi.fn().mockResolvedValue(undefined),
  announceConsentBillResolved: vi.fn().mockResolvedValue(undefined),
  announceReunificationComplete: vi.fn().mockResolvedValue(undefined),
  announceSecessionComplete: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/referendum/wire", () => ({ recordWireEvent: vi.fn().mockResolvedValue(undefined) }));
import { recordWireEvent } from "@/lib/referendum/wire";

function cursorOf<T>(docs: T[]) {
  const cursor = {
    sort: vi.fn(() => cursor),
    limit: vi.fn(() => cursor),
    project: vi.fn(() => cursor),
    toArray: vi.fn().mockResolvedValue(docs),
  };
  return cursor;
}

function refDoc(over: Partial<Referendum> = {}): Referendum {
  return {
    _id: "507f1f77bcf86cd799439011" as unknown as Referendum["_id"],
    countryId: "UK",
    regionId: "SCO",
    kind: "independence",
    targetCountryId: null,
    status: "granted",
    requestedTurn: 100,
    grantedTurn: null,
    campaignOpenTurn: null,
    campaignCloseTurn: null,
    yesShare: 65,
    campaignBaseYesShare: 65,
    campaignSpendUnits: { yes: 0, no: 0 },
    conversionDeadlineTurn: null,
    westminsterBillId: null,
    dailBillId: null,
    result: null,
    cooldownReadyAtTurn: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

/** Polling tests assert pass/fail via the DERIVED yesShare (base + units), so
 *  fixtures that set a target yesShare mirror it onto the immutable baseline. */
function polling(yesShare: number): Referendum {
  return refDoc({
    status: "polling",
    yesShare,
    campaignBaseYesShare: yesShare,
    campaignCloseTurn: 158,
  });
}

/** Mock refs.find() (active list) + electedOfficials.find() (MPs for tally). */
function setup(
  db: MockDb,
  active: Referendum[],
  mps: Array<{ characterId: string; partyId: string }> = []
) {
  db.collectionMocks["referendums"] = db.collection("referendums");
  db.collectionMocks["referendums"].find.mockReturnValue(cursorOf(active));
  db.collectionMocks["electedOfficials"] = db.collection("electedOfficials");
  db.collectionMocks["electedOfficials"].find.mockReturnValue(cursorOf(mps));
}

function lastSet(db: MockDb, collection: string) {
  const calls = db.collectionMocks[collection].updateOne.mock.calls;
  return calls[calls.length - 1][1].$set;
}

describe("processReferendumLifecycle", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("returns null when no active referendums", async () => {
    setup(db, []);
    expect(await processReferendumLifecycle(db as unknown as Db, 110)).toBeNull();
  });

  it("granted → campaigning", async () => {
    setup(db, [
      refDoc({
        status: "granted",
        grantedTurn: 110,
        campaignOpenTurn: 110,
        campaignCloseTurn: 158,
      }),
    ]);
    await processReferendumLifecycle(db as unknown as Db, 111);
    expect(lastSet(db, "referendums").status).toBe("campaigning");
  });

  it("campaigning → polling at campaignCloseTurn", async () => {
    setup(db, [refDoc({ status: "campaigning", campaignCloseTurn: 158 })]);
    await processReferendumLifecycle(db as unknown as Db, 158);
    expect(lastSet(db, "referendums").status).toBe("polling");
  });

  it("campaigning stays put before the campaign window closes", async () => {
    setup(db, [refDoc({ status: "campaigning", campaignCloseTurn: 158 })]);
    const r = await processReferendumLifecycle(db as unknown as Db, 140);
    expect(r!.processed).toBe(0);
  });

  it("polling → actuating with a stamped result when yesShare wins", async () => {
    setup(db, [polling(60)]);
    await processReferendumLifecycle(db as unknown as Db, 159);
    const set = lastSet(db, "referendums");
    expect(set.status).toBe("actuating");
    expect(set.result.passed).toBe(true);
  });

  it("polling → settled with cooldown + desire dampen when yesShare loses", async () => {
    setup(db, [polling(40)]);
    await processReferendumLifecycle(db as unknown as Db, 159);
    const set = lastSet(db, "referendums");
    expect(set.status).toBe("settled");
    expect(set.cooldownReadyAtTurn).toBe(159 + SETTLED_COOLDOWN_TURNS);
    const metricSet = lastSet(db, "macroMetrics");
    expect(metricSet.independenceDesire.value).toBe(SETTLED_DESIRE_TARGET);
  });

  const dualBills = { westminsterBillId: BILL_ID, dailBillId: BILL_ID2 };

  it("actuating → completed when BOTH consent bills pass", async () => {
    setup(db, [refDoc({ status: "actuating", kind: "reunification", ...dualBills })]);
    db.collection("bills").findOne.mockResolvedValue({ status: "signed" });
    const r = await processReferendumLifecycle(db as unknown as Db, 200);
    expect(runReferendumActuation).toHaveBeenCalledOnce();
    expect(r!.transitions.some((t) => t.to === "completed")).toBe(true);
  });

  it("actuating waits while a consent bill is still being voted on", async () => {
    setup(db, [refDoc({ status: "actuating", kind: "reunification", ...dualBills })]);
    // Westminster signed, Dáil still active → wait.
    db.collection("bills").findOne.mockImplementation(async (q: { _id: unknown }) =>
      String(q._id) === String(BILL_ID) ? { status: "signed" } : { status: "active" }
    );
    const r = await processReferendumLifecycle(db as unknown as Db, 180);
    expect(runReferendumActuation).not.toHaveBeenCalled();
    expect(cancelReferendum).not.toHaveBeenCalled();
    expect(r!.processed).toBe(0);
  });

  it("actuating → cancelled (no cooldown) when EITHER consent bill fails", async () => {
    setup(db, [refDoc({ status: "actuating", kind: "reunification", ...dualBills })]);
    // Westminster passes, the Dáil rejects → cancel.
    db.collection("bills").findOne.mockImplementation(async (q: { _id: unknown }) =>
      String(q._id) === String(BILL_ID) ? { status: "signed" } : { status: "failed" }
    );
    const r = await processReferendumLifecycle(db as unknown as Db, 200);
    expect(cancelReferendum).toHaveBeenCalledWith(expect.anything(), expect.anything(), 200, {
      cooldown: false,
    });
    expect(r!.transitions.some((t) => t.to === "cancelled")).toBe(true);
  });

  it("seeds an opening poll point on granted → campaigning", async () => {
    setup(db, [
      refDoc({
        status: "granted",
        grantedTurn: 110,
        campaignOpenTurn: 110,
        campaignCloseTurn: 158,
        campaignBaseYesShare: 64,
      }),
    ]);
    await processReferendumLifecycle(db as unknown as Db, 111);
    const set = lastSet(db, "referendums");
    expect(set.status).toBe("campaigning");
    expect(set.pollHistory).toEqual([{ turn: 110, yesShare: 64 }]);
  });

  it("appends the canonical reading each campaigning turn (no transition)", async () => {
    setup(db, [
      refDoc({
        status: "campaigning",
        campaignOpenTurn: 110,
        campaignCloseTurn: 158,
        campaignBaseYesShare: 50,
        campaignSpendUnits: { yes: 0, no: 0 },
        pollHistory: [{ turn: 110, yesShare: 50 }],
      }),
    ]);
    await processReferendumLifecycle(db as unknown as Db, 140);
    const set = lastSet(db, "referendums");
    expect(set.status).toBeUndefined(); // no transition this turn
    expect(set.pollHistory.at(-1)).toEqual({ turn: 140, yesShare: 50 });
  });

  it("live-seeds an opening point for an already-campaigning ref with no history", async () => {
    setup(db, [
      refDoc({
        status: "campaigning",
        campaignOpenTurn: 120,
        campaignCloseTurn: 168,
        campaignBaseYesShare: 58,
      }),
    ]);
    await processReferendumLifecycle(db as unknown as Db, 140);
    const set = lastSet(db, "referendums");
    expect(set.pollHistory[0]).toEqual({ turn: 120, yesShare: 58 });
    expect(set.pollHistory.at(-1)!.turn).toBe(140);
  });

  it("appends the final canonical reading on campaigning → polling", async () => {
    setup(db, [
      refDoc({
        status: "campaigning",
        campaignOpenTurn: 110,
        campaignCloseTurn: 158,
        campaignBaseYesShare: 55,
        pollHistory: [{ turn: 110, yesShare: 55 }],
      }),
    ]);
    await processReferendumLifecycle(db as unknown as Db, 158);
    const set = lastSet(db, "referendums");
    expect(set.status).toBe("polling");
    expect(set.pollHistory.at(-1)).toEqual({ turn: 158, yesShare: 55 });
  });

  it("is idempotent — re-running the same campaigning turn does not duplicate the point", async () => {
    setup(db, [
      refDoc({
        status: "campaigning",
        campaignOpenTurn: 110,
        campaignCloseTurn: 158,
        campaignBaseYesShare: 50,
        pollHistory: [
          { turn: 110, yesShare: 50 },
          { turn: 140, yesShare: 50 },
        ],
      }),
    ]);
    await processReferendumLifecycle(db as unknown as Db, 140);
    const set = lastSet(db, "referendums");
    expect(set.pollHistory.filter((p: { turn: number }) => p.turn === 140)).toHaveLength(1);
  });

  it("records an 'opened' wire event on granted → campaigning", async () => {
    setup(db, [
      refDoc({ status: "granted", campaignOpenTurn: 110, campaignCloseTurn: 158, regionId: "SCO" }),
    ]);
    db.collection("stateDemographics").findOne.mockResolvedValue(null);
    await processReferendumLifecycle(db as unknown as Db, 111);
    expect(recordWireEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: "opened" })
    );
  });

  it("records a 'swing' when the canonical moves at least the threshold", async () => {
    setup(db, [
      refDoc({
        status: "campaigning",
        campaignOpenTurn: 110,
        campaignCloseTurn: 158,
        campaignBaseYesShare: 50,
        campaignSpendUnits: { yes: 30, no: 0 },
        pollHistory: [{ turn: 139, yesShare: 50 }],
      }),
    ]);
    db.collection("stateDemographics").findOne.mockResolvedValue(null);
    await processReferendumLifecycle(db as unknown as Db, 140);
    expect(recordWireEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: "swing", delta: expect.any(Number) })
    );
  });

  it("records no 'swing' for a sub-threshold move", async () => {
    setup(db, [
      refDoc({
        status: "campaigning",
        campaignOpenTurn: 110,
        campaignCloseTurn: 158,
        campaignBaseYesShare: 50,
        campaignSpendUnits: { yes: 0, no: 0 },
        pollHistory: [{ turn: 139, yesShare: 50 }],
      }),
    ]);
    db.collection("stateDemographics").findOne.mockResolvedValue(null);
    await processReferendumLifecycle(db as unknown as Db, 140);
    const swungCalls = (recordWireEvent as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[1]?.kind === "swing"
    );
    expect(swungCalls).toHaveLength(0);
  });

  it("snapshots cohortBaseline at granted → campaigning from the region's bucket profile", async () => {
    setup(db, [
      refDoc({
        status: "granted",
        grantedTurn: 110,
        campaignOpenTurn: 110,
        campaignCloseTurn: 158,
        campaignBaseYesShare: 55,
        regionId: "NIR",
      }),
    ]);
    // Only `countryId` is read off the doc now — the cohorts come from the
    // Layer-1 substrate, which is the electorate the vote engine counts.
    db.collection("stateDemographics").findOne.mockResolvedValue({ _id: "NIR", countryId: "UK" });
    await processReferendumLifecycle(db as unknown as Db, 111);
    const set = lastSet(db, "referendums");
    expect(set.status).toBe("campaigning");
    expect(Array.isArray(set.cohortBaseline)).toBe(true);
    const ids: string[] = set.cohortBaseline.map((c: { groupId: string }) => c.groupId);
    expect(ids).toContain("age:senior");
    expect(ids).toContain("urbanization:urban");
    expect(ids).not.toContain("_all");
    // Re-centered to the region's desire, and shaped by the NIR affinity table:
    // the young lean Yes, pensioners lean No.
    const byId = new Map(
      set.cohortBaseline.map((c: { groupId: string; yesLean: number }) => [c.groupId, c.yesLean])
    );
    expect(byId.get("age:young")).toBeGreaterThan(byId.get("age:senior") as number);
  });

  it("falls back to a single synthetic cohort when a region has no demographics", async () => {
    setup(db, [
      refDoc({
        status: "granted",
        campaignOpenTurn: 110,
        campaignCloseTurn: 158,
        campaignBaseYesShare: 55,
        regionId: "SCO",
      }),
    ]);
    db.collection("stateDemographics").findOne.mockResolvedValue(null);
    await processReferendumLifecycle(db as unknown as Db, 111);
    const set = lastSet(db, "referendums");
    expect(set.cohortBaseline).toEqual([{ groupId: "_all", share: 1, turnout: 60, yesLean: 55 }]);
  });

  it("resolves from the DERIVED yesShare (base + atomic units), not a stale stored value", async () => {
    // Stored yesShare is deliberately wrong (10); base 50 + 30 Yes units pushes
    // the derived share well above 50 even after worst-case variance → passes.
    setup(db, [
      refDoc({
        status: "polling",
        yesShare: 10,
        campaignBaseYesShare: 50,
        campaignSpendUnits: { yes: 30, no: 0 },
        campaignCloseTurn: 158,
      }),
    ]);
    await processReferendumLifecycle(db as unknown as Db, 159);
    const set = lastSet(db, "referendums");
    expect(set.status).toBe("actuating");
    expect(set.result.passed).toBe(true);
  });
});
