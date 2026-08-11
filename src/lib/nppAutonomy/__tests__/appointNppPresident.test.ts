import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

// Gate the function on a controllable nppAutonomyAtLeast; everything else
// (country config, executive-office filter) stays real against country "BR".
const { atLeastMock } = vi.hoisted(() => ({ atLeastMock: vi.fn() }));
vi.mock("../featureFlag", () => ({
  nppAutonomyAtLeast: (...args: unknown[]) => atLeastMock(...args),
}));

import { appointNppPresident } from "../appointNppPresident";

let db: MockDb;
const now = new Date("2026-06-23T12:00:00Z");

function cursor<T>(docs: T[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

function setup(opts: {
  gov: Record<string, unknown> | null;
  seatedPresident?: Record<string, unknown> | null;
  npps?: Array<Record<string, unknown>>;
  /** Live lower-chamber rows backing the seat tally `appointNppPresident` now
   *  derives via `tallySeatsByParty` instead of trusting `gov.seatsByParty`. */
  electedOfficials?: Array<Record<string, unknown>>;
}) {
  db = createMockDb();
  db.collectionMocks["governmentFormations"] = {
    ...db.collection("governmentFormations"),
    findOne: vi.fn().mockResolvedValue(opts.gov),
    updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
  } as MockDb["collectionMocks"][string];
  db.collectionMocks["electedOfficials"] = {
    ...db.collection("electedOfficials"),
    findOne: vi.fn().mockResolvedValue(opts.seatedPresident ?? null),
    find: vi.fn().mockReturnValue(cursor(opts.electedOfficials ?? [])),
    updateOne: vi.fn().mockResolvedValue({ matchedCount: 0, upsertedCount: 1 }),
  } as MockDb["collectionMocks"][string];
  db.collectionMocks["npps"] = {
    ...db.collection("npps"),
    find: vi.fn().mockReturnValue(cursor(opts.npps ?? [])),
    updateMany: vi.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 }),
    updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
  } as MockDb["collectionMocks"][string];
}

beforeEach(() => {
  atLeastMock.mockReset();
});

