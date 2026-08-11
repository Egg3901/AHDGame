/**
 * Unit tests for UK government turn processing — confidence and no-confidence votes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";

// Mock all external dependencies
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
// Avoid pulling the full turn orchestrator (circular import: turnSystem ↔ ukGovernment).
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentTurn: 1 }),
}));
vi.mock("@/lib/notifications", () => ({
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/discordWebhooks", () => ({
  sendCountryGameEvent: vi.fn().mockResolvedValue(undefined),
  DISCORD_COLORS: { govFormed: 0x9b59b6, govCollapsed: 0xff0000 },
}));
vi.mock("@/lib/cabinetTransition", () => ({
  clearCabinetOnTransition: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/utils/politics", () => ({
  getOfficeLabel: vi.fn().mockReturnValue("Prime Minister"),
  // The seat-weighted recompute builds a per-party breakdown, which colours
  // each party via getPartyHex.
  getPartyHex: vi.fn().mockReturnValue("#8B5CF6"),
}));

vi.mock("./ukGovernmentFormation", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./ukGovernmentFormation")>();
  return {
    ...orig,
    updateGovernmentSeats: vi.fn().mockResolvedValue(undefined),
  };
});

// Mock the collection helper functions to return standard mock collections

// Shared mock for the ukCabinetCooldowns returned by the collection helper
const mockUkGovCabinetCooldowns = {
  deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
};

vi.mock("@/lib/db/collections/ukGovernment", () => ({
  getUKCabinetCooldownsCollection: vi.fn().mockReturnValue(mockUkGovCabinetCooldowns),
}));

vi.mock("@/lib/constants/countries", () => ({
  COUNTRY_CONFIGS: {
    UK: {
      id: "UK",
      name: "United Kingdom",
      executiveTitle: "Prime Minister",
      governmentType: "parliamentaryMonarchy",
      coalitionThreshold: 326,
      legislature: {
        lowerChamber: { key: "commons", seats: 650 },
      },
      // chamberOfficeType helpers introspect this; falling back to the chamber
      // key gives the legacy "commons" identifier these tests were written for.
      officeTypes: [],
    },
  },
  getCountryConfig: vi.fn().mockReturnValue({
    id: "UK",
    name: "United Kingdom",
    executiveTitle: "Prime Minister",
    governmentType: "parliamentaryMonarchy",
    coalitionThreshold: 326,
    legislature: {
      lowerChamber: { key: "commons", seats: 650 },
    },
    officeTypes: [],
  }),
  getExecutiveOfficeKey: vi.fn().mockReturnValue("prime_minister"),
}));

const NOW = new Date("2025-06-15T12:00:00Z");

function makeCursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

// ---------------------------------------------------------------------------
// New government formation system (GovernmentFormation + PMAppointmentVote +
// NoConfidenceVote collections from Task 1-3)
// ---------------------------------------------------------------------------

// Shared mock objects for the new collections
const mockPMAppointmentVotes = {
  find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
  findOne: vi.fn(),
  findOneAndUpdate: vi.fn(),
  updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
  updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
};
const mockNewNoConfidenceVotes = {
  find: vi.fn(),
  findOne: vi.fn(),
  findOneAndUpdate: vi.fn(),
  updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
};
const mockGovernmentFormations = {
  findOne: vi.fn(),
  updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
};
const mockBillWhips = {
  find: vi.fn(),
};
const mockUkCabinetMembers = {
  deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
};
const mockUkCabinetCooldowns = {
  deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
};

vi.mock("@/lib/db/collections/governmentFormation", () => ({
  getPMAppointmentVotesCollection: vi.fn().mockReturnValue(mockPMAppointmentVotes),
  getNoConfidenceVotesCollection: vi.fn().mockReturnValue(mockNewNoConfidenceVotes),
  getGovernmentFormationsCollection: vi.fn().mockReturnValue(mockGovernmentFormations),
}));

describe("autoAyeNPPsForAppointment", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("electedOfficials");
    db.collection("billWhips");
    db.collection("ukCabinetCooldowns");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    mockBillWhips.find.mockReturnValue(makeCursor([]));
    mockUkCabinetCooldowns.deleteMany.mockResolvedValue({ deletedCount: 0 });

    // Wire up db.collection() calls for collections not controlled by helpers
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["billWhips"] =
      mockBillWhips as unknown as (typeof db.collectionMocks)[string];
    db.collectionMocks["ukCabinetCooldowns"] =
      mockUkCabinetCooldowns as unknown as (typeof db.collectionMocks)[string];
  });

  it("auto-ayes majority party NPPs", async () => {
    const voteId = new ObjectId();
    const nppId = new ObjectId();
    const vote = {
      _id: voteId,
      countryId: "UK",
      nomineePartyId: "1",
      formationType: "majority",
      coalitionPartyIds: null,
      votesFor: 0,
      votesAgainst: 0,
      votes: {},
      status: "active",
      openedAt: NOW,
      closesAt: new Date(NOW.getTime() + 24 * 3_600_000),
    };

    mockPMAppointmentVotes.findOne.mockResolvedValue(vote);
    mockBillWhips.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(
      makeCursor([
        {
          _id: new ObjectId(),
          officeType: "commons",
          countryId: "UK",
          party: "1",
          isNPP: true,
          nppId,
          seatsHeld: 2,
        },
      ])
    );

    const { autoAyeNPPsForAppointment } = await import("./ukGovernment");
    await autoAyeNPPsForAppointment(db as unknown as import("mongodb").Db, voteId);

    expect(mockPMAppointmentVotes.updateOne).toHaveBeenCalledWith(
      { _id: voteId, [`votes.npp_${nppId.toString()}`]: { $exists: false } },
      expect.objectContaining({
        $set: expect.objectContaining({ [`votes.npp_${nppId.toString()}`]: "aye" }),
        $inc: { votesFor: 2 },
      })
    );
  });

  it("auto-ayes all coalition party NPPs", async () => {
    const voteId = new ObjectId();
    const npp1Id = new ObjectId();
    const npp2Id = new ObjectId();
    const vote = {
      _id: voteId,
      countryId: "UK",
      nomineePartyId: "1",
      formationType: "coalition",
      coalitionPartyIds: ["1", "2"],
      votesFor: 0,
      votesAgainst: 0,
      votes: {},
      status: "active",
      openedAt: NOW,
      closesAt: new Date(NOW.getTime() + 24 * 3_600_000),
    };

    mockPMAppointmentVotes.findOne.mockResolvedValue(vote);
    mockBillWhips.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(
      makeCursor([
        {
          _id: new ObjectId(),
          officeType: "commons",
          countryId: "UK",
          party: "1",
          isNPP: true,
          nppId: npp1Id,
          seatsHeld: 1,
        },
        {
          _id: new ObjectId(),
          officeType: "commons",
          countryId: "UK",
          party: "2",
          isNPP: true,
          nppId: npp2Id,
          seatsHeld: 1,
        },
        {
          _id: new ObjectId(),
          officeType: "commons",
          countryId: "UK",
          party: "3", // Not in coalition — should be skipped
          isNPP: true,
          nppId: new ObjectId(),
          seatsHeld: 1,
        },
      ])
    );

    const { autoAyeNPPsForAppointment } = await import("./ukGovernment");
    await autoAyeNPPsForAppointment(db as unknown as import("mongodb").Db, voteId);

    // Both coalition NPPs should have been ayes, opposition skipped
    const calls = mockPMAppointmentVotes.updateOne.mock.calls;
    const keys = calls.map((c: unknown[]) =>
      Object.keys((c[1] as { $set: Record<string, unknown> }).$set).find((k) =>
        k.startsWith("votes.")
      )
    );
    expect(keys).toContain(`votes.npp_${npp1Id.toString()}`);
    expect(keys).toContain(`votes.npp_${npp2Id.toString()}`);
  });

  it("whip override: opposition whip against makes NPP vote nay", async () => {
    const voteId = new ObjectId();
    const nppId = new ObjectId();
    const vote = {
      _id: voteId,
      countryId: "UK",
      nomineePartyId: "1",
      formationType: "majority",
      coalitionPartyIds: null,
      votesFor: 0,
      votesAgainst: 0,
      votes: {},
      status: "active",
      openedAt: NOW,
      closesAt: new Date(NOW.getTime() + 24 * 3_600_000),
    };

    // NPP is in party "2" (NOT qualifying party "1"), but whip says "against"
    const whip = {
      _id: new ObjectId(),
      targetType: "pmAppointmentVote",
      targetId: voteId,
      partyId: "2",
      direction: "against",
    };

    mockPMAppointmentVotes.findOne.mockResolvedValue(vote);
    mockBillWhips.find.mockReturnValue(makeCursor([whip]));
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(
      makeCursor([
        {
          _id: new ObjectId(),
          officeType: "commons",
          countryId: "UK",
          party: "2",
          isNPP: true,
          nppId,
          seatsHeld: 1,
        },
      ])
    );

    const { autoAyeNPPsForAppointment } = await import("./ukGovernment");
    await autoAyeNPPsForAppointment(db as unknown as import("mongodb").Db, voteId);

    expect(mockPMAppointmentVotes.updateOne).toHaveBeenCalledWith(
      { _id: voteId, [`votes.npp_${nppId.toString()}`]: { $exists: false } },
      expect.objectContaining({
        $set: expect.objectContaining({ [`votes.npp_${nppId.toString()}`]: "nay" }),
        $inc: { votesAgainst: 1 },
      })
    );
  });
});

describe("resolvePMAppointmentVote", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("electedOfficials");
    db.collection("billWhips");
    db.collection("characters");
    db.collection("npps");
    db.collection("ukCabinetCooldowns");
    db.collection("cabinetMembers");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    mockBillWhips.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["billWhips"] =
      mockBillWhips as unknown as (typeof db.collectionMocks)[string];
    db.collectionMocks["ukCabinetCooldowns"] =
      mockUkCabinetCooldowns as unknown as (typeof db.collectionMocks)[string];
    db.collectionMocks["cabinetMembers"] =
      mockUkCabinetMembers as unknown as (typeof db.collectionMocks)[string];
  });

  it("appoints PM when votesFor > votesAgainst", async () => {
    const voteId = new ObjectId();
    const nomineeId = new ObjectId();
    // Pass/fail is decided by the seat-weighted recompute of the votes map, so
    // seed an aye NPP holding 330 commons seats and an against NPP holding 200.
    const ayeNppId = new ObjectId();
    const nayNppId = new ObjectId();
    const vote = {
      _id: voteId,
      countryId: "UK",
      nomineeCharacterId: nomineeId,
      nomineeName: "Test PM",
      nomineePartyId: "1",
      formationType: "majority",
      coalitionId: null,
      coalitionPartyIds: null,
      votesFor: 330,
      votesAgainst: 200,
      votes: { [`npp_${ayeNppId.toString()}`]: "aye", [`npp_${nayNppId.toString()}`]: "nay" },
      status: "active",
      openedAt: NOW,
      closesAt: new Date(NOW.getTime() + 24 * 3_600_000),
    };
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(
      makeCursor([
        { nppId: ayeNppId, isNPP: true, countryId: "UK", officeType: "commons", seatsHeld: 330 },
        { nppId: nayNppId, isNPP: true, countryId: "UK", officeType: "commons", seatsHeld: 200 },
      ])
    );

    const gov = {
      _id: "UK",
      countryId: "UK",
      status: "pending",
      activeVoteId: voteId,
    };

    mockPMAppointmentVotes.findOne.mockResolvedValue(vote);
    mockPMAppointmentVotes.findOneAndUpdate.mockResolvedValue({ ...vote, status: "passed" });
    mockGovernmentFormations.findOne.mockResolvedValue(gov);

    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: nomineeId,
      userId: new ObjectId(),
      name: "Test PM",
    });
    db.collectionMocks["characters"]!.updateMany = vi.fn().mockResolvedValue({ modifiedCount: 0 });
    db.collectionMocks["npps"] = {
      ...db.collectionMocks["npps"],
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    } as unknown as (typeof db.collectionMocks)[string];

    const { resolvePMAppointmentVote } = await import("./ukGovernment");
    await resolvePMAppointmentVote(voteId, NOW);

    // Vote should be atomically marked passed via findOneAndUpdate (claim)
    expect(mockPMAppointmentVotes.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: voteId, status: "active" },
      expect.objectContaining({ $set: expect.objectContaining({ status: "passed" }) })
    );
    // Government should be updated to formed
    expect(mockGovernmentFormations.updateOne).toHaveBeenCalledWith(
      { _id: "UK" },
      expect.objectContaining({ $set: expect.objectContaining({ status: "formed" }) })
    );
    // Cabinet cooldowns cleared (via db.collection directly in shared system)
    expect(db.collectionMocks["ukCabinetCooldowns"]?.deleteMany).toHaveBeenCalledWith({
      countryId: "UK",
    });
  });

  it("fails vote when votesAgainst >= votesFor", async () => {
    const voteId = new ObjectId();
    const vote = {
      _id: voteId,
      countryId: "UK",
      nomineeCharacterId: new ObjectId(),
      nomineeName: "Test PM",
      nomineePartyId: "1",
      formationType: "majority",
      coalitionId: null,
      coalitionPartyIds: null,
      votesFor: 200,
      votesAgainst: 330,
      votes: {},
      status: "active",
      openedAt: NOW,
      closesAt: new Date(NOW.getTime() + 24 * 3_600_000),
    };

    mockPMAppointmentVotes.findOne.mockResolvedValue(vote);
    mockPMAppointmentVotes.findOneAndUpdate.mockResolvedValue({ ...vote, status: "failed" });
    mockGovernmentFormations.findOne.mockResolvedValue({
      _id: "UK",
      status: "pending",
      activeVoteId: voteId,
    });

    const { resolvePMAppointmentVote } = await import("./ukGovernment");
    await resolvePMAppointmentVote(voteId, NOW);

    // Vote should be atomically marked failed via findOneAndUpdate (claim)
    expect(mockPMAppointmentVotes.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: voteId, status: "active" },
      expect.objectContaining({ $set: expect.objectContaining({ status: "failed" }) })
    );
    // Government should clear activeVoteId, stay pending
    expect(mockGovernmentFormations.updateOne).toHaveBeenCalledWith(
      { _id: "UK" },
      expect.objectContaining({ $set: expect.objectContaining({ activeVoteId: null }) })
    );
  });
});

describe("resolveNoConfidenceVote (new formation system)", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("electedOfficials");
    db.collection("characters");
    db.collection("npps");
    db.collection("ukCabinetCooldowns");
    db.collection("cabinetMembers");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["ukCabinetCooldowns"] =
      mockUkCabinetCooldowns as unknown as (typeof db.collectionMocks)[string];
    db.collectionMocks["cabinetMembers"] =
      mockUkCabinetMembers as unknown as (typeof db.collectionMocks)[string];
  });

  it("removes PM when votesFor > votesAgainst", async () => {
    const voteId = new ObjectId();
    // Pass/fail is decided by the seat-weighted recompute of the votes map.
    const ayeNppId = new ObjectId();
    const nayNppId = new ObjectId();
    const vote = {
      _id: voteId,
      countryId: "UK",
      targetPmCharacterId: new ObjectId(),
      targetPmName: "PM",
      votesFor: 400,
      votesAgainst: 200,
      votes: { [`npp_${ayeNppId.toString()}`]: "aye", [`npp_${nayNppId.toString()}`]: "nay" },
      status: "active",
    };
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(
      makeCursor([
        { nppId: ayeNppId, isNPP: true, countryId: "UK", officeType: "commons", seatsHeld: 400 },
        { nppId: nayNppId, isNPP: true, countryId: "UK", officeType: "commons", seatsHeld: 200 },
      ])
    );

    const gov = {
      _id: "UK",
      status: "formed",
      activeVoteId: voteId,
      pmCharacterId: vote.targetPmCharacterId,
    };

    mockNewNoConfidenceVotes.findOne.mockResolvedValue(vote);
    mockNewNoConfidenceVotes.findOneAndUpdate.mockResolvedValue({ ...vote, status: "passed" });
    mockGovernmentFormations.findOne.mockResolvedValue(gov);

    db.collectionMocks["characters"]!.updateMany = vi.fn().mockResolvedValue({ modifiedCount: 0 });
    db.collectionMocks["npps"] = {
      ...db.collectionMocks["npps"],
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    } as unknown as (typeof db.collectionMocks)[string];

    const { resolveNoConfidenceVote } = await import("./ukGovernment");
    await resolveNoConfidenceVote(voteId, NOW);

    // Vote should be atomically marked passed via findOneAndUpdate (claim)
    expect(mockNewNoConfidenceVotes.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: voteId, status: "active" },
      expect.objectContaining({ $set: expect.objectContaining({ status: "passed" }) })
    );
    // Government should be reset to pending
    expect(mockGovernmentFormations.updateOne).toHaveBeenCalledWith(
      { _id: "UK" },
      expect.objectContaining({ $set: expect.objectContaining({ status: "pending" }) })
    );
  });

  it("keeps PM when votesAgainst >= votesFor", async () => {
    const voteId = new ObjectId();
    const vote = {
      _id: voteId,
      countryId: "UK",
      targetPmCharacterId: new ObjectId(),
      targetPmName: "PM",
      votesFor: 200,
      votesAgainst: 400,
      votes: {},
      status: "active",
    };

    mockNewNoConfidenceVotes.findOne.mockResolvedValue(vote);
    mockNewNoConfidenceVotes.findOneAndUpdate.mockResolvedValue({ ...vote, status: "failed" });
    mockGovernmentFormations.findOne.mockResolvedValue({
      _id: "UK",
      status: "formed",
      activeVoteId: voteId,
    });

    const { resolveNoConfidenceVote } = await import("./ukGovernment");
    await resolveNoConfidenceVote(voteId, NOW);

    // Vote should be atomically marked failed via findOneAndUpdate (claim)
    expect(mockNewNoConfidenceVotes.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: voteId, status: "active" },
      expect.objectContaining({ $set: expect.objectContaining({ status: "failed" }) })
    );
    // Government should clear activeVoteId but NOT change status to pending
    const govCalls = mockGovernmentFormations.updateOne.mock.calls;
    const govUpdate = govCalls[0]?.[1] as { $set: Record<string, unknown> };
    expect(govUpdate?.$set?.status).not.toBe("pending");
    expect(govUpdate?.$set?.activeVoteId).toBeNull();
  });
});

describe("processNPPAutoAye", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("electedOfficials");
    db.collection("billWhips");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["billWhips"] =
      mockBillWhips as unknown as (typeof db.collectionMocks)[string];
    mockBillWhips.find.mockReturnValue(makeCursor([]));
    mockPMAppointmentVotes.find.mockReturnValue(makeCursor([]));
  });

  it("only runs when turn % 4 === 0", async () => {
    const { processNPPAutoAye } = await import("./ukGovernment");

    // Turn 3: should NOT run (3 % 4 !== 0)
    await processNPPAutoAye(NOW, 3);
    expect(mockPMAppointmentVotes.find).not.toHaveBeenCalled();

    // Turn 4: should run (4 % 4 === 0)
    mockPMAppointmentVotes.find.mockReturnValue(makeCursor([]));
    await processNPPAutoAye(NOW, 4);
    expect(mockPMAppointmentVotes.find).toHaveBeenCalled();
  });

  it("does nothing when no active appointment vote exists", async () => {
    mockPMAppointmentVotes.find.mockReturnValue(makeCursor([]));

    const { processNPPAutoAye } = await import("./ukGovernment");
    await processNPPAutoAye(NOW, 4);

    // No NPP votes should be recorded (no active votes to auto-aye)
    expect(mockPMAppointmentVotes.updateOne).not.toHaveBeenCalled();
  });
});
