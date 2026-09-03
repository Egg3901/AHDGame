/**
 * Shell tests: the turn phase, live ballots and direct rate sets route
 * through the governance machine with the same persisted path.
 *
 * Empty boards are skipped, vacancies flow to notices, chair fallback
 * authority works on a dead board, late and replayed commands are refused
 * with a reason and persist nothing new, and completing ballots auto-resolve.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/centralBank/governance", () => ({
  isBankGovernmentControlledLive: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/lib/notifications", () => ({
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/news", () => ({
  createSystemNewsPost: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

import { createNotifications } from "@/lib/notifications";
import { processFomcMeetings, castFomcBallot } from "@/lib/turn/fomcMeetingTurn";
import { updatePrimeRate } from "@/lib/monetaryPolicy/commands/updatePrimeRate";

const CHAIR_ID = new ObjectId();
const PLAYER_ID = new ObjectId();

function cursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    project: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  };
}

function seat(seatId: string, overrides: Record<string, unknown> = {}) {
  return {
    seatId,
    isChair: false,
    occupantType: "npp",
    characterId: null,
    characterName: "Governor",
    nppId: new ObjectId(),
    alignment: "hawk",
    appointedByPresidentId: null,
    appointedAtTurn: 0,
    termExpiresAtTurn: 900,
    ...overrides,
  };
}

let db: MockDb;

function bankFixture(overrides: Record<string, unknown> = {}) {
  return {
    _id: "US",
    countryId: "US",
    primeRate: 5,
    rateHistory: [],
    chairInfamy: 0,
    chairCharacterId: null,
    fomcBoard: [seat("seat-1", { isChair: true }), seat("seat-2"), seat("seat-3")],
    activeFomcMeeting: null,
    rateChangesThisTerm: 0,
    fomcTermStartedAtTurn: 100,
    lastFomcMeetingTurn: 100,
    fomcMeetingHistory: [],
    ...overrides,
  };
}

function setupTurnDb(bank: Record<string, unknown>, executives: unknown[] = []) {
  db = createMockDb();
  for (const name of [
    "centralBanks",
    "federalBudget",
    "macroMetrics",
    "fomcNominations",
    "characters",
  ]) {
    db.collection(name);
  }
  db.collectionMocks.centralBanks!.findOne.mockResolvedValue(bank);
  db.collectionMocks.centralBanks!.find.mockReturnValue(cursor([bank]));
  db.collectionMocks.federalBudget!.findOne.mockResolvedValue({
    economicFactors: { inflationRate: 3 },
  });
  db.collectionMocks.macroMetrics!.findOne.mockResolvedValue({
    economic: { gdpGrowth: { value: 2 } },
  });
  db.collectionMocks.fomcNominations!.find.mockReturnValue(cursor([]));
  db.collectionMocks.characters!.find.mockReturnValue({
    project: () => ({ toArray: vi.fn().mockResolvedValue(executives) }),
  } as never);
}

function setOf() {
  const call = db.collectionMocks.centralBanks!.updateOne.mock.calls.at(-1)!;
  return (call[1] as { $set: Record<string, unknown> }).$set;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("turn shell", () => {
  it("skips banks with empty boards without writing", async () => {
    setupTurnDb(bankFixture({ fomcBoard: [] }));

    const result = await processFomcMeetings(db as unknown as Db, 108, 1956, new Date());

    expect(result.banksProcessed).toBe(0);
    expect(result.meetingsOpened).toBe(0);
    expect(db.collectionMocks.centralBanks!.updateOne).not.toHaveBeenCalled();
  });

  it("vacates expired seats and notifies the nominating executive", async () => {
    const presidentUserId = new ObjectId();
    setupTurnDb(
      bankFixture({
        lastFomcMeetingTurn: 108,
        fomcBoard: [
          seat("seat-1", { isChair: true, termExpiresAtTurn: 109 }),
          seat("seat-2", { termExpiresAtTurn: 900 }),
          seat("seat-3", { termExpiresAtTurn: 900 }),
        ],
      }),
      [{ userId: presidentUserId, characterName: "President" }]
    );

    await processFomcMeetings(db as unknown as Db, 109, 1956, new Date());

    const $set = setOf();
    const board = $set.fomcBoard as Array<{ seatId: string; occupantType: string }>;
    expect(board.find((s) => s.seatId === "seat-1")?.occupantType).toBe("vacant");
    expect($set.vacancyAwaitingAutomaticSelection).toBe(true);
    expect($set.lastFomcVacancyNoticeAtTurn).toBe(109);
    expect(createNotifications).toHaveBeenCalledTimes(1);
  });
});

describe("ballot shell", () => {
  function votingBank() {
    return bankFixture({
      lastFomcMeetingTurn: 108,
      fomcBoard: [
        seat("seat-1", {
          isChair: true,
          occupantType: "player",
          characterId: PLAYER_ID,
          characterName: "Poppy",
          nppId: null,
        }),
        seat("seat-2"),
        seat("seat-3"),
      ],
      activeFomcMeeting: {
        meetingId: "m1",
        openedAtTurn: 108,
        openedAt: new Date(),
        motion: "hike",
        proposedDelta: 0.25,
        status: "voting",
        ballots: [
          { seatId: "seat-2", vote: "hike", auto: true, castAt: new Date() },
          { seatId: "seat-3", vote: "hike", auto: true, castAt: new Date() },
        ],
        playerVoteDeadline: new Date(Date.now() + 3600_000),
        resolvesOnTurn: 132,
      },
    });
  }

  it("auto-resolves when the ballot completes the tally", async () => {
    setupTurnDb(votingBank());

    const outcome = await castFomcBallot(
      db as unknown as Db,
      "US",
      PLAYER_ID,
      "hike",
      109,
      new Date()
    );

    expect(outcome).toEqual({ ok: true, resolved: true, motion: "hike", moved: true });
    expect(setOf().primeRate).toBe(5.25);
  });

  it("refuses a late ballot after the deadline and persists nothing", async () => {
    setupTurnDb(votingBank());

    const outcome = await castFomcBallot(
      db as unknown as Db,
      "US",
      PLAYER_ID,
      "hike",
      133,
      new Date()
    );

    expect(outcome).toEqual({ ok: false, reason: "no-meeting" });
    expect(db.collectionMocks.centralBanks!.updateOne).not.toHaveBeenCalled();
  });

  it("refuses a replayed ballot and persists nothing new", async () => {
    const bank = votingBank();
    bank.activeFomcMeeting.ballots.push({
      seatId: "seat-1",
      vote: "hike",
      auto: false,
      castAt: new Date(),
    });
    setupTurnDb(bank);

    const outcome = await castFomcBallot(
      db as unknown as Db,
      "US",
      PLAYER_ID,
      "hike",
      109,
      new Date()
    );

    expect(outcome).toEqual({ ok: false, reason: "already-voted" });
    expect(db.collectionMocks.centralBanks!.updateOne).not.toHaveBeenCalled();
  });
});

describe("rate shell", () => {
  function deadBoardBank() {
    return bankFixture({
      chairCharacterId: CHAIR_ID,
      chairCharacterName: "Chair",
      fomcBoard: [
        seat("seat-1", {
          isChair: true,
          occupantType: "player",
          characterId: CHAIR_ID,
          characterName: "Chair",
          nppId: null,
        }),
        ...["seat-2", "seat-3", "seat-4", "seat-5", "seat-6", "seat-7"].map((seatId) =>
          seat(seatId, {
            occupantType: "vacant",
            characterId: null,
            characterName: null,
            nppId: null,
            termExpiresAtTurn: null,
          })
        ),
      ],
    });
  }

  function rateSetup(bank: Record<string, unknown>) {
    db = createMockDb();
    db.collection("centralBanks");
    db.collection("exchangeRates");
    db.collectionMocks.centralBanks!.findOne.mockResolvedValue(bank);
    db.collectionMocks.exchangeRates!.findOne.mockResolvedValue(null);
  }

  it("gives the chair fallback authority on a dead board", async () => {
    rateSetup(deadBoardBank());

    const result = await updatePrimeRate({
      db: db as unknown as Db,
      countryId: "US",
      actor: {
        userId: new ObjectId().toString(),
        username: "chair",
        character: { _id: CHAIR_ID, name: "Chair" },
      },
      rate: 4.75,
      currentTurn: 108,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.primeRate).toBe(4.75);
    const set = db.collectionMocks.centralBanks!.updateOne.mock.calls[0][1].$set;
    expect(set.rateChangesThisTerm).toBe(1);
  });

  it("refuses a replayed rate and persists nothing new", async () => {
    rateSetup(deadBoardBank());

    const result = await updatePrimeRate({
      db: db as unknown as Db,
      countryId: "US",
      actor: {
        userId: new ObjectId().toString(),
        username: "chair",
        character: { _id: CHAIR_ID, name: "Chair" },
      },
      rate: 5,
      currentTurn: 108,
    });

    expect(result).toEqual(expect.objectContaining({ ok: false, status: 400 }));
    expect(db.collectionMocks.centralBanks!.updateOne).not.toHaveBeenCalled();
  });
});
