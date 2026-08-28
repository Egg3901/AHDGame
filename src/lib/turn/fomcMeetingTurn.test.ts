import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { CentralBank, FomcMeeting, FomcSeat } from "@/lib/db/types/centralBank";

vi.mock("@/lib/centralBank/governance", () => ({
  isBankGovernmentControlledLive: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/lib/npp/generator", () => ({
  spawnTechnocratNpp: vi.fn(async () => ({ _id: new ObjectId(), name: "Caretaker Technocrat" })),
}));

import { castFomcBallot, processFomcMeetings } from "./fomcMeetingTurn";

const CHAIR_NPP = new ObjectId();

function seat(overrides: Partial<FomcSeat> & { seatId: string }): FomcSeat {
  return {
    isChair: false,
    occupantType: "npp",
    characterId: null,
    characterName: "Sitting Governor",
    nppId: new ObjectId(),
    alignment: "hawk",
    appointedByPresidentId: null,
    appointedAtTurn: 0,
    termExpiresAtTurn: 900,
    ...overrides,
  };
}

function makeDb(bank: Partial<CentralBank> & { _id: string }) {
  const bankUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
  const collections: Record<string, unknown> = {
    gameConfig: { findOne: vi.fn().mockResolvedValue({ commandEconomyEnabled: false }) },
    centralBanks: {
      find: () => ({ toArray: vi.fn().mockResolvedValue([bank]) }),
      findOne: vi.fn().mockResolvedValue(bank),
      updateOne: bankUpdateOne,
      bulkWrite: vi.fn().mockResolvedValue({}),
    },
    federalBudget: {
      findOne: vi.fn().mockResolvedValue({ economicFactors: { inflationRate: 3 } }),
    },
    macroMetrics: {
      findOne: vi.fn().mockResolvedValue({ economic: { gdpGrowth: { value: 2 } } }),
    },
  };
  const db = {
    collection: vi.fn((name: string) => collections[name] ?? { findOne: vi.fn() }),
    _bankUpdateOne: bankUpdateOne,
  };
  return db;
}

function setOf(db: ReturnType<typeof makeDb>): Record<string, unknown> {
  const call = db._bankUpdateOne.mock.calls.at(-1)!;
  return (call[1] as { $set: Record<string, unknown> }).$set;
}

