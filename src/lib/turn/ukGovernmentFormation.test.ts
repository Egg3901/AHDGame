/**
 * Unit tests for ukGovernmentFormation — seat updates + post-election reset.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

let db: MockDb;
beforeEach(async () => {
  vi.resetAllMocks();
  db = createMockDb();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

  // Pre-register all collections used by these tests so collectionMocks is populated
  // before individual tests set mock return values on them.
  for (const name of [
    "electedOfficials",
    "governmentFormations",
    "coalitions",
    "pmAppointmentVotes",
    "noConfidenceVotes",
    "cabinetMembers",
    "ukCabinetCooldowns",
  ]) {
    db.collection(name);
  }
});

const NOW = new Date("2025-06-15T12:00:00Z");

// ---------------------------------------------------------------------------
// tallyCommonsSeatsByParty
// ---------------------------------------------------------------------------

describe("tallyCommonsSeatsByParty", () => {
  // Dynamic import of ukGovernmentFormation can exceed default 5s when the module graph is cold.
  it("sums seats by party from electedOfficials", async () => {
    const { tallyCommonsSeatsByParty } = await import("./ukGovernmentFormation");

    db.collectionMocks["electedOfficials"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { party: "1", seatsHeld: 340, officeType: "commons", countryId: "UK" },
        { party: "1", seatsHeld: 10, officeType: "commons", countryId: "UK" },
        { party: "2", seatsHeld: 200, officeType: "commons", countryId: "UK" },
        { party: "3", seatsHeld: 100, officeType: "commons", countryId: "UK" },
        // No party — should be skipped
        { party: null, seatsHeld: 5, officeType: "commons", countryId: "UK" },
      ]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    const result = await tallyCommonsSeatsByParty(db as unknown as Db);

    expect(result).toEqual({ "1": 350, "2": 200, "3": 100 });
    expect(db.collectionMocks["electedOfficials"]!.find).toHaveBeenCalledWith({
      officeType: "commons",
      countryId: "UK",
    });
  }, 20_000);
});

// ---------------------------------------------------------------------------
// getLargestParty
// ---------------------------------------------------------------------------

describe("getLargestParty", () => {
  it("returns party with most seats", async () => {
    const { getLargestParty } = await import("./ukGovernmentFormation");
    expect(getLargestParty({ "1": 340, "2": 200, "3": 100 })).toBe("1");
  });

  it("returns null for empty map", async () => {
    const { getLargestParty } = await import("./ukGovernmentFormation");
    expect(getLargestParty({})).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// updateGovernmentSeats
// ---------------------------------------------------------------------------

describe("updateGovernmentSeats", () => {
  it("updates seatsByParty and detects lost majority for majority government", async () => {
    const { updateGovernmentSeats } = await import("./ukGovernmentFormation");

    // Existing government: majority formed with 340 seats
    db.collectionMocks["governmentFormations"]!.findOne.mockResolvedValue({
      _id: "UK",
      countryId: "UK",
      status: "formed",
      formationType: "majority",
      governingPartyId: "1",
      coalitionId: null,
      lostMajority: false,
      totalSeatsSupporting: 340,
      majorityThreshold: 326,
    });

    // New tally: party 1 dropped below majority
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { party: "1", seatsHeld: 300, officeType: "commons", countryId: "UK" },
        { party: "2", seatsHeld: 250, officeType: "commons", countryId: "UK" },
        { party: "3", seatsHeld: 100, officeType: "commons", countryId: "UK" },
      ]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    await updateGovernmentSeats();

    const updateCall = db.collectionMocks["governmentFormations"]!.updateOne.mock.calls[0];
    expect(updateCall).toBeDefined();
    const updateDoc = updateCall![1] as { $set: Record<string, unknown> };
    expect(updateDoc.$set.seatsByParty).toEqual({ "1": 300, "2": 250, "3": 100 });
    expect(updateDoc.$set.totalSeatsSupporting).toBe(300);
    expect(updateDoc.$set.lostMajority).toBe(true);
  });

  it("calculates coalition seats dynamically from coalitions collection", async () => {
    const { updateGovernmentSeats } = await import("./ukGovernmentFormation");

    // Coalition government: parties 1 and 2 together have 330 seats
    db.collectionMocks["governmentFormations"]!.findOne.mockResolvedValue({
      _id: "UK",
      countryId: "UK",
      status: "formed",
      formationType: "coalition",
      governingPartyId: "1",
      coalitionId: 5,
      lostMajority: false,
      totalSeatsSupporting: 330,
      majorityThreshold: 326,
    });

    // Coalition doc with two member parties
    db.collectionMocks["coalitions"]!.findOne.mockResolvedValue({
      sequentialId: 5,
      countryId: "UK",
      members: [{ partySequentialId: 1 }, { partySequentialId: 2 }],
    });

    // Current tally
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { party: "1", seatsHeld: 200, officeType: "commons", countryId: "UK" },
        { party: "2", seatsHeld: 150, officeType: "commons", countryId: "UK" },
        { party: "3", seatsHeld: 100, officeType: "commons", countryId: "UK" },
      ]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    await updateGovernmentSeats();

    const updateCall = db.collectionMocks["governmentFormations"]!.updateOne.mock.calls[0];
    const updateDoc = updateCall![1] as { $set: Record<string, unknown> };
    // Coalition total = 200 + 150 = 350
    expect(updateDoc.$set.totalSeatsSupporting).toBe(350);
    expect(updateDoc.$set.lostMajority).toBe(false);
  });

  it("does not set lostMajority for minority governments", async () => {
    const { updateGovernmentSeats } = await import("./ukGovernmentFormation");

    db.collectionMocks["governmentFormations"]!.findOne.mockResolvedValue({
      _id: "UK",
      countryId: "UK",
      status: "formed",
      formationType: "minority",
      governingPartyId: "1",
      coalitionId: null,
      lostMajority: false,
      totalSeatsSupporting: 280,
      majorityThreshold: 326,
    });

    // Minority party loses some seats but still below majority — no lostMajority
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { party: "1", seatsHeld: 260, officeType: "commons", countryId: "UK" },
        { party: "2", seatsHeld: 200, officeType: "commons", countryId: "UK" },
      ]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    await updateGovernmentSeats();

    const updateCall = db.collectionMocks["governmentFormations"]!.updateOne.mock.calls[0];
    const updateDoc = updateCall![1] as { $set: Record<string, unknown> };
    expect(updateDoc.$set.lostMajority).toBe(false);
  });

  it("seeds the document when no government doc exists and no legacy PM found", async () => {
    const { updateGovernmentSeats } = await import("./ukGovernmentFormation");

    db.collectionMocks["governmentFormations"]!.findOne.mockResolvedValue(null);
    // Pre-initialize and mock legacy collections
    db.collection("ukGovernment");
    db.collection("parliamentaryGovernments");
    db.collectionMocks["ukGovernment"]!.findOne.mockResolvedValue(null);
    db.collectionMocks["parliamentaryGovernments"]!.findOne.mockResolvedValue(null);

    await updateGovernmentSeats();

    // Should upsert a new document in "pending" status
    expect(db.collectionMocks["governmentFormations"]!.updateOne).toHaveBeenCalledWith(
      { _id: "UK" },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "pending" }),
      }),
      { upsert: true }
    );
  });
});

// ---------------------------------------------------------------------------
// resetGovernmentAfterElection
// ---------------------------------------------------------------------------

describe("resetGovernmentAfterElection", () => {
  it("resets government to pending with fresh seat data and increments cycle", async () => {
    const { resetGovernmentAfterElection } = await import("./ukGovernmentFormation");

    // Existing doc — cycle 3
    db.collectionMocks["governmentFormations"]!.findOne.mockResolvedValue({
      _id: "UK",
      cycle: 3,
      createdAt: new Date("2025-01-01"),
    });

    db.collectionMocks["electedOfficials"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { party: "1", seatsHeld: 340, officeType: "commons", countryId: "UK" },
        { party: "2", seatsHeld: 200, officeType: "commons", countryId: "UK" },
      ]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    await resetGovernmentAfterElection(NOW);

    // Find the cycle-fields upsert call (refactor: unformGovernmentAndVacatePM
    // may have written an earlier non-upsert update on the same collection).
    const calls = db.collectionMocks["governmentFormations"]!.updateOne.mock.calls;
    const upsertCall = calls.find((c) => (c[1] as { $set?: { cycle?: number } }).$set?.cycle === 4);
    expect(upsertCall).toBeDefined();
    const filter = upsertCall![0];
    const update = upsertCall![1] as { $set: Record<string, unknown> };
    const options = upsertCall![2];

    expect(filter).toEqual({ _id: "UK" });
    expect(options).toEqual({ upsert: true });
    expect(update.$set.cycle).toBe(4); // incremented
    expect(update.$set.status).toBe("pending");
    expect(update.$set.formationType).toBeNull();
    expect(update.$set.governingPartyId).toBe("1"); // largest party
    expect(update.$set.pmCharacterId).toBeNull();
    expect(update.$set.pmName).toBeNull();
    expect(update.$set.seatsByParty).toEqual({ "1": 340, "2": 200 });
    expect(update.$set.lostMajority).toBe(false);
    expect(update.$set.activeVoteId).toBeNull();
  });

  it("starts cycle at 1 when no existing doc", async () => {
    const { resetGovernmentAfterElection } = await import("./ukGovernmentFormation");

    db.collectionMocks["governmentFormations"]!.findOne.mockResolvedValue(null);

    db.collectionMocks["electedOfficials"]!.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([
          { party: "2", seatsHeld: 150, officeType: "commons", countryId: "UK" },
        ]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    await resetGovernmentAfterElection(NOW);

    const upsertCall = db.collectionMocks["governmentFormations"]!.updateOne.mock.calls[0];
    const update = upsertCall![1] as { $set: Record<string, unknown> };
    expect(update.$set.cycle).toBe(1);
  });

  it("cancels active pmAppointmentVotes and noConfidenceVotes", async () => {
    const { resetGovernmentAfterElection } = await import("./ukGovernmentFormation");

    db.collectionMocks["governmentFormations"]!.findOne.mockResolvedValue({
      _id: "UK",
      cycle: 1,
      createdAt: new Date("2025-01-01"),
    });

    db.collectionMocks["electedOfficials"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    await resetGovernmentAfterElection(NOW);

    // Active pmAppointmentVotes cancelled
    const pmVoteUpdate = db.collectionMocks["pmAppointmentVotes"]!.updateMany;
    expect(pmVoteUpdate).toHaveBeenCalledWith(
      { countryId: "UK", status: "active" },
      expect.objectContaining({ $set: expect.objectContaining({ status: "cancelled" }) })
    );

    // Active noConfidenceVotes cancelled
    const noConfUpdate = db.collectionMocks["noConfidenceVotes"]!.updateMany;
    expect(noConfUpdate).toHaveBeenCalledWith(
      { countryId: "UK", status: "active" },
      expect.objectContaining({ $set: expect.objectContaining({ status: "cancelled" }) })
    );
  });

  it("clears cabinetMembers and ukCabinetCooldowns", async () => {
    const { resetGovernmentAfterElection } = await import("./ukGovernmentFormation");

    db.collectionMocks["governmentFormations"]!.findOne.mockResolvedValue({
      _id: "UK",
      cycle: 2,
      createdAt: new Date("2025-01-01"),
    });

    db.collectionMocks["electedOfficials"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    await resetGovernmentAfterElection(NOW);

    expect(db.collectionMocks["cabinetMembers"]!.deleteMany).toHaveBeenCalledWith({
      countryId: "UK",
    });
    expect(db.collectionMocks["ukCabinetCooldowns"]!.deleteMany).toHaveBeenCalledWith({
      countryId: "UK",
    });
  });
});
