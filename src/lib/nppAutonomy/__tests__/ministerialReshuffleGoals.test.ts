/**
 * Ministers judged on their goal (v6), end to end through
 * `runMinisterialGovernance`. Same IE fixture as the reshuffle-guard tests: a
 * reshuffle-prone head, an agenda raising `economic_growth` to 65, and a
 * finance minister whose brief covers that domain. Each case runs the same
 * fixture at v5 and v6, so the v5 run pins the below-v6 behavior.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb, createAsyncIterableCursor } from "@/lib/test-utils/mockDb";

const { atLeastMock } = vi.hoisted(() => ({ atLeastMock: vi.fn() }));
vi.mock("../featureFlag", () => ({ nppAutonomyAtLeast: (...a: unknown[]) => atLeastMock(...a) }));

import { runMinisterialGovernance } from "../ministerialGovernance";

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

let v6On = true;
beforeEach(() => {
  v6On = true;
  atLeastMock
    .mockReset()
    .mockImplementation(async (_db: unknown, _c: unknown, level: string) => level !== "v6" || v6On);
});

function goal(over: Record<string, unknown> = {}) {
  return {
    domain: "economic_growth",
    direction: "raise",
    target: 65,
    priority: 1,
    status: "active",
    openedTurn: 90,
    reviewedTurn: 90,
    openingAttainment: 0.05,
    attainment: 0.05,
    strikes: 0,
    ...over,
  };
}

async function run(opts: {
  v6: boolean;
  goals: Record<string, unknown>[];
  health: Record<string, unknown>;
  appointedTurn: number;
  govOver?: Record<string, unknown>;
}) {
  v6On = opts.v6;
  const db = setup({
    gov: failingGov({
      governingGoals: { goals: opts.goals, updatedTurn: 90 },
      ...(opts.govOver ?? {}),
    }),
    ministers: [minister("minister_for_finance", finNppId, { appointedTurn: opts.appointedTurn })],
    stateMetrics: opts.health,
  });
  const res = await runMinisterialGovernance(db as unknown as Db, "IE", TURN, now);
  return { db, res };
}

describe("ministers judged on their goal (v6, I/O)", () => {
  it("keeps a minister making progress on a badly failing domain at v6 only", async () => {
    // Health 10 of 65 is an 85% shortfall, but attainment rose 0.05 -> 0.15.
    const fixture = {
      goals: [goal()],
      health: FAILING_HEALTH,
      appointedTurn: TURN - 40,
    };
    const v5 = await run({ ...fixture, v6: false });
    expect(v5.res.reshuffled).toBe(1);
    const v6 = await run({ ...fixture, v6: true });
    expect(v6.res.reshuffled).toBe(0);
    expect(deleteOne(v6.db)).not.toHaveBeenCalled();
  });

  it("reshuffles a minister whose goal failed on their watch at v6 only", async () => {
    // Health 60 of 65 is under the shortfall floor, so v5 keeps the minister.
    const fixture = {
      goals: [goal({ strikes: 1, openingAttainment: 60 / 65, attainment: 60 / 65 })],
      health: { economic: { gdpGrowth: 60 } },
      appointedTurn: TURN - 40,
    };
    const v5 = await run({ ...fixture, v6: false });
    expect(v5.res.reshuffled).toBe(0);
    const v6 = await run({ ...fixture, v6: true });
    expect(v6.res.reshuffled).toBe(1);
    const set = govUpdateOne(v6.db).mock.calls[0][1].$set;
    expect(set.ministerialReshuffle.lastReplacement).toMatchObject({
      positionId: "minister_for_finance",
      reason: "goal-failed",
      priorTenureTurns: 40,
    });
  });

  it("does not blame a minister appointed after the strike", async () => {
    const { res } = await run({
      v6: true,
      goals: [goal({ strikes: 1, openingAttainment: 60 / 65, attainment: 60 / 65 })],
      health: { economic: { gdpGrowth: 60 } },
      appointedTurn: 95,
    });
    expect(res.reshuffled).toBe(0);
  });

  it("still applies the tenure and cooldown guard to a failed-goal candidate", async () => {
    const failed = {
      v6: true,
      goals: [
        goal({ strikes: 1, openingAttainment: 60 / 65, attainment: 60 / 65, openedTurn: 99 }),
      ],
      health: { economic: { gdpGrowth: 60 } },
    };
    // Minimum tenure: in post when the strike landed, but under 24 turns.
    const tenure = await run({ ...failed, appointedTurn: TURN - 5 });
    expect(tenure.res.reshuffled).toBe(0);
    // Government cooldown: the head reshuffled someone three turns ago.
    const cooldown = await run({
      ...failed,
      appointedTurn: TURN - 40,
      govOver: {
        ministerialReshuffle: {
          governmentKey: `3:10:${headId.toString()}`,
          lastReshuffleTurn: TURN - 3,
          portfolios: {},
          lastReplacement: null,
        },
      },
    });
    expect(cooldown.res.reshuffled).toBe(0);
    expect(deleteOne(cooldown.db)).not.toHaveBeenCalled();
  });

  it("is the shortfall rule unchanged at v6 when the government holds no goals", async () => {
    const { res } = await run({
      v6: true,
      goals: [],
      health: FAILING_HEALTH,
      appointedTurn: TURN - 40,
    });
    expect(res.reshuffled).toBe(1);
  });
});