describe("processFomcMeetings — chair seat rollover", () => {
  beforeEach(() => vi.clearAllMocks());

  it("hands an expired chair seat to the player selection phase instead of locking in a technocrat", async () => {
    const db = makeDb({
      _id: "DD",
      countryId: "DD",
      primeRate: 5,
      chairMode: "npp",
      chairNppId: CHAIR_NPP,
      chairTermExpiresAtTurn: 219,
      lastFomcMeetingTurn: 218,
      fomcTermStartedAtTurn: 192,
      fomcBoard: [
        seat({ seatId: "seat-1", isChair: true, nppId: CHAIR_NPP, termExpiresAtTurn: 219 }),
        seat({ seatId: "seat-2" }),
      ],
    });

    await processFomcMeetings(db as unknown as Db, 219, 1956, new Date());

    const $set = setOf(db);
    // The caretaker keeps the committee quorate...
    expect($set.chairMode).toBe("npp");
    // ...but the seat must NOT carry a fresh 4-year term, or
    // processCentralBankChairSelection (which runs later in the same turn and
    // only fires on an expired/absent term) never sees the vacancy and the
    // executive's nominations are never read.
    expect($set.chairTermExpiresAtTurn).toBeNull();
    expect($set.vacancyAwaitingAutomaticSelection).toBe(true);
  });

  it("does not re-flag a vacancy while a player chair offer is already pending", async () => {
    const pendingId = new ObjectId();
    const db = makeDb({
      _id: "US",
      countryId: "US",
      primeRate: 5,
      chairMode: "npp",
      chairNppId: CHAIR_NPP,
      chairTermExpiresAtTurn: null,
      chairSelectionPending: {
        characterId: pendingId,
        characterName: "Poppy",
        pool: "political",
        proposedAt: new Date(),
        proposedAtTurn: 258,
        appointedByExecutiveId: null,
        declinedCharacterIds: [],
      },
      lastFomcMeetingTurn: 218,
      fomcTermStartedAtTurn: 192,
      fomcBoard: [
        seat({ seatId: "seat-1", isChair: true, nppId: CHAIR_NPP, termExpiresAtTurn: 219 }),
        seat({ seatId: "seat-2" }),
      ],
    });

    await processFomcMeetings(db as unknown as Db, 219, 1956, new Date());

    const $set = setOf(db);
    expect($set.vacancyAwaitingAutomaticSelection).toBeUndefined();
    expect($set.chairSelectionPending).toBeUndefined();
  });

  it("leaves the chair term alone when a non-chair seat rolls over", async () => {
    const db = makeDb({
      _id: "DD",
      countryId: "DD",
      primeRate: 5,
      chairMode: "npp",
      chairNppId: CHAIR_NPP,
      chairTermExpiresAtTurn: 400,
      lastFomcMeetingTurn: 218,
      fomcTermStartedAtTurn: 192,
      fomcBoard: [
        seat({ seatId: "seat-1", isChair: true, nppId: CHAIR_NPP, termExpiresAtTurn: 400 }),
        seat({ seatId: "seat-2", termExpiresAtTurn: 219 }),
      ],
    });

    await processFomcMeetings(db as unknown as Db, 219, 1956, new Date());

    const $set = setOf(db);
    expect($set.chairTermExpiresAtTurn).toBe(400);
    expect($set.vacancyAwaitingAutomaticSelection).toBeUndefined();
  });

  it("mirrors a player chair as character mode when another seat rolls over", async () => {
    const playerId = new ObjectId();
    const db = makeDb({
      _id: "DD",
      countryId: "DD",
      primeRate: 5,
      chairMode: "character",
      chairCharacterId: playerId,
      chairCharacterName: "Erich Lindner",
      chairTermExpiresAtTurn: 400,
      lastFomcMeetingTurn: 218,
      fomcTermStartedAtTurn: 192,
      fomcBoard: [
        seat({
          seatId: "seat-1",
          isChair: true,
          occupantType: "player",
          characterId: playerId,
          characterName: "Erich Lindner",
          nppId: null,
          termExpiresAtTurn: 400,
        }),
        seat({ seatId: "seat-2", termExpiresAtTurn: 219 }),
      ],
    });

    await processFomcMeetings(db as unknown as Db, 219, 1956, new Date());

    const $set = setOf(db);
    // Stamping "npp" here demoted a sitting player chair on every unrelated
    // seat rotation.
    expect($set.chairMode).toBe("character");
    expect($set.chairCharacterId).toEqual(playerId);
    expect($set.chairNppId).toBeNull();
  });

  it("clears a stale player chairCharacterId when a technocrat takes the seat", async () => {
    const ghostId = new ObjectId();
    const db = makeDb({
      _id: "US",
      countryId: "US",
      primeRate: 5,
      chairMode: "npp",
      // Prod shape: a player left behind in the mirror while an NPP chairs.
      chairCharacterId: ghostId,
      chairCharacterName: "Poppy",
      chairTermExpiresAtTurn: 219,
      lastFomcMeetingTurn: 218,
      fomcTermStartedAtTurn: 192,
      fomcBoard: [
        seat({ seatId: "seat-1", isChair: true, nppId: CHAIR_NPP, termExpiresAtTurn: 219 }),
      ],
    });

    await processFomcMeetings(db as unknown as Db, 219, 1956, new Date());

    const $set = setOf(db);
    expect($set.chairCharacterId).toBeNull();
    expect($set.chairCharacterName).toBeNull();
  });
});

