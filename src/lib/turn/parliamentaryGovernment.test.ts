import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/discordWebhooks", () => ({
  sendCountryGameEvent: vi.fn().mockResolvedValue(undefined),
  DISCORD_COLORS: { govCollapsed: 0, govFormed: 0 },
}));
vi.mock("@/lib/notifications", () => ({
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/congress/governmentVoteBreakdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/congress/governmentVoteBreakdown")>();
  return {
    ...actual,
    computeParliamentaryGovernmentTally: vi.fn(actual.computeParliamentaryGovernmentTally),
  };
});

let db: MockDb;

beforeEach(async () => {
  db = createMockDb();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
});

import { ObjectId } from "mongodb";
import {
  cancelActiveNoConfidenceVotes,
  failInProgressBills,
  unformGovernmentAndVacatePM,
  resolveParliamentaryNoConfidenceVote,
  resetParliamentaryGovernmentAfterElection,
  updateParliamentaryGovernmentSeats,
  updateSeatCountsOnly,
  openConfidenceMotionForIncumbent,
  resolveParliamentaryAppointmentVote,
  checkAppointmentEligibility,
  isVoteClosed,
} from "./parliamentaryGovernment";

describe("isVoteClosed — turn-based with closesAt fallback", () => {
  const now = new Date("2026-05-29T22:00:00Z");
  it("uses closesOnTurn when present: closed iff currentTurn >= closesOnTurn", () => {
    expect(isVoteClosed({ closesOnTurn: 110, closesAt: new Date("2000-01-01") }, 109, now)).toBe(
      false
    );
    expect(isVoteClosed({ closesOnTurn: 110, closesAt: new Date("2100-01-01") }, 110, now)).toBe(
      true
    );
  });
  it("freezes during pause: same currentTurn → same result regardless of real time", () => {
    const vote = { closesOnTurn: 110, closesAt: new Date("2000-01-01") };
    expect(isVoteClosed(vote, 105, new Date("2030-01-01"))).toBe(false);
  });
  it("falls back to closesAt when closesOnTurn is absent (pre-backfill docs)", () => {
    expect(isVoteClosed({ closesAt: new Date("2026-05-29T23:00:00Z") }, 105, now)).toBe(false);
    expect(isVoteClosed({ closesAt: new Date("2026-05-29T21:00:00Z") }, 105, now)).toBe(true);
  });
});

describe("cancelActiveNoConfidenceVotes", () => {
  it("cancels every active VONC for the given country and returns the count", async () => {
    db.collectionMocks["noConfidenceVotes"] = {
      ...db.collection("noConfidenceVotes"),
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 2 }),
    } as MockDb["collectionMocks"][string];

    const now = new Date("2026-04-21T12:00:00Z");
    const count = await cancelActiveNoConfidenceVotes(db as unknown as Db, "UK", now);

    expect(count).toBe(2);
    expect(db.collectionMocks["noConfidenceVotes"].updateMany).toHaveBeenCalledWith(
      { countryId: "UK", status: "active" },
      { $set: { status: "cancelled", closedAt: now, updatedAt: now } }
    );
  });

  it("returns 0 and does not throw for countries with no active VONCs", async () => {
    db.collectionMocks["noConfidenceVotes"] = {
      ...db.collection("noConfidenceVotes"),
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    } as MockDb["collectionMocks"][string];

    const count = await cancelActiveNoConfidenceVotes(db as unknown as Db, "US", new Date());
    expect(count).toBe(0);
  });
});

describe("failInProgressBills", () => {
  it("fails lower-chamber in-progress bills only and returns count", async () => {
    db.collectionMocks["bills"] = {
      ...db.collection("bills"),
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 3 }),
    } as MockDb["collectionMocks"][string];

    const now = new Date("2026-04-21T12:00:00Z");
    const count = await failInProgressBills(db as unknown as Db, "UK", now);

    expect(count).toBe(3);
    expect(db.collectionMocks["bills"].updateMany).toHaveBeenCalledWith(
      {
        countryId: "UK",
        currentChamber: "commons",
        status: {
          $in: [
            "proposed",
            "active",
            "passed_origin",
            "active_other",
            // A dissolution kills bills mid-vote in BOTH chambers too.
            "active_both",
            "override_shugiin",
            "veto_override",
            "vetoed",
          ],
        },
      },
      { $set: { status: "failed", failedAt: now, updatedAt: now } }
    );
  });

  it("uses the correct lower-chamber key for each country", async () => {
    db.collectionMocks["bills"] = {
      ...db.collection("bills"),
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    } as MockDb["collectionMocks"][string];

    await failInProgressBills(db as unknown as Db, "US", new Date());
    expect(db.collectionMocks["bills"].updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ countryId: "US", currentChamber: "house" }),
      expect.anything()
    );

    await failInProgressBills(db as unknown as Db, "JP", new Date());
    expect(db.collectionMocks["bills"].updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ countryId: "JP", currentChamber: "shugiin" }),
      expect.anything()
    );
  });

  it("does not include enrolled or cabinet_review in the fail-status list", async () => {
    db.collectionMocks["bills"] = {
      ...db.collection("bills"),
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    } as MockDb["collectionMocks"][string];

    await failInProgressBills(db as unknown as Db, "JP", new Date());
    const filter = (db.collectionMocks["bills"].updateMany as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as { status: { $in: string[] } };
    expect(filter.status.$in).not.toContain("enrolled");
    expect(filter.status.$in).not.toContain("cabinet_review");
  });
});

