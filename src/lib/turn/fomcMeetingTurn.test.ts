import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { CentralBank, FomcSeat } from "@/lib/db/types/centralBank";

vi.mock("@/lib/centralBank/governance", () => ({
  isBankGovernmentControlledLive: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/lib/npp/generator", () => ({
  spawnTechnocratNpp: vi.fn(async () => ({ _id: new ObjectId(), name: "Caretaker Technocrat" })),
}));

import { processFomcMeetings } from "./fomcMeetingTurn";

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