// ── Meeting open / resolve (ticket #1211) ─────────────────────────────────────
//
// A board of 6 NPP seats + 1 player seat (the seeded US shape). NPP seats
// auto-vote at open, so their 6 agreeing ballots already clear the
// full-board majority of 4 — but the player seat must still get the
// documented 24-turn vote window instead of the meeting silently opening and
// resolving inside the same turn.

const PLAYER_ID = new ObjectId();

function playerChairSeat(): FomcSeat {
  return seat({
    seatId: "seat-1",
    isChair: true,
    occupantType: "player",
    characterId: PLAYER_ID,
    characterName: "Poppy",
    nppId: null,
  });
}

function usBoard(): FomcSeat[] {
  return [
    playerChairSeat(),
    seat({ seatId: "seat-2" }),
    seat({ seatId: "seat-3" }),
    seat({ seatId: "seat-4" }),
    seat({ seatId: "seat-5" }),
    seat({ seatId: "seat-6" }),
    seat({ seatId: "seat-7" }),
  ];
}

/** A voting meeting opened at `openedTurn` with all 6 NPP seats agreeing. */
function nppMajorityMeeting(openedTurn: number): FomcMeeting {
  return {
    meetingId: new ObjectId().toHexString(),
    openedAtTurn: openedTurn,
    openedAt: new Date(),
    motion: "hike",
    proposedDelta: 0.25,
    status: "voting",
    ballots: ["seat-2", "seat-3", "seat-4", "seat-5", "seat-6", "seat-7"].map((seatId) => ({
      seatId,
      vote: "hike" as const,
      auto: true,
      castAt: new Date(),
    })),
    playerVoteDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
    resolvesOnTurn: openedTurn + 24,
  };
}

describe("processFomcMeetings — player vote window", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps a passed-by-NPP meeting open for the player ballot instead of resolving it at open", async () => {
    const db = makeDb({
      _id: "US",
      countryId: "US",
      primeRate: 5,
      lastFomcMeetingTurn: 100,
      fomcTermStartedAtTurn: 100,
      fomcBoard: usBoard(),
    });

    const result = await processFomcMeetings(db as unknown as Db, 108, 1956, new Date());

    const $set = setOf(db);
    const meeting = $set.activeFomcMeeting as FomcMeeting;
    expect(meeting).toBeTruthy();
    expect(meeting.status).toBe("voting");
    // The 6 NPP seats have voted (and, sharing one macro context and one hawk
    // alignment, all agree with the chair's motion) — enough to pass 4-of-7 —
    // yet the meeting must stay open for the unvoted player seat.
    expect(meeting.ballots).toHaveLength(6);
    expect(meeting.ballots.every((b) => b.vote === meeting.motion)).toBe(true);
    expect(meeting.resolvesOnTurn).toBe(108 + 24);
    expect($set.fomcMeetingHistory).toBeUndefined();
    expect($set.primeRate).toBeUndefined();
    expect($set.lastFomcMeetingTurn).toBe(108);
    expect(result.meetingsOpened).toBe(1);
    expect(result.meetingsResolved).toBe(0);
    expect(result.ratesChanged).toBe(0);
  });

  it("force-resolves at the deadline with the no-show player seat abstaining", async () => {
    const db = makeDb({
      _id: "US",
      countryId: "US",
      primeRate: 5,
      lastFomcMeetingTurn: 108,
      fomcTermStartedAtTurn: 100,
      activeFomcMeeting: nppMajorityMeeting(108),
      fomcBoard: usBoard(),
    });

    const result = await processFomcMeetings(db as unknown as Db, 132, 1956, new Date());

    const $set = setOf(db);
    expect($set.activeFomcMeeting).toBeNull();
    const history = $set.fomcMeetingHistory as FomcMeeting[];
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe("resolved");
    expect(history[0].result).toBe("passed");
    expect(history[0].resolvedAtTurn).toBe(132);
    // No-show player seat cast no ballot: 6 for / 0 against / 1 abstain.
    expect(history[0].ballots).toHaveLength(6);
    expect($set.primeRate).toBe(5.25);
    expect(result.meetingsResolved).toBe(1);
    expect(result.ratesChanged).toBe(1);
  });

  it("resolves a meeting at open when no player seat is awaiting a ballot (all-NPP board)", async () => {
    const db = makeDb({
      _id: "JP",
      countryId: "JP",
      primeRate: 5,
      lastFomcMeetingTurn: 100,
      fomcTermStartedAtTurn: 100,
      fomcBoard: [
        seat({ seatId: "seat-1", isChair: true, nppId: CHAIR_NPP }),
        seat({ seatId: "seat-2" }),
        seat({ seatId: "seat-3" }),
        seat({ seatId: "seat-4" }),
        seat({ seatId: "seat-5" }),
        seat({ seatId: "seat-6" }),
        seat({ seatId: "seat-7" }),
      ],
    });

    const result = await processFomcMeetings(db as unknown as Db, 108, 1956, new Date());

    const $set = setOf(db);
    expect($set.activeFomcMeeting).toBeNull();
    const history = $set.fomcMeetingHistory as FomcMeeting[];
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe("resolved");
    expect(history[0].ballots).toHaveLength(7);
    expect($set.lastFomcMeetingTurn).toBe(108);
    expect(result.meetingsOpened).toBe(1);
    expect(result.meetingsResolved).toBe(1);
  });
});