describe("unformGovernmentAndVacatePM", () => {
  function setupGovMocks(opts: { existing: Record<string, unknown> | null; currentTurn: number }) {
    db.collectionMocks["governmentFormations"] = {
      ...db.collection("governmentFormations"),
      findOne: vi.fn().mockResolvedValue(opts.existing),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["gameState"] = {
      ...db.collection("gameState"),
      findOne: vi.fn().mockResolvedValue({ _id: "current", currentTurn: opts.currentTurn }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["cabinetMembers"] = {
      ...db.collection("cabinetMembers"),
      deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["ukCabinetCooldowns"] = {
      ...db.collection("ukCabinetCooldowns"),
      deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["characters"] = {
      ...db.collection("characters"),
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["npps"] = {
      ...db.collection("npps"),
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    } as MockDb["collectionMocks"][string];
  }

  it("unforms a formed gov: sets pending state, clears PM fields, re-arms vacancy clock, clears cabinet and PM office (collapsedAt: now for snap)", async () => {
    setupGovMocks({
      existing: {
        _id: "UK",
        status: "formed",
        pmCharacterId: new ObjectId(),
        pmVacancyDeadlineTurn: null,
      },
      currentTurn: 100,
    });
    const now = new Date("2026-04-21T12:00:00Z");

    await unformGovernmentAndVacatePM(db as unknown as Db, "UK", now, { reason: "snap" });

    const updateOneCall = (
      db.collectionMocks["governmentFormations"].updateOne as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(updateOneCall[0]).toEqual({ _id: "UK" });
    expect(updateOneCall[1].$set).toMatchObject({
      status: "pending",
      pmCharacterId: null,
      pmName: null,
      formationType: null,
      lostMajority: false,
      coalitionId: null,
      coalitionPartyIds: null,
      activeVoteId: null,
      collapsedAt: now,
      formedAt: null,
      formedTurn: null,
      updatedAt: now,
      pmVacancyDeadlineTurn: 100 + 96,
    });

    expect(db.collectionMocks["cabinetMembers"].deleteMany).toHaveBeenCalledWith({
      countryId: "UK",
    });
    expect(db.collectionMocks["ukCabinetCooldowns"].deleteMany).toHaveBeenCalledWith({
      countryId: "UK",
    });
    expect(db.collectionMocks["characters"].updateMany).toHaveBeenCalledWith(
      { "currentOffice.type": "primeMinister", countryId: "UK" },
      { $set: { currentOffice: null, updatedAt: now } }
    );
    expect(db.collectionMocks["npps"].updateMany).toHaveBeenCalledWith(
      { "currentOffice.type": "primeMinister", countryId: "UK" },
      { $set: { currentOffice: null, updatedAt: now } }
    );
  });

  it("sets collapsedAt: null for reason='post-election'", async () => {
    setupGovMocks({
      existing: { _id: "UK", status: "pending", pmCharacterId: null, pmVacancyDeadlineTurn: null },
      currentTurn: 200,
    });
    const now = new Date("2026-04-21T12:00:00Z");

    await unformGovernmentAndVacatePM(db as unknown as Db, "UK", now, { reason: "post-election" });

    const update = (
      db.collectionMocks["governmentFormations"].updateOne as ReturnType<typeof vi.fn>
    ).mock.calls[0][1].$set;
    expect(update.collapsedAt).toBeNull();
  });

  it("sets collapsedAt: now for reason='no-confidence'", async () => {
    setupGovMocks({
      existing: { _id: "UK", status: "formed", pmCharacterId: new ObjectId() },
      currentTurn: 50,
    });
    const now = new Date("2026-04-21T12:00:00Z");

    await unformGovernmentAndVacatePM(db as unknown as Db, "UK", now, { reason: "no-confidence" });

    const update = (
      db.collectionMocks["governmentFormations"].updateOne as ReturnType<typeof vi.fn>
    ).mock.calls[0][1].$set;
    expect(update.collapsedAt).toEqual(now);
  });

  it("re-arms vacancy clock even when one was already set (matches existing behavior)", async () => {
    setupGovMocks({
      existing: { _id: "UK", status: "pending", pmCharacterId: null, pmVacancyDeadlineTurn: 42 },
      currentTurn: 100,
    });
    const now = new Date();

    await unformGovernmentAndVacatePM(db as unknown as Db, "UK", now, { reason: "snap" });

    const update = (
      db.collectionMocks["governmentFormations"].updateOne as ReturnType<typeof vi.fn>
    ).mock.calls[0][1].$set;
    expect(update.pmVacancyDeadlineTurn).toBe(100 + 96);
  });

  it("is a no-op when governmentFormations record does not exist", async () => {
    setupGovMocks({ existing: null, currentTurn: 0 });
    const now = new Date();

    await unformGovernmentAndVacatePM(db as unknown as Db, "US", now, { reason: "snap" });

    expect(db.collectionMocks["governmentFormations"].updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["cabinetMembers"].deleteMany).not.toHaveBeenCalled();
    expect(db.collectionMocks["characters"].updateMany).not.toHaveBeenCalled();
  });

  it("scopes PM office clear to the given country", async () => {
    setupGovMocks({
      existing: { _id: "UK", status: "formed", pmCharacterId: new ObjectId() },
      currentTurn: 0,
    });
    await unformGovernmentAndVacatePM(db as unknown as Db, "UK", new Date(), { reason: "snap" });

    const charsCall = (db.collectionMocks["characters"].updateMany as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(charsCall.countryId).toBe("UK");
  });
});

describe("resolveParliamentaryNoConfidenceVote — passed-branch refactor regression", () => {
  it("produces the same end state as inline implementation", async () => {
    const voteId = new ObjectId();
    const targetPmId = new ObjectId();
    // Pass/fail is decided by the seat-weighted recompute of the votes map.
    const ayeNppId = new ObjectId();
    const nayNppId = new ObjectId();
    db.collectionMocks["noConfidenceVotes"] = {
      ...db.collection("noConfidenceVotes"),
      findOne: vi.fn().mockResolvedValue({
        _id: voteId,
        countryId: "UK",
        status: "active",
        votesFor: 350,
        votesAgainst: 200,
        votes: { [`npp_${ayeNppId.toString()}`]: "aye", [`npp_${nayNppId.toString()}`]: "nay" },
        targetPmCharacterId: targetPmId,
      }),
      findOneAndUpdate: vi.fn().mockResolvedValue({
        _id: voteId,
        countryId: "UK",
        status: "passed",
      }),
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    } as MockDb["collectionMocks"][string];

    db.collectionMocks["governmentFormations"] = {
      ...db.collection("governmentFormations"),
      findOne: vi
        .fn()
        .mockResolvedValue({ _id: "UK", status: "formed", pmCharacterId: targetPmId }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["gameState"] = {
      ...db.collection("gameState"),
      findOne: vi.fn().mockResolvedValue({ _id: "current", currentTurn: 100 }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["electedOfficials"] = {
      ...db.collection("electedOfficials"),
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { nppId: ayeNppId, isNPP: true, countryId: "UK", officeType: "commons", seatsHeld: 350 },
          { nppId: nayNppId, isNPP: true, countryId: "UK", officeType: "commons", seatsHeld: 200 },
        ]),
        sort: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["cabinetMembers"] = {
      ...db.collection("cabinetMembers"),
      deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["ukCabinetCooldowns"] = {
      ...db.collection("ukCabinetCooldowns"),
      deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["characters"] = {
      ...db.collection("characters"),
      findOne: vi.fn().mockResolvedValue({ _id: targetPmId, userId: new ObjectId() }),
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["npps"] = {
      ...db.collection("npps"),
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    } as MockDb["collectionMocks"][string];

    const now = new Date("2026-04-21T12:00:00Z");
    await resolveParliamentaryNoConfidenceVote(db as unknown as Db, "UK", voteId, now);

    const updateCalls = (
      db.collectionMocks["governmentFormations"].updateOne as ReturnType<typeof vi.fn>
    ).mock.calls;
    const unformCall = updateCalls.find((c) => c[1].$set?.status === "pending");
    expect(unformCall).toBeDefined();
    expect(unformCall![1].$set).toMatchObject({
      status: "pending",
      pmCharacterId: null,
      pmName: null,
      formationType: null,
      coalitionId: null,
      coalitionPartyIds: null,
      activeVoteId: null,
      collapsedAt: now,
      formedAt: null,
      formedTurn: null,
      pmVacancyDeadlineTurn: 100 + 96,
    });
    expect(db.collectionMocks["cabinetMembers"].deleteMany).toHaveBeenCalledWith({
      countryId: "UK",
    });
    expect(db.collectionMocks["characters"].updateMany).toHaveBeenCalledWith(
      { "currentOffice.type": "primeMinister", countryId: "UK" },
      { $set: { currentOffice: null, updatedAt: now } }
    );
  });
});

describe("resetParliamentaryGovernmentAfterElection — else-branch refactor regression", () => {
  it("preserves existing fields when taking the no-sitting-PM branch", async () => {
    db.collectionMocks["governmentFormations"] = {
      ...db.collection("governmentFormations"),
      findOne: vi.fn().mockResolvedValue({
        _id: "UK",
        status: "pending",
        pmCharacterId: null,
        cycle: 1,
        createdAt: new Date("2020-01-01"),
      }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["gameState"] = {
      ...db.collection("gameState"),
      findOne: vi.fn().mockResolvedValue({ _id: "current", currentTurn: 200 }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["electedOfficials"] = {
      ...db.collection("electedOfficials"),
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
        sort: vi.fn().mockReturnThis(),
      }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["pmAppointmentVotes"] = {
      ...db.collection("pmAppointmentVotes"),
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["noConfidenceVotes"] = {
      ...db.collection("noConfidenceVotes"),
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["cabinetMembers"] = {
      ...db.collection("cabinetMembers"),
      deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["ukCabinetCooldowns"] = {
      ...db.collection("ukCabinetCooldowns"),
      deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["characters"] = {
      ...db.collection("characters"),
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["npps"] = {
      ...db.collection("npps"),
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    } as MockDb["collectionMocks"][string];

    const now = new Date("2026-04-21T12:00:00Z");
    await resetParliamentaryGovernmentAfterElection(db as unknown as Db, "UK", now);

    const updates = (
      db.collectionMocks["governmentFormations"].updateOne as ReturnType<typeof vi.fn>
    ).mock.calls;
    const cycleUpsert = updates.find((c) => c[1].$set?.cycle === 2);
    expect(cycleUpsert).toBeDefined();
    expect(cycleUpsert![1].$set).toMatchObject({
      cycle: 2,
      status: "pending",
      pmCharacterId: null,
      pmName: null,
      formationType: null,
      lostMajority: false,
      coalitionId: null,
      coalitionPartyIds: null,
      activeVoteId: null,
      collapsedAt: null,
      formedAt: null,
      formedTurn: null,
      pmVacancyDeadlineTurn: 200 + 96,
    });
    expect(cycleUpsert![2]).toEqual({ upsert: true });
  });
});

describe("updateSeatCountsOnly", () => {
  it("bumps cycle, recalculates seatsByParty and governingPartyId, leaves PM state alone", async () => {
    db.collectionMocks["governmentFormations"] = {
      ...db.collection("governmentFormations"),
      findOne: vi.fn().mockResolvedValue({
        _id: "UK",
        status: "formed",
        pmCharacterId: new ObjectId(),
        pmName: "Sitting PM",
        cycle: 5,
      }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["electedOfficials"] = {
      ...db.collection("electedOfficials"),
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { party: "1", seatsHeld: 340, officeType: "commons", countryId: "UK" },
          { party: "2", seatsHeld: 200, officeType: "commons", countryId: "UK" },
        ]),
        sort: vi.fn().mockReturnThis(),
      }),
    } as MockDb["collectionMocks"][string];

    const now = new Date("2026-04-22T12:00:00Z");
    await updateSeatCountsOnly(db as unknown as Db, "UK", now);

    const call = (db.collectionMocks["governmentFormations"].updateOne as ReturnType<typeof vi.fn>)
      .mock.calls[0];
    expect(call[0]).toEqual({ _id: "UK" });
    const update = call[1].$set;
    expect(update.cycle).toBe(6);
    expect(update.seatsByParty).toEqual({ "1": 340, "2": 200 });
    expect(update.governingPartyId).toBe("1");
    expect(update.updatedAt).toEqual(now);

    // PM fields untouched
    expect(update.pmCharacterId).toBeUndefined();
    expect(update.pmName).toBeUndefined();
    expect(update.status).toBeUndefined();
    expect(update.collapsedAt).toBeUndefined();
    expect(update.pmVacancyDeadlineTurn).toBeUndefined();
  });

  it("is a no-op when governmentFormations record does not exist", async () => {
    db.collectionMocks["governmentFormations"] = {
      ...db.collection("governmentFormations"),
      findOne: vi.fn().mockResolvedValue(null),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 }),
    } as MockDb["collectionMocks"][string];

    await updateSeatCountsOnly(db as unknown as Db, "US", new Date());
    expect(db.collectionMocks["governmentFormations"].updateOne).not.toHaveBeenCalled();
  });
});

describe("updateParliamentaryGovernmentSeats — auto-seed when doc missing", () => {
  it("creates a pending governmentFormations doc from config when none exists", async () => {
    // Live IE Dáil seats: FF (2) plurality, no majority.
    db.collectionMocks["governmentFormations"] = {
      ...db.collection("governmentFormations"),
      findOne: vi.fn().mockResolvedValue(null),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 0, upsertedCount: 1 }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["electedOfficials"] = {
      ...db.collection("electedOfficials"),
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { party: "2", seatsHeld: 68, officeType: "dail", countryId: "IE" },
          { party: "1", seatsHeld: 32, officeType: "dail", countryId: "IE" },
          { party: "3", seatsHeld: 30, officeType: "dail", countryId: "IE" },
        ]),
        sort: vi.fn().mockReturnThis(),
      }),
    } as MockDb["collectionMocks"][string];

    await updateParliamentaryGovernmentSeats(db as unknown as Db, "IE");

    const call = (db.collectionMocks["governmentFormations"].updateOne as ReturnType<typeof vi.fn>)
      .mock.calls[0];
    expect(call, "expected an upsert of the missing governmentFormations doc").toBeDefined();
    expect(call[0]).toEqual({ _id: "IE" });
    const set = call[1].$set;
    expect(set).toMatchObject({
      _id: "IE",
      countryId: "IE",
      cycle: 1,
      status: "pending",
      formationType: null,
      lostMajority: false,
      pmCharacterId: null,
      pmName: null,
      coalitionId: null,
      coalitionPartyIds: null,
      // Config-derived (COUNTRY_CONFIGS.IE): 160-seat Dáil, 81 majority.
      majorityThreshold: 81,
      totalSeats: 160,
      activeVoteId: null,
      formedAt: null,
      formedTurn: null,
      collapsedAt: null,
    });
    // Live seat snapshot + plurality party computed at seed time.
    expect(set.seatsByParty).toEqual({ "2": 68, "1": 32, "3": 30 });
    expect(set.governingPartyId).toBe("2");
    expect(call[2]).toEqual({ upsert: true });
  });
});

describe("openConfidenceMotionForIncumbent", () => {
  function setupConfidenceMocks(opts: {
    govDoc: Record<string, unknown> | null;
    pmStillHoldsSeat: boolean;
  }) {
    db.collectionMocks["governmentFormations"] = {
      ...db.collection("governmentFormations"),
      findOne: vi.fn().mockResolvedValue(opts.govDoc),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["electedOfficials"] = {
      ...db.collection("electedOfficials"),
      findOne: vi
        .fn()
        .mockResolvedValue(opts.pmStillHoldsSeat ? { _id: new ObjectId(), party: "1" } : null),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["pmAppointmentVotes"] = {
      ...db.collection("pmAppointmentVotes"),
      findOne: vi.fn().mockResolvedValue(null),
      insertOne: vi.fn().mockImplementation(async (doc) => ({
        insertedId: doc._id ?? new ObjectId(),
      })),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["characters"] = {
      ...db.collection("characters"),
      findOne: vi
        .fn()
        .mockResolvedValue(
          opts.govDoc?.pmCharacterId
            ? { _id: opts.govDoc.pmCharacterId, userId: new ObjectId() }
            : null
        ),
    } as MockDb["collectionMocks"][string];
  }

  it("opens a confidence motion when incumbent retained seat", async () => {
    const pmId = new ObjectId();
    setupConfidenceMocks({
      govDoc: {
        _id: "UK",
        status: "formed",
        pmCharacterId: pmId,
        pmName: "Sitting PM",
        formationType: "majority",
        governingPartyId: "1",
        coalitionId: null,
        coalitionPartyIds: null,
      },
      pmStillHoldsSeat: true,
    });

    const now = new Date("2026-04-22T12:00:00Z");
    const { createNotifications } = await import("@/lib/notifications");
    vi.mocked(createNotifications).mockClear();
    const result = await openConfidenceMotionForIncumbent(db as unknown as Db, "UK", now);

    expect(result.opened).toBe(true);
    expect(result.voteId).toBeDefined();
    expect(createNotifications).toHaveBeenCalled();
    const notif = vi.mocked(createNotifications).mock.calls[0][0][0];
    expect(notif.title).toBe("Prime Minister Confidence Motion");

    const insertedDoc = (
      db.collectionMocks["pmAppointmentVotes"].insertOne as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(insertedDoc).toMatchObject({
      countryId: "UK",
      nomineeCharacterId: pmId,
      nomineeName: "Sitting PM",
      nomineePartyId: "1",
      formationType: "majority",
      coalitionId: null,
      coalitionPartyIds: null,
      isConfidenceMotion: true,
      status: "active",
      openedAt: now,
      votesFor: 0,
      votesAgainst: 0,
      votes: {},
    });
    // closesAt = now + 24h
    expect(insertedDoc.closesAt.getTime()).toBe(now.getTime() + 24 * 3_600_000);
  });

  it("returns opened:false when incumbent lost their seat", async () => {
    setupConfidenceMocks({
      govDoc: {
        _id: "UK",
        status: "formed",
        pmCharacterId: new ObjectId(),
        pmName: "PM",
      },
      pmStillHoldsSeat: false,
    });

    const result = await openConfidenceMotionForIncumbent(db as unknown as Db, "UK", new Date());
    expect(result.opened).toBe(false);
    expect(result.reason).toBe("incumbent-lost-seat");
    expect(db.collectionMocks["pmAppointmentVotes"].insertOne).not.toHaveBeenCalled();
  });

  it("returns opened:false when no sitting PM (pmCharacterId null)", async () => {
    setupConfidenceMocks({
      govDoc: { _id: "UK", status: "pending", pmCharacterId: null },
      pmStillHoldsSeat: false,
    });
    const result = await openConfidenceMotionForIncumbent(db as unknown as Db, "UK", new Date());
    expect(result.opened).toBe(false);
    expect(result.reason).toBe("no-incumbent");
  });

  it("returns opened:false when gov is not in formed status", async () => {
    setupConfidenceMocks({
      govDoc: {
        _id: "UK",
        status: "pending",
        pmCharacterId: new ObjectId(),
        pmName: "PM",
      },
      pmStillHoldsSeat: true,
    });
    const result = await openConfidenceMotionForIncumbent(db as unknown as Db, "UK", new Date());
    expect(result.opened).toBe(false);
    expect(result.reason).toBe("gov-not-formed");
  });

  it("returns opened:false when no gov record exists", async () => {
    setupConfidenceMocks({ govDoc: null, pmStillHoldsSeat: false });
    const result = await openConfidenceMotionForIncumbent(db as unknown as Db, "US", new Date());
    expect(result.opened).toBe(false);
    expect(result.reason).toBe("no-incumbent");
  });

  it("returns opened:false when a confidence motion is already active", async () => {
    const pmId = new ObjectId();
    setupConfidenceMocks({
      govDoc: {
        _id: "UK",
        status: "formed",
        pmCharacterId: pmId,
        pmName: "Sitting PM",
        formationType: "majority",
        governingPartyId: "1",
      },
      pmStillHoldsSeat: true,
    });
    db.collectionMocks["pmAppointmentVotes"] = {
      ...db.collectionMocks["pmAppointmentVotes"],
      findOne: vi.fn().mockResolvedValue({ _id: new ObjectId(), isConfidenceMotion: true }),
    } as MockDb["collectionMocks"][string];

    const result = await openConfidenceMotionForIncumbent(db as unknown as Db, "UK", new Date());
    expect(result.opened).toBe(false);
    expect(result.reason).toBe("already-active");
    expect(db.collectionMocks["pmAppointmentVotes"].insertOne).not.toHaveBeenCalled();
  });
});

describe("resolveParliamentaryAppointmentVote — confidence motion failure", () => {
  const voteId = new ObjectId();
  const pmId = new ObjectId();

  function setupMotionFailureMocks(opts: { alternativePassed: boolean }) {
    db.collectionMocks["pmAppointmentVotes"] = {
      ...db.collection("pmAppointmentVotes"),
      findOne: vi.fn().mockImplementation(async (filter: Record<string, unknown>) => {
        // Check status filter FIRST — the alternative-check query has both
        // _id (as $ne) AND status: "passed", so filter._id would match too.
        if (filter.status === "passed") {
          return opts.alternativePassed
            ? { _id: new ObjectId(), countryId: "UK", status: "passed" }
            : null;
        }
        if (filter._id) {
          return {
            _id: voteId,
            countryId: "UK",
            status: "active",
            votesFor: 200,
            votesAgainst: 300, // fails
            nomineeCharacterId: pmId,
            nomineeName: "Sitting PM",
            nomineePartyId: "1",
            formationType: "majority",
            coalitionId: null,
            coalitionPartyIds: null,
            isConfidenceMotion: true,
            votes: {},
          };
        }
        return null;
      }),
      findOneAndUpdate: vi.fn().mockResolvedValue({
        _id: voteId,
        countryId: "UK",
        status: "failed",
      }),
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["governmentFormations"] = {
      ...db.collection("governmentFormations"),
      findOne: vi.fn().mockResolvedValue({
        _id: "UK",
        status: "formed",
        pmCharacterId: pmId,
      }),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["gameState"] = {
      ...db.collection("gameState"),
      findOne: vi.fn().mockResolvedValue({ _id: "current", currentTurn: 100 }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["cabinetMembers"] = {
      ...db.collection("cabinetMembers"),
      deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["ukCabinetCooldowns"] = {
      ...db.collection("ukCabinetCooldowns"),
      deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["characters"] = {
      ...db.collection("characters"),
      findOne: vi.fn().mockResolvedValue({ _id: pmId, userId: new ObjectId() }),
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["npps"] = {
      ...db.collection("npps"),
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["electedOfficials"] = {
      ...db.collection("electedOfficials"),
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
        sort: vi.fn().mockReturnThis(),
      }),
    } as MockDb["collectionMocks"][string];
  }

  it("empty confidence motion (0-0) does not vacate the incumbent", async () => {
    const { computeParliamentaryGovernmentTally } =
      await import("@/lib/congress/governmentVoteBreakdown");
    vi.mocked(computeParliamentaryGovernmentTally).mockResolvedValueOnce({
      votesFor: 0,
      votesAgainst: 0,
      voteByParty: [],
    });
    setupMotionFailureMocks({ alternativePassed: false });

    await resolveParliamentaryAppointmentVote(db as unknown as Db, "UK", voteId, new Date());

    const govUpdateCalls = (
      db.collectionMocks["governmentFormations"].updateOne as ReturnType<typeof vi.fn>
    ).mock.calls;
    const unformCall = govUpdateCalls.find((c) => c[1].$set?.status === "pending");
    expect(unformCall).toBeUndefined();
  });

  it("fails confidence motion with a nay majority and no alternative passed → vacates PM", async () => {
    const { computeParliamentaryGovernmentTally } =
      await import("@/lib/congress/governmentVoteBreakdown");
    vi.mocked(computeParliamentaryGovernmentTally).mockResolvedValueOnce({
      votesFor: 200,
      votesAgainst: 300,
      voteByParty: [],
    });
    setupMotionFailureMocks({ alternativePassed: false });

    const now = new Date("2026-04-22T12:00:00Z");
    await resolveParliamentaryAppointmentVote(db as unknown as Db, "UK", voteId, now);

    const govUpdateCalls = (
      db.collectionMocks["governmentFormations"].updateOne as ReturnType<typeof vi.fn>
    ).mock.calls;
    const unformCall = govUpdateCalls.find((c) => c[1].$set?.status === "pending");
    expect(unformCall).toBeDefined();
    expect(unformCall![1].$set).toMatchObject({
      status: "pending",
      pmCharacterId: null,
      pmName: null,
      collapsedAt: now,
      pmVacancyDeadlineTurn: 100 + 96,
    });
  });

  it("fails confidence motion but an alternative already passed → does NOT vacate", async () => {
    const { computeParliamentaryGovernmentTally } =
      await import("@/lib/congress/governmentVoteBreakdown");
    vi.mocked(computeParliamentaryGovernmentTally).mockResolvedValueOnce({
      votesFor: 200,
      votesAgainst: 300,
      voteByParty: [],
    });
    setupMotionFailureMocks({ alternativePassed: true });

    await resolveParliamentaryAppointmentVote(db as unknown as Db, "UK", voteId, new Date());

    const govUpdateCalls = (
      db.collectionMocks["governmentFormations"].updateOne as ReturnType<typeof vi.fn>
    ).mock.calls;
    const unformCall = govUpdateCalls.find((c) => c[1].$set?.status === "pending");
    expect(unformCall).toBeUndefined();
  });
});

describe("resolveParliamentaryNoConfidenceVote — VONC-fail cancels parallel appointment votes", () => {
  it("when VONC fails, cancels active pmAppointmentVotes for the country and notifies nominees", async () => {
    const voteId = new ObjectId();
    const targetPmId = new ObjectId();
    const nomineeId = new ObjectId();

    db.collectionMocks["noConfidenceVotes"] = {
      ...db.collection("noConfidenceVotes"),
      findOne: vi.fn().mockResolvedValue({
        _id: voteId,
        countryId: "UK",
        status: "active",
        votesFor: 200,
        votesAgainst: 300, // fails
        targetPmCharacterId: targetPmId,
      }),
      findOneAndUpdate: vi.fn().mockResolvedValue({
        _id: voteId,
        countryId: "UK",
        status: "failed",
      }),
    } as MockDb["collectionMocks"][string];

    db.collectionMocks["pmAppointmentVotes"] = {
      ...db.collection("pmAppointmentVotes"),
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: new ObjectId(),
            countryId: "UK",
            status: "active",
            nomineeCharacterId: nomineeId,
          },
        ]),
      }),
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    } as MockDb["collectionMocks"][string];

    db.collectionMocks["governmentFormations"] = {
      ...db.collection("governmentFormations"),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    } as MockDb["collectionMocks"][string];
    const nomineeUserId = new ObjectId();
    const pmUserId = new ObjectId();
    db.collectionMocks["characters"] = {
      ...db.collection("characters"),
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ _id: nomineeId, userId: nomineeUserId }]),
      }),
      findOne: vi.fn().mockImplementation(async (filter: Record<string, unknown>) => {
        const id = filter._id as ObjectId | undefined;
        if (!id) return null;
        if (id.toString() === targetPmId.toString()) {
          return { _id: targetPmId, userId: pmUserId };
        }
        if (id.toString() === nomineeId.toString()) {
          return { _id: nomineeId, userId: nomineeUserId };
        }
        return null;
      }),
    } as MockDb["collectionMocks"][string];

    const { createNotifications } = await import("@/lib/notifications");
    const now = new Date();
    await resolveParliamentaryNoConfidenceVote(db as unknown as Db, "UK", voteId, now);

    expect(db.collectionMocks["pmAppointmentVotes"].updateMany).toHaveBeenCalledWith(
      { countryId: "UK", status: "active" },
      { $set: { status: "cancelled", closedAt: now, updatedAt: now } }
    );

    const batched = vi.mocked(createNotifications).mock.calls.flatMap((call) => call[0]);
    const cancelNotif = batched.find((n) => String(n.title).includes("Cancelled"));
    expect(cancelNotif).toBeDefined();
  });
});

describe("checkAppointmentEligibility minority bids vs an existing majority", () => {
  // UK Commons: 650 seats, majority 326, minority floor ceil(650 * 0.1538) = 100.
  // Set up officials so party "1" controls a clear majority (500 seats) and party "2"
  // sits comfortably above the minority floor (110 seats). The eligibility gate must
  // still return formationType="minority" for party 2's chair — the chamber gets to
  // vote the proposal down, the bid is not suppressed up front.
  const UK_MAJORITY_THRESHOLD = 326;
  const chairId = new ObjectId();

  function withCommonsSeats(seats: Record<string, number>) {
    const officials = Object.entries(seats).flatMap(([partyId, count]) =>
      Array.from({ length: count }, () => ({
        countryId: "UK",
        officeType: "commons",
        party: partyId,
      }))
    );

    db.collectionMocks["electedOfficials"] = {
      ...db.collection("electedOfficials"),
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue(officials),
      }),
      countDocuments: vi.fn().mockImplementation((filter: Record<string, unknown>) => {
        const partyFilter = (filter as { party?: string | { $in: string[] } }).party;
        const wanted =
          partyFilter == null
            ? null
            : typeof partyFilter === "string"
              ? new Set([partyFilter])
              : new Set(partyFilter.$in);
        const count = officials.filter((o) => wanted == null || wanted.has(o.party)).length;
        return Promise.resolve(count);
      }),
    } as MockDb["collectionMocks"][string];
  }

  it("party chair below the majority but above the minority floor is eligible even when another party holds a majority", async () => {
    withCommonsSeats({ "1": 500, "2": 110 });
    db.collectionMocks["politicalParties"] = {
      ...db.collection("politicalParties"),
      findOne: vi.fn().mockResolvedValue({ sequentialId: 2, countryId: "UK", chairId }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["coalitions"] = {
      ...db.collection("coalitions"),
      findOne: vi.fn().mockResolvedValue(null),
    } as MockDb["collectionMocks"][string];

    const result = await checkAppointmentEligibility(
      db as unknown as Db,
      "UK",
      chairId,
      UK_MAJORITY_THRESHOLD
    );

    expect(result).toEqual({
      eligible: true,
      formationType: "minority",
      coalitionId: null,
      coalitionPartyIds: null,
      qualifyingPartyIds: [2],
    });
  });

  it("coalition chair below the majority but above the minority floor is eligible even when another party holds a majority", async () => {
    withCommonsSeats({ "1": 500, "2": 60, "3": 60 });
    db.collectionMocks["politicalParties"] = {
      ...db.collection("politicalParties"),
      findOne: vi.fn().mockResolvedValue(null),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["coalitions"] = {
      ...db.collection("coalitions"),
      findOne: vi.fn().mockResolvedValue({
        sequentialId: 7,
        countryId: "UK",
        chairCharacterId: chairId,
        members: [{ partySequentialId: 2 }, { partySequentialId: 3 }],
      }),
    } as MockDb["collectionMocks"][string];

    const result = await checkAppointmentEligibility(
      db as unknown as Db,
      "UK",
      chairId,
      UK_MAJORITY_THRESHOLD
    );

    expect(result).toEqual({
      eligible: true,
      formationType: "minority",
      coalitionId: 7,
      coalitionPartyIds: ["2", "3"],
      qualifyingPartyIds: [2, 3],
    });
  });

  it("a party chair below the minority floor stays ineligible regardless of the majority landscape", async () => {
    withCommonsSeats({ "1": 500, "2": 99 });
    db.collectionMocks["politicalParties"] = {
      ...db.collection("politicalParties"),
      findOne: vi.fn().mockResolvedValue({ sequentialId: 2, countryId: "UK", chairId }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["coalitions"] = {
      ...db.collection("coalitions"),
      findOne: vi.fn().mockResolvedValue(null),
    } as MockDb["collectionMocks"][string];

    const result = await checkAppointmentEligibility(
      db as unknown as Db,
      "UK",
      chairId,
      UK_MAJORITY_THRESHOLD
    );

    expect(result).toEqual({ eligible: false });
  });

  it("a party chair with their own majority is still classified as majority, not minority", async () => {
    withCommonsSeats({ "1": 326, "2": 200 });
    db.collectionMocks["politicalParties"] = {
      ...db.collection("politicalParties"),
      findOne: vi.fn().mockResolvedValue({ sequentialId: 1, countryId: "UK", chairId }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["coalitions"] = {
      ...db.collection("coalitions"),
      findOne: vi.fn().mockResolvedValue(null),
    } as MockDb["collectionMocks"][string];

    const result = await checkAppointmentEligibility(
      db as unknown as Db,
      "UK",
      chairId,
      UK_MAJORITY_THRESHOLD
    );

    expect(result).toMatchObject({ eligible: true, formationType: "majority" });
  });
});

describe("appointPrimeMinister — same-holder announce guard", () => {
  function setupAppointMocks(priorPmCharacterId: ObjectId | null) {
    db.collectionMocks["governmentFormations"] = {
      ...db.collection("governmentFormations"),
      findOne: vi
        .fn()
        .mockResolvedValue(
          priorPmCharacterId ? { _id: "UK", pmCharacterId: priorPmCharacterId } : null
        ),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["gameState"] = {
      ...db.collection("gameState"),
      findOne: vi.fn().mockResolvedValue({ _id: "current", currentTurn: 100 }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["characters"] = {
      ...db.collection("characters"),
      findOne: vi.fn().mockResolvedValue({ _id: new ObjectId(), party: "LAB" }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["npps"] = {
      ...db.collection("npps"),
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["ukCabinetCooldowns"] = {
      ...db.collection("ukCabinetCooldowns"),
      deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
    } as MockDb["collectionMocks"][string];
  }

  it("does not announce when re-appointing the sitting PM", async () => {
    const pmId = new ObjectId();
    setupAppointMocks(pmId);
    const { appointPrimeMinister } = await import("./parliamentaryGovernment");
    const { sendCountryGameEvent } = await import("@/lib/discordWebhooks");
    vi.mocked(sendCountryGameEvent).mockClear();
    await appointPrimeMinister(db as unknown as Db, "UK", pmId, null, "Same PM", new Date());
    expect(sendCountryGameEvent).not.toHaveBeenCalled();
  });

  it("announces when appointing a genuinely new PM", async () => {
    setupAppointMocks(new ObjectId());
    const { appointPrimeMinister } = await import("./parliamentaryGovernment");
    const { sendCountryGameEvent } = await import("@/lib/discordWebhooks");
    vi.mocked(sendCountryGameEvent).mockClear();
    await appointPrimeMinister(
      db as unknown as Db,
      "UK",
      new ObjectId(),
      null,
      "New PM",
      new Date()
    );
    expect(sendCountryGameEvent).toHaveBeenCalledTimes(1);
  });
});
