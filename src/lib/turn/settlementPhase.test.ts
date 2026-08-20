import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockCollection, type MockDb } from "@/lib/test-utils/mockDb";
import type { SettlementCrisisDoc } from "@/lib/db/types/settlementCrisis";
import type { SettlementPlayDoc } from "@/lib/db/types/settlementPlay";
import {
  HUNDREDTHS,
  SETTLEMENT_INSTITUTIONS,
  SETTLEMENT_SEATS,
} from "@/lib/constants/settlementCrisis";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const CRISIS_ID = new ObjectId();

function crisis(over: Partial<SettlementCrisisDoc> = {}): SettlementCrisisDoc {
  return {
    _id: CRISIS_ID,
    kind: "settlement.germanQuestion",
    status: "open",
    targetEntityId: "DE",
    challengerEntityId: "DD",
    position: 3820,
    institutions: SETTLEMENT_INSTITUTIONS.map((i) => ({
      id: i.id,
      weight: i.weight,
      position: i.opening,
      lastPlay: null,
      lastDrift: 0,
    })),
    seats: SETTLEMENT_SEATS.map((s) => ({
      id: s.id,
      capital: 10,
      actionsUsedTurn: 1,
      lastActedTurn: 411,
      committedPoints: 0,
    })),
    ladder: { heat: 2, armedTurn: null },
    driftHistory: [],
    conflictId: null,
    openedTurn: 400,
    resolvedTurn: null,
    outcome: null,
    cooldownUntilTurn: null,
    createdAt: new Date("1953-01-01T00:00:00Z"),
    updatedAt: new Date("1953-01-01T00:00:00Z"),
    ...over,
  };
}

function play(over: Partial<SettlementPlayDoc> = {}): SettlementPlayDoc {
  return {
    _id: new ObjectId(),
    crisisId: CRISIS_ID,
    actor: "seat",
    seatId: "DD",
    characterId: new ObjectId(),
    countryId: "DD",
    playId: "aid",
    targetInstitutionId: "laender",
    direction: 1,
    class: "spend",
    costs: { funds: 0, capital: 0, actions: 1 },
    basePoints: 4 * HUNDREDTHS,
    appliedPoints: null,
    heatAdded: 0,
    turn: 412,
    resolvedTurn: null,
    createdAt: new Date("1953-01-01T00:00:00Z"),
    ...over,
  };
}

/**
 * `collectionMocks` is a PLAIN OBJECT, populated only when `db.collection(name)`
 * is first called — reading it before the code under test runs yields
 * undefined. Calling `db.collection` here creates and returns the mock.
 */
function prime(db: MockDb, name: string): MockCollection {
  return db.collection(name) as unknown as MockCollection;
}

/** Wire the mock db so the phase sees one crisis and the given plays. */
function arrange(db: MockDb, doc: SettlementCrisisDoc, plays: SettlementPlayDoc[]) {
  prime(db, "gameState").findOne.mockResolvedValue({
    _id: "current",
    settlementCrisisEnabled: true,
  });
  prime(db, "settlementCrises").findOne.mockResolvedValue(doc);
  prime(db, "settlementPlays").find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue(plays),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  });
  // The claim and the stamp both run through updateOne on this collection.
  // Default matchedCount 1 = every claim is won; a test overrides it to 0 to
  // simulate an overlapping turn run that already took the play.
  prime(db, "settlementPlays").updateOne.mockResolvedValue({ matchedCount: 1 });
}

/** The `$set` payload of the crisis write. */
function crisisUpdate(db: MockDb) {
  const call = db.collectionMocks.settlementCrises!.updateOne.mock.calls[0];
  return call[1].$set;
}