describe("castFomcBallot — live player votes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves a decided meeting the moment the last pending player seat ballots", async () => {
    const db = makeDb({
      _id: "US",
      countryId: "US",
      primeRate: 5,
      lastFomcMeetingTurn: 108,
      fomcTermStartedAtTurn: 100,
      activeFomcMeeting: nppMajorityMeeting(108),
      fomcBoard: usBoard(),
    });

    const outcome = await castFomcBallot(
      db as unknown as Db,
      "US",
      PLAYER_ID,
      "cut",
      109,
      new Date()
    );

    expect(outcome).toEqual({ ok: true, resolved: true, motion: "hike", moved: true });
    const $set = setOf(db);
    expect($set.activeFomcMeeting).toBeNull();
    const history = $set.fomcMeetingHistory as FomcMeeting[];
    expect(history).toHaveLength(1);
    // The dissenting player ballot is recorded even though the NPP block
    // already carried the motion.
    const playerBallot = history[0].ballots.find((b) => b.seatId === "seat-1");
    expect(playerBallot).toMatchObject({ vote: "cut", auto: false });
    expect($set.primeRate).toBe(5.25);
  });

  it("keeps the meeting open while another player seat still has a ballot pending", async () => {
    const secondPlayerId = new ObjectId();
    const board = usBoard();
    board.push(
      seat({
        seatId: "seat-8",
        occupantType: "player",
        characterId: secondPlayerId,
        characterName: "Other Player",
        nppId: null,
      })
    );
    const db = makeDb({
      _id: "US",
      countryId: "US",
      primeRate: 5,
      lastFomcMeetingTurn: 108,
      fomcTermStartedAtTurn: 100,
      activeFomcMeeting: nppMajorityMeeting(108),
      fomcBoard: board,
    });

    const outcome = await castFomcBallot(
      db as unknown as Db,
      "US",
      PLAYER_ID,
      "hike",
      109,
      new Date()
    );

    expect(outcome).toEqual({ ok: true, resolved: false, motion: "hike", moved: false });
    const $set = setOf(db);
    const meeting = $set.activeFomcMeeting as FomcMeeting;
    expect(meeting.status).toBe("voting");
    expect(meeting.ballots).toHaveLength(7);
    expect(meeting.ballots.find((b) => b.seatId === "seat-1")).toMatchObject({
      vote: "hike",
      auto: false,
    });
    expect($set.fomcMeetingHistory).toBeUndefined();
    expect($set.primeRate).toBeUndefined();
  });
});
