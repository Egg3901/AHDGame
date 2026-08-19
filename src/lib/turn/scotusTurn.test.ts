import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

/**
 * #3598 testing note: multi-turn simulation test mirroring the existing
 * metric-registry legislation-simulation-test pattern's spirit — seed a
 * roster + a docket case due to fire, run turns, and assert on the resulting
 * roster/case/enactment state. This exercises tenure replay, seat vacancy on
 * Original-Roster chain exhaustion, and the divergence -> enacted-law wiring
 * together across several `processScotusTurn` calls, the way the real turn
 * loop would call it.
 *
 * `onBillEnacted` itself is mocked — its own internals are covered by
 * billEnactment.test.ts; here we assert the exact hand-off SCOTUS makes into
 * that existing, already-tested pipeline.
 */
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotifications: vi.fn() }));
vi.mock("@/lib/billEnactment", () => ({ onBillEnacted: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/congress/governmentVoteBreakdown", () => ({
  computeCabinetNominationTally: vi
    .fn()
    .mockResolvedValue({ votesFor: 0, votesAgainst: 0, votesAbstain: 0 }),
}));

interface FakeSeat {
  _id: ObjectId;
  countryId: string;
  seatNumber: number;
  isDivergent: boolean;
  historicalOccupantIndex: number;
  historicalOccupants: Array<{
    key: string;
    name: string;
    economicLean: number;
    socialLean: number;
    seatedYear: number;
    departureYear: number | null;
    departureReason: "death" | "retirement" | null;
  }>;
  justiceMode: string | null;
  justiceCharacterId: ObjectId | null;
  justiceNppId: ObjectId | null;
  justiceName: string | null;
  economicLean: number | null;
  socialLean: number | null;
  seatedAtTurn: number | null;
  divergentHazardStartsTurn: number | null;
}

interface FakeDocketCase {
  _id: ObjectId;
  countryId: string;
  axis: "economic" | "social";
  historicalMajorityDirection: 1 | -1;
  decisionYear: number;
  effect?: { legislationTypeId: string; policyOptionId: string; effectDirection: -1 | 0 | 1 };
  status: "pending" | "decided";
  outcome?: string;
}