describe("processSettlementTurn", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("does nothing when the feature gate is off", async () => {
    prime(db, "gameState").findOne.mockResolvedValue({
      _id: "current",
      settlementCrisisEnabled: false,
    });
    const crises = prime(db, "settlementCrises");
    const { processSettlementTurn } = await import("./settlementPhase");
    const result = await processSettlementTurn(db as unknown as Db, 412);
    expect(result.playsResolved).toBe(0);
    expect(crises.updateOne).not.toHaveBeenCalled();
  });

  it("does nothing when no crisis is open", async () => {
    prime(db, "gameState").findOne.mockResolvedValue({
      _id: "current",
      settlementCrisisEnabled: true,
    });
    prime(db, "settlementCrises").findOne.mockResolvedValue(null);
    const { processSettlementTurn } = await import("./settlementPhase");
    const result = await processSettlementTurn(db as unknown as Db, 412);
    expect(result.playsResolved).toBe(0);
  });

  it("leaves a frozen crisis untouched", async () => {
    arrange(db, crisis({ status: "frozen", conflictId: "conflict-1" }), [play()]);
    const { processSettlementTurn } = await import("./settlementPhase");
    const result = await processSettlementTurn(db as unknown as Db, 412);
    expect(result.playsResolved).toBe(0);
    expect(db.collectionMocks.settlementCrises!.updateOne).not.toHaveBeenCalled();
  });

  it("applies a play at the seat multiplier and rewrites the index", async () => {
    arrange(db, crisis(), [play()]);
    const { processSettlementTurn } = await import("./settlementPhase");
    await processSettlementTurn(db as unknown as Db, 412);

    const update = crisisUpdate(db);
    const laender = update.institutions.find((i: { id: string }) => i.id === "laender");
    // 4.0 base x 2.0 seat = +800. Subtracting the drift roll makes this exact
    // rather than a range that a sufficiently negative roll could fail.
    expect(laender.position - laender.lastDrift).toBe(37 * HUNDREDTHS + 800);
  });

  it("keeps the index equal to the weighted mean of the cards", async () => {
    arrange(db, crisis(), [
      play({
        seatId: "US",
        countryId: "US",
        playId: "credit",
        targetInstitutionId: "laender",
        direction: -1,
        basePoints: 5 * HUNDREDTHS,
      }),
      play({
        seatId: "RU",
        countryId: "RU",
        playId: "peace",
        targetInstitutionId: "street",
        direction: 1,
        basePoints: 5 * HUNDREDTHS,
      }),
    ]);
    const { processSettlementTurn } = await import("./settlementPhase");
    await processSettlementTurn(db as unknown as Db, 412);

    const update = crisisUpdate(db);
    const expected = Math.round(
      update.institutions.reduce(
        (s: number, i: { position: number; weight: number }) => s + i.position * i.weight,
        0
      ) / 10
    );
    expect(update.position).toBe(expected);
  });

  it("spreads a settlement-level play across every institution equally", async () => {
    arrange(db, crisis(), [
      play({ playId: "referendum", targetInstitutionId: null, basePoints: 5 * HUNDREDTHS }),
    ]);
    const { processSettlementTurn } = await import("./settlementPhase");
    await processSettlementTurn(db as unknown as Db, 412);

    const update = crisisUpdate(db);
    // Every institution gains the same 1000 hundredths, before its own drift.
    const gains = update.institutions.map(
      (i: { id: string; position: number; lastDrift: number }) =>
        i.position - i.lastDrift - SETTLEMENT_INSTITUTIONS.find((d) => d.id === i.id)!.opening
    );
    expect(new Set(gains)).toEqual(new Set([1000]));
  });

  it("stamps resolved plays rather than deleting them", async () => {
    const p = play();
    arrange(db, crisis(), [p]);
    const { processSettlementTurn } = await import("./settlementPhase");
    await processSettlementTurn(db as unknown as Db, 412);

    expect(db.collectionMocks.settlementPlays!.updateOne).toHaveBeenCalledWith(
      { _id: p._id },
      { $set: { resolvedTurn: 412, appliedPoints: 800 } }
    );
    expect(db.collectionMocks.settlementPlays!.deleteOne).not.toHaveBeenCalled();
  });

  it("claims each play before applying it so an overlapping run cannot double-apply", async () => {
    const p = play();
    arrange(db, crisis(), [p]);
    // matchedCount 0 = another turn runner already claimed this play.
    db.collectionMocks.settlementPlays!.updateOne.mockResolvedValue({ matchedCount: 0 });
    const { processSettlementTurn } = await import("./settlementPhase");
    const result = await processSettlementTurn(db as unknown as Db, 412);

    expect(db.collectionMocks.settlementPlays!.updateOne).toHaveBeenCalledWith(
      { _id: p._id, resolvedTurn: null },
      { $set: { resolvedTurn: 412 } }
    );
    expect(result.playsResolved).toBe(0);
  });

  it("claims on the same field the stamp writes, so the second runner matches nothing", async () => {
    const p = play();
    arrange(db, crisis(), [p]);
    const { processSettlementTurn } = await import("./settlementPhase");
    await processSettlementTurn(db as unknown as Db, 412);

    const calls = db.collectionMocks.settlementPlays!.updateOne.mock.calls;
    const claim = calls.find((c) => c[0].resolvedTurn === null);
    expect(claim).toBeDefined();
    expect(claim![1]).toEqual({ $set: { resolvedTurn: 412 } });
  });

  it("records the weighted drift in a history capped at six entries", async () => {
    arrange(db, crisis({ driftHistory: [1, 2, 3, 4, 5, 6] }), []);
    const { processSettlementTurn } = await import("./settlementPhase");
    await processSettlementTurn(db as unknown as Db, 412);

    const update = crisisUpdate(db);
    expect(update.driftHistory).toHaveLength(6);
    expect(update.driftHistory.slice(1)).toEqual([1, 2, 3, 4, 5]);
  });

  it("accrues seat capital to the cap and resets the per-turn action counters", async () => {
    arrange(
      db,
      crisis({
        seats: SETTLEMENT_SEATS.map((s) => ({
          id: s.id,
          capital: 59,
          actionsUsedTurn: 2,
          lastActedTurn: 411,
          committedPoints: 0,
        })),
      }),
      []
    );
    const { processSettlementTurn } = await import("./settlementPhase");
    await processSettlementTurn(db as unknown as Db, 412);

    const update = crisisUpdate(db);
    for (const seat of update.seats) {
      expect(seat.capital).toBe(60);
      expect(seat.actionsUsedTurn).toBe(0);
    }
  });

  it("resolves for the challenger once the index reaches the carry threshold", async () => {
    const nearly = crisis({
      institutions: SETTLEMENT_INSTITUTIONS.map((i) => ({
        id: i.id,
        weight: i.weight,
        position: 9000,
        lastPlay: null,
        lastDrift: 0,
      })),
      position: 9000,
    });
    arrange(db, nearly, []);
    const { processSettlementTurn } = await import("./settlementPhase");
    const result = await processSettlementTurn(db as unknown as Db, 412);

    const update = crisisUpdate(db);
    expect(update.status).toBe("resolved");
    expect(update.outcome).toBe("challenger");
    expect(update.resolvedTurn).toBe(412);
    expect(result.crisesResolved).toBe(1);
  });

  it("resolves for the incumbent once the index falls to the lock threshold", async () => {
    const nearly = crisis({
      institutions: SETTLEMENT_INSTITUTIONS.map((i) => ({
        id: i.id,
        weight: i.weight,
        position: 800,
        lastPlay: null,
        lastDrift: 0,
      })),
      position: 800,
    });
    arrange(db, nearly, []);
    const { processSettlementTurn } = await import("./settlementPhase");
    await processSettlementTurn(db as unknown as Db, 412);

    const update = crisisUpdate(db);
    expect(update.status).toBe("resolved");
    expect(update.outcome).toBe("incumbent");
  });

  it("decays ladder heat when no coercive play lands", async () => {
    arrange(db, crisis({ ladder: { heat: 3, armedTurn: null } }), [play()]);
    const { processSettlementTurn } = await import("./settlementPhase");
    await processSettlementTurn(db as unknown as Db, 412);

    expect(crisisUpdate(db).ladder.heat).toBe(2);
  });

  it("raises ladder heat on a coercive play but not past rung 4", async () => {
    arrange(db, crisis({ ladder: { heat: 4, armedTurn: null } }), [
      play({ playId: "border", targetInstitutionId: "street", heatAdded: 1 }),
    ]);
    const { processSettlementTurn } = await import("./settlementPhase");
    await processSettlementTurn(db as unknown as Db, 412);

    expect(crisisUpdate(db).ladder.heat).toBe(4);
  });

  it("credits a seat's committed points and stamps that it acted", async () => {
    arrange(db, crisis(), [play()]);
    const { processSettlementTurn } = await import("./settlementPhase");
    await processSettlementTurn(db as unknown as Db, 412);

    const dd = crisisUpdate(db).seats.find((s: { id: string }) => s.id === "DD");
    expect(dd.committedPoints).toBe(800);
    expect(dd.lastActedTurn).toBe(412);
  });

  it("records the play that moved an institution", async () => {
    arrange(db, crisis(), [play()]);
    const { processSettlementTurn } = await import("./settlementPhase");
    await processSettlementTurn(db as unknown as Db, 412);

    const laender = crisisUpdate(db).institutions.find((i: { id: string }) => i.id === "laender");
    expect(laender.lastPlay).toEqual({
      seatId: "DD",
      label: "Fraternal Aid Package",
      turn: 412,
    });
  });
});
