/**
 * Regression tests for #2038, reverse resolution order: a legislative race
 * that resolves AFTER the executive is seated must not seat the sitting
 * executive into the second office.
 *
 * In presidential systems the seat falls to the next eligible candidate (or
 * the vacancy path when none remains). In parliamentary systems the
 * head-of-government keeps sitting in the legislature, so seating there is
 * unchanged (compatible concurrent office).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Election, ElectionVoteTally } from "@/lib/db/types";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/notifications", () => ({
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/wiki/updatePoliticianPageOnElection", () => ({
  updatePoliticianPagesAfterElection: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/congress/leadershipElections", () => ({
  triggerLeadershipElectionsAfterChamberVote: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/turn/election/presidentResolution", () => ({
  resolvePresidentElection: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/turn/election/electionSpawning", () => ({
  spawnHouseElection: vi.fn().mockResolvedValue(undefined),
  spawnCommonsElection: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/turn/partyOrg", () => ({
  updatePartyPresence: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/achievements", () => ({
  awardAchievement: vi.fn(),
  resolveUserIdFromCharacter: vi.fn().mockResolvedValue(new ObjectId()),
}));
vi.mock("@/lib/achievements/triggers", () => ({
  checkElectionWinAchievements: vi.fn().mockResolvedValue(undefined),
}));

const NOW = new Date("2025-11-15T00:00:00Z");
const CURRENT_TURN = 20;

function makeCursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

function makeElection(overrides: Partial<Election> = {}): Election {
  return {
    _id: new ObjectId(),
    countryId: "US",
    electionType: "senate",
    state: "MO",
    senateClass: 1,
    cycle: 1,
    status: "completed",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as Election;
}

function makeTally(
  electionId: ObjectId,
  totalVotes: Record<string, number>,
  overrides: Partial<ElectionVoteTally> = {}
): ElectionVoteTally {
  return {
    _id: new ObjectId(),
    electionId,
    state: "MO",
    totalVotes,
    candidateNames: {},
    candidateParties: {},
    turnSnapshots: [],
    finalized: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as ElectionVoteTally;
}

let db: MockDb;

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  for (const name of [
    "elections",
    "electionVoteTallies",
    "electionCandidates",
    "electedOfficials",
    "characters",
    "npps",
    "campaigns",
    "statePartyOrg",
    "debateSessions",
  ]) {
    db.collection(name);
  }
  db.collectionMocks["electedOfficials"]!.findOne.mockResolvedValue(null);
});

function inserts() {
  return db.collectionMocks["electedOfficials"]!.insertOne.mock.calls.map(
    (c) => c[0] as Record<string, any>
  );
}

describe("resolveOneGeneralElection executive eligibility (#2038)", () => {
  it("seats the runner-up when the top-voted NPP already holds the vice presidency", async () => {
    const vpNppId = new ObjectId();
    const runnerCharId = new ObjectId();
    const election = makeElection();

    const vpCandidate = {
      _id: new ObjectId(),
      electionId: election._id,
      characterName: "Amanda Bishop",
      party: "1",
      status: "active",
      isNPP: true,
      nppId: vpNppId,
    };
    const runnerCandidate = {
      _id: new ObjectId(),
      electionId: election._id,
      characterId: runnerCharId,
      characterName: "Runner Up",
      party: "2",
      status: "active",
      isNPP: false,
    };
    // VP outpolls the field, mirroring the 691,263 to 539,352 Missouri tally.
    const tally = makeTally(election._id, {
      [vpCandidate._id.toString()]: 691263,
      [runnerCandidate._id.toString()]: 539352,
    });

    db.collectionMocks["electionCandidates"]!.find.mockReturnValue(
      makeCursor([vpCandidate, runnerCandidate])
    );
    const vpHolder = {
      _id: vpNppId,
      name: "Amanda Bishop",
      party: "1",
      retiredAt: null,
      currentOffice: { type: "vicePresident" },
    };
    db.collectionMocks["npps"]!.find.mockReturnValue(makeCursor([vpHolder]));
    const runnerHolder = {
      _id: runnerCharId,
      name: "Runner Up",
      party: "2",
      userId: new ObjectId(),
      currentOffice: null,
    };
    db.collectionMocks["characters"]!.find.mockReturnValue(makeCursor([runnerHolder]));

    const { resolveOneGeneralElection } = await import("./generalResolution");
    const result = await resolveOneGeneralElection(
      db as unknown as Db,
      election,
      tally,
      CURRENT_TURN,
      NOW
    );

    expect(result.resolved).toBe(true);
    // Chamber state: exactly one Missouri Class 1 row, naming the runner-up.
    const seated = inserts();
    expect(seated).toHaveLength(1);
    expect(seated[0].officeType).toBe("senate");
    expect(seated[0].state).toBe("MO");
    expect(seated[0].senateClass).toBe(1);
    expect(seated[0].characterName).toBe("Runner Up");
    expect(seated[0].nppId).toBeUndefined();
    expect(seated.filter((d) => d.nppId?.toString() === vpNppId.toString())).toHaveLength(0);
    expect(db.collectionMocks["elections"]!.updateOne).toHaveBeenCalledWith(
      { _id: election._id },
      expect.objectContaining({ $set: expect.objectContaining({ status: "resolved" }) })
    );
  });

  it("leaves the seat vacant through the vacancy path when the only candidate holds the presidency", async () => {
    const presNppId = new ObjectId();
    const election = makeElection({ state: "CA", senateClass: 3 });
    const loneCandidate = {
      _id: new ObjectId(),
      electionId: election._id,
      characterName: "President Npp",
      party: "1",
      status: "active",
      isNPP: true,
      nppId: presNppId,
    };
    const tally = makeTally(election._id, { [loneCandidate._id.toString()]: 100000 });

    db.collectionMocks["electionCandidates"]!.find.mockReturnValue(makeCursor([loneCandidate]));
    db.collectionMocks["npps"]!.find.mockReturnValue(
      makeCursor([
        {
          _id: presNppId,
          name: "President Npp",
          party: "1",
          retiredAt: null,
          currentOffice: { type: "president" },
        },
      ])
    );
    db.collectionMocks["characters"]!.find.mockReturnValue(makeCursor([]));

    const { resolveOneGeneralElection } = await import("./generalResolution");
    const result = await resolveOneGeneralElection(
      db as unknown as Db,
      election,
      tally,
      CURRENT_TURN,
      NOW
    );

    // No eligible winner remains: no official is written and the race closes.
    expect(result.resolved).toBe(true);
    expect(inserts()).toHaveLength(0);
    expect(db.collectionMocks["elections"]!.updateOne).toHaveBeenCalledWith(
      { _id: election._id },
      expect.objectContaining({ $set: expect.objectContaining({ status: "resolved" }) })
    );
  });

  it("still seats a sitting prime minister into the Commons in a parliamentary system", async () => {
    const pmCharId = new ObjectId();
    const election = makeElection({
      countryId: "UK",
      electionType: "commons",
      state: "Bristol West",
      senateClass: undefined,
    });
    const pmCandidate = {
      _id: new ObjectId(),
      electionId: election._id,
      characterId: pmCharId,
      characterName: "Prime Minister",
      party: "1",
      status: "active",
      isNPP: false,
    };
    const tally = makeTally(election._id, { [pmCandidate._id.toString()]: 50000 });

    db.collectionMocks["electionCandidates"]!.find.mockReturnValue(makeCursor([pmCandidate]));
    db.collectionMocks["characters"]!.find.mockReturnValue(
      makeCursor([
        {
          _id: pmCharId,
          name: "Prime Minister",
          party: "1",
          userId: new ObjectId(),
          currentOffice: { type: "primeMinister" },
        },
      ])
    );
    db.collectionMocks["npps"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(makeCursor([]));

    const { resolveOneGeneralElection } = await import("./generalResolution");
    const result = await resolveOneGeneralElection(
      db as unknown as Db,
      election,
      tally,
      CURRENT_TURN,
      NOW
    );

    // Compatible concurrent office: the PM keeps the executive office and takes
    // the Commons seat, exactly the preserveExecutiveOffice precedent.
    expect(result.resolved).toBe(true);
    const seated = inserts();
    expect(seated).toHaveLength(1);
    expect(seated[0].characterName).toBe("Prime Minister");
    const officeSet = db.collectionMocks["characters"]!.updateOne.mock.calls.find(
      (c) =>
        (c[0] as Record<string, unknown>)?._id === pmCharId && (c[1] as { $set?: unknown })?.$set
    );
    expect((officeSet?.[1] as { $set: Record<string, unknown> }).$set.currentOffice).toMatchObject({
      type: "primeMinister",
    });
  });

  it("skips a sitting character president who tops a Senate race", async () => {
    const presCharId = new ObjectId();
    const runnerCharId = new ObjectId();
    const election = makeElection();

    const presCandidate = {
      _id: new ObjectId(),
      electionId: election._id,
      characterId: presCharId,
      characterName: "President Pat",
      party: "1",
      status: "active",
      isNPP: false,
    };
    const runnerCandidate = {
      _id: new ObjectId(),
      electionId: election._id,
      characterId: runnerCharId,
      characterName: "Runner Up",
      party: "2",
      status: "active",
      isNPP: false,
    };
    const tally = makeTally(election._id, {
      [presCandidate._id.toString()]: 700000,
      [runnerCandidate._id.toString()]: 500000,
    });

    db.collectionMocks["electionCandidates"]!.find.mockReturnValue(
      makeCursor([presCandidate, runnerCandidate])
    );
    db.collectionMocks["characters"]!.find.mockReturnValue(
      makeCursor([
        {
          _id: presCharId,
          name: "President Pat",
          party: "1",
          currentOffice: { type: "president" },
        },
        {
          _id: runnerCharId,
          name: "Runner Up",
          party: "2",
          userId: new ObjectId(),
          currentOffice: null,
        },
      ])
    );
    db.collectionMocks["npps"]!.find.mockReturnValue(makeCursor([]));

    const { resolveOneGeneralElection } = await import("./generalResolution");
    const result = await resolveOneGeneralElection(
      db as unknown as Db,
      election,
      tally,
      CURRENT_TURN,
      NOW
    );

    expect(result.resolved).toBe(true);
    const seated = inserts();
    expect(seated).toHaveLength(1);
    expect(seated[0].characterName).toBe("Runner Up");
  });
});