describe("processScotusTurn — multi-turn simulation", () => {
  let db: MockDb;
  let seats: FakeSeat[];
  let docketCases: FakeDocketCase[];
  const startingYear = 1953;

  beforeEach(async () => {
    vi.clearAllMocks();
    // `processScotusTurn` also runs `processScotusSurpriseCaseTurn`, whose spawn
    // roll defaults to a live `Math.random()` at a 0.004/turn hazard. A spawned
    // surprise case enacts its own ruling through `enactRulingBill`, which calls
    // `onBillEnacted`, so an unlucky draw added extra calls and made the
    // `toHaveBeenCalledTimes(1)` assertions below fail at random (~1.6% of runs,
    // this test drives four turns). Pin the draw above the spawn probability so
    // this file only ever exercises the curated docket hand-off it is asserting.
    // The surprise-case path has its own deterministic coverage in
    // scotusSurpriseCaseTurn.test.ts, which injects its draws explicitly.
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    db.collection("supremeCourtSeats");
    db.collection("docketCases");
    db.collection("enactedLaws");
    db.collection("scotusNominations");
    db.collection("electedOfficials");

    seats = [
      {
        _id: new ObjectId(),
        countryId: "US",
        seatNumber: 1,
        isDivergent: false,
        historicalOccupantIndex: 0,
        historicalOccupants: [
          {
            key: "positive-1",
            name: "Justice Positive One",
            economicLean: 3,
            socialLean: 3,
            seatedYear: 1953,
            departureYear: null,
            departureReason: null,
          },
        ],
        justiceMode: "historical",
        justiceCharacterId: null,
        justiceNppId: null,
        justiceName: "Justice Positive One",
        economicLean: 3,
        socialLean: 3,
        seatedAtTurn: 1,
        divergentHazardStartsTurn: null,
      },
      {
        _id: new ObjectId(),
        countryId: "US",
        seatNumber: 2,
        isDivergent: false,
        historicalOccupantIndex: 0,
        historicalOccupants: [
          {
            key: "positive-2",
            name: "Justice Positive Two",
            economicLean: 2,
            socialLean: 2,
            seatedYear: 1953,
            departureYear: null,
            departureReason: null,
          },
        ],
        justiceMode: "historical",
        justiceCharacterId: null,
        justiceNppId: null,
        justiceName: "Justice Positive Two",
        economicLean: 2,
        socialLean: 2,
        seatedAtTurn: 1,
        divergentHazardStartsTurn: null,
      },
      {
        _id: new ObjectId(),
        countryId: "US",
        seatNumber: 3,
        isDivergent: false,
        historicalOccupantIndex: 0,
        historicalOccupants: [
          {
            key: "negative-1",
            name: "Justice Negative One",
            economicLean: -5,
            socialLean: -5,
            seatedYear: 1953,
            departureYear: 1954, // departs at turn 49; chain has no successor -> seat goes vacant
            departureReason: "retirement",
          },
        ],
        justiceMode: "historical",
        justiceCharacterId: null,
        justiceNppId: null,
        justiceName: "Justice Negative One",
        economicLean: -5,
        socialLean: -5,
        seatedAtTurn: 1,
        divergentHazardStartsTurn: null,
      },
    ];

    docketCases = [
      {
        _id: new ObjectId(),
        countryId: "US",
        axis: "economic",
        historicalMajorityDirection: -1, // real history: negative majority (seat 3 was on the bench)
        decisionYear: 1955, // turn 97 — fires AFTER seat 3 has already vacated (turn 49)
        effect: {
          legislationTypeId: "us_federal_healthcare_funding",
          policyOptionId: "single_payer",
          effectDirection: 1,
        },
        status: "pending",
      },
    ];

    db.collectionMocks.supremeCourtSeats!.find.mockImplementation(() => ({
      toArray: vi.fn().mockResolvedValue(seats),
    }));
    db.collectionMocks.supremeCourtSeats!.updateOne.mockImplementation(
      (filter: { _id: ObjectId }, update: { $set: Record<string, unknown> }) => {
        const target = seats.find((s) => s._id.equals(filter._id));
        if (target) Object.assign(target, update.$set);
        return Promise.resolve({ matchedCount: target ? 1 : 0, modifiedCount: target ? 1 : 0 });
      }
    );
    db.collectionMocks.docketCases!.find.mockImplementation(() => ({
      toArray: vi.fn().mockResolvedValue(docketCases.filter((c) => c.status === "pending")),
    }));
    db.collectionMocks.docketCases!.updateOne.mockImplementation(
      (filter: { _id: ObjectId }, update: { $set: Record<string, unknown> }) => {
        const target = docketCases.find((c) => c._id.equals(filter._id));
        if (target) Object.assign(target, update.$set);
        return Promise.resolve({ matchedCount: target ? 1 : 0, modifiedCount: target ? 1 : 0 });
      }
    );
    // scotusNominations empty throughout this simulation — no live nominations queued.
    db.collectionMocks.scotusNominations!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function setTurn(turn: number) {
    return async () => {
      const { getGameState } = await import("@/lib/gameState");
      vi.mocked(getGameState).mockResolvedValue({ currentTurn: turn, startingYear } as never);
    };
  }

  it("replays history, vacates seat 3 on schedule, then fires the docket case and diverges once the composition no longer matches history", async () => {
    const { processScotusTurn } = await import("./scotusTurn");
    const { onBillEnacted } = await import("@/lib/billEnactment");

    // Turn 1: nothing due yet.
    await setTurn(1)();
    let result = await processScotusTurn(1, new Date(0), db as unknown as Db);
    expect(result.tenure).toEqual({
      seatsAdvanced: 0,
      seatsVacatedByHistory: 0,
      seatsVacatedByHazard: 0,
    });
    expect(result.docket.casesFired).toBe(0);
    // Guard: the pinned Math.random above must keep the surprise-case hazard
    // from firing, otherwise the onBillEnacted counts below are not this
    // test's to assert.
    expect(result.surpriseCase.spawned).toBe(false);

    // Turn 49: seat 3's real historical departure. No successor authored -> vacant.
    await setTurn(49)();
    result = await processScotusTurn(49, new Date(0), db as unknown as Db);
    expect(result.tenure.seatsVacatedByHistory).toBe(1);
    const seat3 = seats.find((s) => s.seatNumber === 3)!;
    expect(seat3.justiceMode).toBeNull();
    expect(seat3.isDivergent).toBe(false); // vacancy alone is not the Divergence Point

    // Turn 97 (1955): the docket case fires. Only seats 1 & 2 remain (both
    // positive) -> current majority is positive, but history's majority was
    // negative -> diverges.
    await setTurn(97)();
    result = await processScotusTurn(97, new Date(0), db as unknown as Db);
    expect(result.docket).toEqual({ casesFired: 1, casesAffirmed: 0, casesDiverged: 1 });

    const decidedCase = docketCases[0];
    expect(decidedCase.status).toBe("decided");
    expect(decidedCase.outcome).toBe("diverged");

    expect(onBillEnacted).toHaveBeenCalledTimes(1);
    const [, syntheticBill] = vi.mocked(onBillEnacted).mock.calls[0];
    expect(syntheticBill).toMatchObject({
      source: "scotus_ruling",
      legislationTypeId: "us_federal_healthcare_funding",
      countryId: "US",
    });

    // Re-running the same turn is a no-op — the case is no longer pending.
    result = await processScotusTurn(97, new Date(0), db as unknown as Db);
    expect(result.docket.casesFired).toBe(0);
    expect(onBillEnacted).toHaveBeenCalledTimes(1);
  });
});
