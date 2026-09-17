/**
 * Reshuffle-guard I/O tests (#1994): tenure, cooldowns, escalation, and
 * observability end to end through `runMinisterialGovernance`, plus the
 * caretaker / player-controlled exclusions and the restart-persistence loop.
 *
 * Fixture: an IE NPP government (reformer head, reshuffle-prone) with an
 * agenda raising `economic_growth` to 65 while health sits at 10 (shortfall
 * ~0.85) — far past the threshold, so the pre-fix code reshuffles every
 * turn. Each test asserts what the guard does about it.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb, createAsyncIterableCursor } from "@/lib/test-utils/mockDb";

const { atLeastMock } = vi.hoisted(() => ({ atLeastMock: vi.fn() }));
vi.mock("../featureFlag", () => ({ nppAutonomyAtLeast: (...a: unknown[]) => atLeastMock(...a) }));

import { runMinisterialGovernance, runCaretakerMinisters } from "../ministerialGovernance";
import { RESHUFFLE_GUARD_CONFIG } from "../rules/reshuffleGuard";

const now = new Date("2026-06-24T12:00:00Z");
const TURN = 100;
const headId = new ObjectId();
const finNppId = new ObjectId();
const taoiseachNppId = new ObjectId();

// Reformer head (ambition high, stubbornness low) → reshufflePropensity 0.6.
const head = {
  _id: headId,
  personality: { ambition: 80, stubbornness: 20, loyalty: 50 },
};

const REFORMER = { ambition: 80, stubbornness: 20, loyalty: 50 };

function minister(positionId: string, nppId: ObjectId, over: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    countryId: "IE",
    positionId,
    isNPP: true,
    nppId,
    ministerialActions: 2,
    ...over,
  };
}

function setup(opts: {
  gov: Record<string, unknown>;
  ministers?: Record<string, unknown>[];
  headDoc?: Record<string, unknown> | null;
  stateMetrics?: Record<string, unknown> | null;
}) {
  const db = createMockDb();
  db.collectionMocks["governmentFormations"] = {
    ...db.collection("governmentFormations"),
    findOne: vi.fn().mockResolvedValue(opts.gov),
    updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
  } as MockDb["collectionMocks"][string];
  db.collectionMocks["cabinetMembers"] = {
    ...db.collection("cabinetMembers"),
    find: vi.fn().mockReturnValue(createAsyncIterableCursor(opts.ministers ?? [])),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
  } as MockDb["collectionMocks"][string];
  db.collectionMocks["npps"] = {
    ...db.collection("npps"),
    find: vi.fn().mockReturnValue(
      createAsyncIterableCursor([
        { _id: finNppId, personality: REFORMER },
        { _id: taoiseachNppId, personality: REFORMER },
      ])
    ),
    findOne: vi.fn().mockResolvedValue(opts.headDoc ?? head),
  } as MockDb["collectionMocks"][string];
  db.collectionMocks["stateMetrics"] = {
    ...db.collection("stateMetrics"),
    findOne: vi.fn().mockResolvedValue(opts.stateMetrics ?? null),
  } as MockDb["collectionMocks"][string];
  db.collectionMocks["macroMetrics"] = {
    ...db.collection("macroMetrics"),
    findOne: vi.fn().mockResolvedValue(opts.stateMetrics ?? null),
  } as MockDb["collectionMocks"][string];
  db.collectionMocks["cabinetSettings"] = {
    ...db.collection("cabinetSettings"),
    findOne: vi.fn().mockResolvedValue(null),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
  } as MockDb["collectionMocks"][string];
  db.collectionMocks["ministerialOrders"] = {
    ...db.collection("ministerialOrders"),
    find: vi.fn().mockReturnValue(createAsyncIterableCursor([])),
    updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    insertOne: vi.fn().mockResolvedValue({ insertedId: new ObjectId() }),
  } as MockDb["collectionMocks"][string];
  return db;
}

function failingGov(over: Record<string, unknown> = {}) {
  return {
    _id: "IE",
    status: "formed",
    pmNppId: headId,
    cycle: 3,
    formedTurn: 10,
    governingAgenda: {
      items: [{ domain: "economic_growth", target: 65, direction: "raise", priority: 1 }],
    },
    ...over,
  };
}

// economic_growth (gdpGrowth) far below target → shortfall ~0.85.
const FAILING_HEALTH = { economic: { gdpGrowth: 10 } };

function deleteOne(db: MockDb) {
  return db.collectionMocks["cabinetMembers"].deleteOne as ReturnType<typeof vi.fn>;
}

function govUpdateOne(db: MockDb) {
  return db.collectionMocks["governmentFormations"].updateOne as ReturnType<typeof vi.fn>;
}

beforeEach(() => {
  atLeastMock.mockReset().mockResolvedValue(true);
});

describe("runMinisterialGovernance reshuffle guard (I/O)", () => {
  it("minimum tenure: a newly appointed minister survives a failing shortfall", async () => {
    const db = setup({
      gov: failingGov(),
      ministers: [minister("minister_for_finance", finNppId, { appointedTurn: TURN })],
      stateMetrics: FAILING_HEALTH,
    });
    const res = await runMinisterialGovernance(db as unknown as Db, "IE", TURN, now);
    expect(res.ran).toBe(true);
    expect(res.reshuffled).toBe(0);
    expect(deleteOne(db)).not.toHaveBeenCalled();
    expect(govUpdateOne(db)).not.toHaveBeenCalled();
  });

  it("a tenured minister is still reshuffled, with reason/tenure/shortfall recorded", async () => {
    const db = setup({
      gov: failingGov(),
      ministers: [minister("minister_for_finance", finNppId, { appointedTurn: TURN - 24 })],
      stateMetrics: FAILING_HEALTH,
    });
    const res = await runMinisterialGovernance(db as unknown as Db, "IE", TURN, now);
    expect(res.reshuffled).toBe(1);
    expect(deleteOne(db)).toHaveBeenCalledWith({
      countryId: "IE",
      positionId: "minister_for_finance",
    });
    expect(govUpdateOne(db)).toHaveBeenCalledTimes(1);
    const set = govUpdateOne(db).mock.calls[0][1].$set;
    expect(set.ministerialReshuffle.governmentKey).toBe(`3:10:${headId.toString()}`);
    expect(set.ministerialReshuffle.lastReshuffleTurn).toBe(TURN);
    expect(set.ministerialReshuffle.lastReplacement).toMatchObject({
      positionId: "minister_for_finance",
      turn: TURN,
      reason: "underperformance",
      priorTenureTurns: 24,
      consecutiveReshuffles: 1,
      escalated: false,
    });
    expect(set.ministerialReshuffle.lastReplacement.shortfall).toBeGreaterThan(0.8);
    expect(set.ministerialReshuffle.portfolios["minister_for_finance"]).toMatchObject({
      lastReshuffleTurn: TURN,
      consecutiveReshuffles: 1,
      escalated: false,
    });
  });

  it("legacy unstamped seats keep the old eligibility (no freeze on old saves)", async () => {
    const db = setup({
      gov: failingGov(),
      ministers: [minister("minister_for_finance", finNppId)],
      stateMetrics: FAILING_HEALTH,
    });
    const res = await runMinisterialGovernance(db as unknown as Db, "IE", TURN, now);
    expect(res.reshuffled).toBe(1);
    expect(deleteOne(db)).toHaveBeenCalled();
  });

  it("government cooldown: at most one reshuffle per window across portfolios", async () => {
    const db = setup({
      gov: failingGov(),
      ministers: [
        minister("minister_for_finance", finNppId, { appointedTurn: TURN - 30 }),
        minister("taoiseach", taoiseachNppId, { appointedTurn: TURN - 30 }),
      ],
      stateMetrics: FAILING_HEALTH,
    });
    const res = await runMinisterialGovernance(db as unknown as Db, "IE", TURN, now);
    // Both briefs fail, but the second is refused by the government cooldown.
    expect(deleteOne(db)).toHaveBeenCalledTimes(1);
    expect(res.reshuffled).toBe(1);
  });

  it("portfolio cooldown: a recently reshuffled seat is spared", async () => {
    const db = setup({
      gov: failingGov({
        ministerialReshuffle: {
          governmentKey: `3:10:${headId.toString()}`,
          lastReshuffleTurn: 50,
          portfolios: {
            minister_for_finance: {
              lastReshuffleTurn: TURN - 10,
              consecutiveReshuffles: 1,
              lastShortfallAtReshuffle: 0.85,
              escalated: false,
            },
          },
          lastReplacement: null,
        },
      }),
      ministers: [minister("minister_for_finance", finNppId, { appointedTurn: TURN - 40 })],
      stateMetrics: FAILING_HEALTH,
    });
    const res = await runMinisterialGovernance(db as unknown as Db, "IE", TURN, now);
    expect(res.reshuffled).toBe(0);
    expect(deleteOne(db)).not.toHaveBeenCalled();
    expect(govUpdateOne(db)).not.toHaveBeenCalled();
  });

  it("unchanged structural shortfall escalates instead of replacing again", async () => {
    const db = setup({
      gov: failingGov({
        ministerialReshuffle: {
          governmentKey: `3:10:${headId.toString()}`,
          lastReshuffleTurn: 0,
          portfolios: {
            minister_for_finance: {
              lastReshuffleTurn: 0,
              consecutiveReshuffles: 2,
              lastShortfallAtReshuffle: 0.85,
              escalated: false,
            },
          },
          lastReplacement: null,
        },
      }),
      ministers: [minister("minister_for_finance", finNppId, { appointedTurn: TURN - 40 })],
      stateMetrics: FAILING_HEALTH,
    });
    const res = await runMinisterialGovernance(db as unknown as Db, "IE", TURN, now);
    expect(res.reshuffled).toBe(0);
    expect(deleteOne(db)).not.toHaveBeenCalled();
    // One marking write flips the portfolio to escalated; later turns refuse
    // on the flag alone with no further writes.
    expect(govUpdateOne(db)).toHaveBeenCalledTimes(1);
    const set = govUpdateOne(db).mock.calls[0][1].$set;
    expect(set.ministerialReshuffle.portfolios["minister_for_finance"].escalated).toBe(true);
  });

  it("an escalated portfolio stays refused with no further writes", async () => {
    const db = setup({
      gov: failingGov({
        ministerialReshuffle: {
          governmentKey: `3:10:${headId.toString()}`,
          lastReshuffleTurn: 0,
          portfolios: {
            minister_for_finance: {
              lastReshuffleTurn: 0,
              consecutiveReshuffles: 2,
              lastShortfallAtReshuffle: 0.85,
              escalated: true,
            },
          },
          lastReplacement: null,
        },
      }),
      ministers: [minister("minister_for_finance", finNppId, { appointedTurn: TURN - 40 })],
      stateMetrics: FAILING_HEALTH,
    });
    const res = await runMinisterialGovernance(db as unknown as Db, "IE", TURN, now);
    expect(res.reshuffled).toBe(0);
    expect(deleteOne(db)).not.toHaveBeenCalled();
    expect(govUpdateOne(db)).not.toHaveBeenCalled();
  });

  it("a materially changed shortfall restarts the bounded run", async () => {
    const db = setup({
      gov: failingGov({
        ministerialReshuffle: {
          governmentKey: `3:10:${headId.toString()}`,
          lastReshuffleTurn: 0,
          portfolios: {
            minister_for_finance: {
              lastReshuffleTurn: 0,
              consecutiveReshuffles: 2,
              lastShortfallAtReshuffle: 0.4,
              escalated: true,
            },
          },
          lastReplacement: null,
        },
      }),
      ministers: [minister("minister_for_finance", finNppId, { appointedTurn: TURN - 40 })],
      stateMetrics: FAILING_HEALTH,
    });
    const res = await runMinisterialGovernance(db as unknown as Db, "IE", TURN, now);
    expect(res.reshuffled).toBe(1);
    const set = govUpdateOne(db).mock.calls[0][1].$set;
    expect(set.ministerialReshuffle.portfolios["minister_for_finance"]).toMatchObject({
      consecutiveReshuffles: 1,
      escalated: false,
    });
  });

  it("government transition starts clean: old escalation does not bind the new government", async () => {
    const db = setup({
      gov: failingGov({
        cycle: 4,
        formedTurn: 120,
        ministerialReshuffle: {
          governmentKey: `3:10:${headId.toString()}`,
          lastReshuffleTurn: 90,
          portfolios: {
            minister_for_finance: {
              lastReshuffleTurn: 90,
              consecutiveReshuffles: 2,
              lastShortfallAtReshuffle: 0.85,
              escalated: true,
            },
          },
          lastReplacement: null,
        },
      }),
      ministers: [minister("minister_for_finance", finNppId, { appointedTurn: TURN - 40 })],
      stateMetrics: FAILING_HEALTH,
    });
    const res = await runMinisterialGovernance(db as unknown as Db, "IE", TURN, now);
    expect(res.reshuffled).toBe(1);
    const set = govUpdateOne(db).mock.calls[0][1].$set;
    expect(set.ministerialReshuffle.governmentKey).toBe(`4:120:${headId.toString()}`);
  });

  it("restart persistence: turn N reshuffles, turn N+1 refuses the fresh replacement", async () => {
    // State flows only through the persisted gov doc: the turn-101 call reads
    // what the turn-100 call wrote, with no in-memory carry (restart-safe).
    const govDoc = failingGov();
    const db = setup({
      gov: govDoc,
      ministers: [minister("minister_for_finance", finNppId, { appointedTurn: TURN - 30 })],
      stateMetrics: FAILING_HEALTH,
    });
    // Persist $set payloads back onto the doc, the way Mongo would.
    govUpdateOne(db).mockImplementation(async (_filter: unknown, update: never) => {
      Object.assign(govDoc, (update as { $set: Record<string, unknown> }).$set);
      return { matchedCount: 1, modifiedCount: 1 };
    });
    const first = await runMinisterialGovernance(db as unknown as Db, "IE", TURN, now);
    expect(first.reshuffled).toBe(1);
    expect((govDoc as Record<string, unknown>).ministerialReshuffle).toBeDefined();

    // Next turn the seat is refilled (formNppCabinet stamps the new tenure)
    // and the same shortfall persists — the pre-fix code would fire again.
    const membersFind = db.collectionMocks["cabinetMembers"].find as ReturnType<typeof vi.fn>;
    membersFind.mockReturnValue(
      createAsyncIterableCursor([
        minister("minister_for_finance", new ObjectId(), { appointedTurn: TURN + 1 }),
      ])
    );
    const second = await runMinisterialGovernance(db as unknown as Db, "IE", TURN + 1, now);
    expect(second.reshuffled).toBe(0);
    expect(deleteOne(db)).toHaveBeenCalledTimes(1);
  });

  it("player-appointed seats are excluded from dismissal (mixed cabinet)", async () => {
    // A caretaker NPP stranded in a non-player country: tenured, failing, and
    // threshold-met, but appointed by a human head — the guard must not vacate
    // it. Dismissal stays on the cabinet surface (`dismissCaretakerMinister`).
    const db = setup({
      gov: failingGov(),
      ministers: [
        {
          ...minister("minister_for_finance", finNppId, { appointedTurn: TURN - 40 }),
          appointedByCharacterId: new ObjectId(),
        },
      ],
      stateMetrics: FAILING_HEALTH,
    });
    const res = await runMinisterialGovernance(db as unknown as Db, "IE", TURN, now);
    expect(res.ran).toBe(true);
    expect(res.reshuffled).toBe(0);
    expect(deleteOne(db)).not.toHaveBeenCalled();
    expect(govUpdateOne(db)).not.toHaveBeenCalled();
  });

  it("same-turn retry after a reshuffle does not replace twice", async () => {
    // Crash/duplicate-execution safety: the first call's delete + guard write
    // are both visible to the retry, which must no-op on both the tenure and
    // the government-cooldown gates.
    const govDoc = failingGov();
    const db = setup({
      gov: govDoc,
      ministers: [minister("minister_for_finance", finNppId, { appointedTurn: TURN - 30 })],
      stateMetrics: FAILING_HEALTH,
    });
    govUpdateOne(db).mockImplementation(async (_filter: unknown, update: never) => {
      Object.assign(govDoc, (update as { $set: Record<string, unknown> }).$set);
      return { matchedCount: 1, modifiedCount: 1 };
    });
    const first = await runMinisterialGovernance(db as unknown as Db, "IE", TURN, now);
    expect(first.reshuffled).toBe(1);

    // The vacated seat is refilled before the retry (fresh tenure stamp).
    const membersFind = db.collectionMocks["cabinetMembers"].find as ReturnType<typeof vi.fn>;
    membersFind.mockReturnValue(
      createAsyncIterableCursor([
        minister("minister_for_finance", new ObjectId(), { appointedTurn: TURN }),
      ])
    );
    const retry = await runMinisterialGovernance(db as unknown as Db, "IE", TURN, now);
    expect(retry.reshuffled).toBe(0);
    expect(deleteOne(db)).toHaveBeenCalledTimes(1);
    expect(govUpdateOne(db)).toHaveBeenCalledTimes(1);
  });

  it("guard-state write is scoped to the seated government", async () => {
    const db = setup({
      gov: failingGov(),
      ministers: [minister("minister_for_finance", finNppId, { appointedTurn: TURN - 30 })],
      stateMetrics: FAILING_HEALTH,
    });
    const res = await runMinisterialGovernance(db as unknown as Db, "IE", TURN, now);
    expect(res.reshuffled).toBe(1);
    // A mid-turn transition must not have its fresh state clobbered: the
    // write carries the (cycle, formedTurn) continuity identity.
    expect(govUpdateOne(db).mock.calls[0][0]).toMatchObject({
      _id: "IE",
      cycle: 3,
      formedTurn: 10,
    });
  });

  it("guardConfig override retunes the shell without mutating shared state", async () => {
    const db = setup({
      gov: failingGov(),
      ministers: [minister("minister_for_finance", finNppId, { appointedTurn: TURN - 24 })],
      stateMetrics: FAILING_HEALTH,
    });
    const res = await runMinisterialGovernance(db as unknown as Db, "IE", TURN, now, {
      ...RESHUFFLE_GUARD_CONFIG,
      minMinisterTenureTurns: 100,
    });
    expect(res.reshuffled).toBe(0);
    expect(deleteOne(db)).not.toHaveBeenCalled();
  });

  it("player-controlled exclusion: below the v1 gate nothing is touched", async () => {
    atLeastMock.mockResolvedValue(false);
    const db = setup({
      gov: failingGov(),
      ministers: [minister("minister_for_finance", finNppId, { appointedTurn: TURN - 40 })],
      stateMetrics: FAILING_HEALTH,
    });
    const res = await runMinisterialGovernance(db as unknown as Db, "IE", TURN, now);
    expect(res.ran).toBe(false);
    expect(deleteOne(db)).not.toHaveBeenCalled();
    expect(govUpdateOne(db)).not.toHaveBeenCalled();
  });

  it("player-headed government: no NPP head means no reshuffle propensity", async () => {
    const db = setup({
      gov: failingGov({ pmNppId: null, presidentNppId: null }),
      ministers: [minister("minister_for_finance", finNppId, { appointedTurn: TURN - 40 })],
      headDoc: null,
      stateMetrics: FAILING_HEALTH,
    });
    const res = await runMinisterialGovernance(db as unknown as Db, "IE", TURN, now);
    expect(res.ran).toBe(true);
    expect(res.reshuffled).toBe(0);
    expect(deleteOne(db)).not.toHaveBeenCalled();
    expect(govUpdateOne(db)).not.toHaveBeenCalled();
  });
});

describe("runCaretakerMinisters exclusion (I/O)", () => {
  it("caretakers with failing briefs are never dismissed", async () => {
    const db = setup({
      gov: failingGov(),
      ministers: [
        {
          ...minister("minister_for_finance", finNppId, { appointedTurn: TURN - 40 }),
          appointedByCharacterId: new ObjectId(),
        },
      ],
      stateMetrics: FAILING_HEALTH,
    });
    // Caretaker NPP needs ideology/personality for its own portfolio agenda.
    const nppsFind = db.collectionMocks["npps"].find as ReturnType<typeof vi.fn>;
    nppsFind.mockReturnValue(
      createAsyncIterableCursor([
        {
          _id: finNppId,
          personality: REFORMER,
          policies: { economic: -3, social: -2 },
        },
      ])
    );
    const res = await runCaretakerMinisters(db as unknown as Db, "IE", TURN, now);
    expect(res.ran).toBe(true);
    expect(res.reshuffled).toBe(0);
    expect(deleteOne(db)).not.toHaveBeenCalled();
  });
});