describe("appointNppPresident", () => {
  const winnerId = new ObjectId();
  const runnerUpId = new ObjectId();
  const pendingGov = { _id: "BR", status: "pending" };
  const npps = [
    { _id: runnerUpId, name: "Runner Up", party: "9", favorability: 40, politicalInfluence: 80 },
    { _id: winnerId, name: "Top Pol", party: "5", favorability: 72, politicalInfluence: 30 },
  ];
  // Live Chamber of Deputies seats backing party "5" — the seat count the
  // formation record's `totalSeatsSupporting` must reflect.
  const chamberSeats = [{ officeType: "chamber", countryId: "BR", party: "5", seatsHeld: 200 }];

  it("does nothing when the v1 gate is not met", async () => {
    atLeastMock.mockResolvedValue(false);
    setup({ gov: pendingGov, npps });
    expect(await appointNppPresident(db as unknown as Db, "BR", 100, now)).toBe(false);
    expect(db.collectionMocks["governmentFormations"].updateOne).not.toHaveBeenCalled();
  });

  it("does nothing for a non-presidential country", async () => {
    atLeastMock.mockResolvedValue(true);
    setup({ gov: pendingGov, npps });
    // UK is parliamentary — the government-system guard must short-circuit.
    expect(await appointNppPresident(db as unknown as Db, "UK", 100, now)).toBe(false);
    expect(db.collectionMocks["governmentFormations"].updateOne).not.toHaveBeenCalled();
  });

  it("does nothing for the US — its president is chosen by the live electoral-college cycle", async () => {
    atLeastMock.mockResolvedValue(true);
    // Even with a vacant office and eligible NPPs, the US must never be
    // party-blind appointed: a US presidential vacancy belongs to the
    // perpetual presidential election (e.g. the 1956 race in a 1953 world).
    setup({ gov: { _id: "US", status: "pending", seatsByParty: { "5": 200 } }, npps });
    expect(await appointNppPresident(db as unknown as Db, "US", 100, now)).toBe(false);
    expect(db.collectionMocks["npps"].updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["governmentFormations"].updateOne).not.toHaveBeenCalled();
  });

  it("does nothing when a president already holds the office", async () => {
    atLeastMock.mockResolvedValue(true);
    setup({
      gov: pendingGov,
      seatedPresident: { officeType: "president", countryId: "BR", nppId: winnerId },
      npps,
    });
    expect(await appointNppPresident(db as unknown as Db, "BR", 100, now)).toBe(false);
    expect(db.collectionMocks["npps"].updateOne).not.toHaveBeenCalled();
  });

  it("does nothing when there is no eligible NPP", async () => {
    atLeastMock.mockResolvedValue(true);
    setup({ gov: pendingGov, npps: [] });
    expect(await appointNppPresident(db as unknown as Db, "BR", 100, now)).toBe(false);
  });

  it("seats the highest-favorability NPP as president and forms the government", async () => {
    atLeastMock.mockResolvedValue(true);
    setup({ gov: pendingGov, npps, electedOfficials: chamberSeats });

    const seated = await appointNppPresident(db as unknown as Db, "BR", 100, now);
    expect(seated).toBe(true);

    // Top Pol (favorability 72) beats Runner Up (40) despite lower influence.
    const officialUpdate = (
      db.collectionMocks["electedOfficials"].updateOne as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(officialUpdate[1].$set).toMatchObject({
      officeType: "president",
      countryId: "BR",
      isNPP: true,
      nppId: winnerId,
      characterId: null,
    });

    // The NPP's currentOffice is set to president.
    expect(db.collectionMocks["npps"].updateOne).toHaveBeenCalledWith(
      { _id: winnerId },
      { $set: { currentOffice: { type: "president" }, updatedAt: now } }
    );

    const govUpdate = (
      db.collectionMocks["governmentFormations"].updateOne as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(govUpdate[1].$set).toMatchObject({
      status: "formed",
      presidentNppId: winnerId,
      presidentName: "Top Pol",
      pmName: "Top Pol",
      pmNppId: null,
      governingPartyId: "5",
      totalSeatsSupporting: 200,
      formedTurn: 100,
    });
  });

  it("breaks favorability ties by political influence", async () => {
    atLeastMock.mockResolvedValue(true);
    const tied = [
      { _id: runnerUpId, name: "Low Inf", party: "9", favorability: 60, politicalInfluence: 10 },
      { _id: winnerId, name: "High Inf", party: "5", favorability: 60, politicalInfluence: 90 },
    ];
    setup({ gov: pendingGov, npps: tied, electedOfficials: chamberSeats });
    await appointNppPresident(db as unknown as Db, "BR", 100, now);
    const govUpdate = (
      db.collectionMocks["governmentFormations"].updateOne as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(govUpdate[1].$set.presidentNppId).toEqual(winnerId);
  });

  it("derives totalSeatsSupporting live, ignoring a stale/wrong gov.seatsByParty", async () => {
    // Regression for the stale-cache defect: `governmentFormations.seatsByParty`
    // is a write-triggered cache that can drift arbitrarily far from the real
    // chamber (measured in the field: 0 against a real 513-seat Chamber of
    // Deputies). Seed the stored cache with a wildly wrong count for the
    // winning party and assert the formation record reflects the live tally.
    atLeastMock.mockResolvedValue(true);
    setup({
      gov: { _id: "BR", status: "pending", seatsByParty: { "5": 999_999 } },
      npps,
      electedOfficials: chamberSeats, // live truth: party "5" holds 200 seats
    });
    await appointNppPresident(db as unknown as Db, "BR", 100, now);
    const govUpdate = (
      db.collectionMocks["governmentFormations"].updateOne as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(govUpdate[1].$set.totalSeatsSupporting).toBe(200);
  });
});
