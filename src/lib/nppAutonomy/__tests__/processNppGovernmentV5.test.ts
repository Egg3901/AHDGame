/**
 * V5 persistence, end to end through the Tier-1 governing slot.
 *
 * The pure goal rules are covered in `v5/rules/governingGoals.test.ts`. What
 * these cover is the wiring: that a v4 world writes nothing new, that a v5 world
 * persists a bounded goal set, that the set survives the next recompute, and
 * that the local-world difficulty reaches the slot count.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { POLITICAL_METRIC_FAMILIES } from "@/lib/politicalMetrics/families";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { tier1DecisionTurnForCycle } from "../tier1DecisionSchedule";
import { GOAL_SLOT_CAP, type GoverningGoalRecord } from "../v5/rules/governingGoals";
import { nppBehaviorPolicy } from "@/lib/singleplayerDifficulty/rules/behavior";

const {
  atLeastMock,
  appointPresidentMock,
  conditionsMock,
  formCabinetMock,
  ministerialMock,
  caretakerMinistersMock,
  claimSlotMock,
  enabledForPlayersMock,
  foreignPolicyMock,
} = vi.hoisted(() => ({
  atLeastMock: vi.fn(),
  appointPresidentMock: vi.fn(),
  conditionsMock: vi.fn(),
  formCabinetMock: vi.fn(),
  ministerialMock: vi.fn(),
  caretakerMinistersMock: vi.fn(),
  claimSlotMock: vi.fn(),
  enabledForPlayersMock: vi.fn(),
  foreignPolicyMock: vi.fn(),
}));
vi.mock("../featureFlag", () => ({
  nppAutonomyAtLeast: (...a: unknown[]) => atLeastMock(...a),
}));
vi.mock("../appointNppPresident", () => ({
  appointNppPresident: (...a: unknown[]) => appointPresidentMock(...a),
}));
vi.mock("../formNppCabinet", () => ({
  formNppCabinet: (...a: unknown[]) => formCabinetMock(...a),
}));
vi.mock("../ministerialGovernance", () => ({
  runMinisterialGovernance: (...a: unknown[]) => ministerialMock(...a),
  runCaretakerMinisters: (...a: unknown[]) => caretakerMinistersMock(...a),
}));
vi.mock("@/lib/turn/npp/billSponsorship", () => ({
  loadConditionsSignal: (...a: unknown[]) => conditionsMock(...a),
}));
vi.mock("../tier1DecisionClaim", () => ({
  claimTier1NppDecisionSlot: (...a: unknown[]) => claimSlotMock(...a),
}));
vi.mock("@/lib/countryAccess", () => ({
  isCountryEnabledForPlayers: (...a: unknown[]) => enabledForPlayersMock(...a),
}));
vi.mock("../foreignPolicy", () => ({
  processAutonomousForeignPolicy: (...a: unknown[]) => foreignPolicyMock(...a),
}));

import { processNppGovernment, AGENDA_RECOMPUTE_INTERVAL_TURNS } from "../processNppGovernment";

let db: MockDb;
const now = new Date("2026-09-06T12:00:00Z");
const headId = new ObjectId();

const headNpp = {
  _id: headId,
  name: "Top Pol",
  party: "5",
  policies: { economic: -4, social: 0 },
  personality: { ambition: 80, stubbornness: 20, loyalty: 50 },
  favorability: 70,
};

function dueTurn(cycle: number): number {
  return tier1DecisionTurnForCycle("BR", cycle);
}

/** A full board, uniform except for named category overrides. */
function boardWith(base: number, categoryOverrides: Record<string, number> = {}) {
  const out: Record<string, number> = {};
  for (const family of POLITICAL_METRIC_FAMILIES) {
    out[family.id] = categoryOverrides[family.categoryId] ?? base;
  }
  return out;
}

function setup(opts: {
  gov: Record<string, unknown>;
  board?: Record<string, number>;
  difficulty?: "easy" | "normal" | "hard";
}) {
  db = createMockDb();
  db.collectionMocks["governmentFormations"] = {
    ...db.collection("governmentFormations"),
    findOne: vi.fn().mockResolvedValue(opts.gov),
    updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
  } as MockDb["collectionMocks"][string];
  db.collectionMocks["npps"] = {
    ...db.collection("npps"),
    findOne: vi.fn().mockResolvedValue(headNpp),
    updateMany: vi.fn().mockResolvedValue({ modifiedCount: 2 }),
  } as MockDb["collectionMocks"][string];
  db.collectionMocks["gameState"] = {
    ...db.collection("gameState"),
    findOne: vi
      .fn()
      .mockResolvedValue(
        opts.difficulty
          ? { _id: "current", singleplayerConfig: { difficulty: opts.difficulty } }
          : { _id: "current" }
      ),
  } as MockDb["collectionMocks"][string];
  const board = opts.board ?? boardWith(20);
  db.collection("politicalMetrics")
    .find()
    .toArray.mockResolvedValue([{ _id: "R1", countryId: "BR", values: board }]);
  db.collection("states")
    .find()
    .toArray.mockResolvedValue([{ _id: "R1", countryId: "BR", population: 1 }]);
}

/** The `governingGoals` payload of the persisted update, if one was written. */
function persistedGoals(): { goals: GoverningGoalRecord[]; updatedTurn: number } | undefined {
  const updateOne = db.collectionMocks["governmentFormations"].updateOne as ReturnType<
    typeof vi.fn
  >;
  return updateOne.mock.calls[0]?.[1]?.$set?.governingGoals;
}

function persistedAgendaDomains(): string[] {
  const updateOne = db.collectionMocks["governmentFormations"].updateOne as ReturnType<
    typeof vi.fn
  >;
  const agenda = updateOne.mock.calls[0]?.[1]?.$set?.governingAgenda;
  return (agenda?.items ?? []).map((item: { domain: string }) => item.domain);
}

/** Gate `nppAutonomyAtLeast` on a level, so v4 and v5 can be told apart. */
function atLevel(level: "v4" | "v5") {
  atLeastMock.mockImplementation((_db: unknown, _country: string, min: string) =>
    Promise.resolve(min !== "v5" || level === "v5")
  );
}

const formedGov = {
  _id: "BR",
  status: "formed",
  presidentNppId: headId,
  governingPartyId: "5",
  seatsByParty: {},
};

beforeEach(() => {
  atLeastMock.mockReset();
  appointPresidentMock.mockReset().mockResolvedValue(false);
  conditionsMock
    .mockReset()
    .mockResolvedValue({ weakDomains: { healthcare: 0.9, education: 0.8, poverty: 0.7 } });
  formCabinetMock.mockReset().mockResolvedValue({ ran: true, filled: 0, filledPositionIds: [] });
  ministerialMock.mockReset().mockResolvedValue({ ran: true, tiersSet: 0, ordersIssued: 0 });
  caretakerMinistersMock
    .mockReset()
    .mockResolvedValue({ ran: false, tiersSet: 0, ordersIssued: 0, reshuffled: 0 });
  claimSlotMock.mockReset().mockImplementation((_db: unknown, _c: string, turn: number) =>
    Promise.resolve({
      run: true,
      bucket: 0,
      cycle: Math.floor((turn - 1) / 6),
      completedCycle: Math.floor((turn - 1) / 6),
    })
  );
  enabledForPlayersMock.mockReset().mockResolvedValue(false);
  foreignPolicyMock.mockReset().mockResolvedValue({
    ran: true,
    mode: "shadow",
    acted: false,
    decisionRecorded: true,
    choice: null,
    skipReason: "no-choice",
  });
});

describe("processNppGovernment — V5 goals", () => {
  it("writes nothing new at v4", async () => {
    atLevel("v4");
    setup({ gov: formedGov });
    const result = await processNppGovernment(db as unknown as Db, "BR", dueTurn(16), now);
    expect(result.agendaUpdated).toBe(true);
    expect(persistedGoals()).toBeUndefined();
  });

  it("persists a bounded, active goal set at v5", async () => {
    atLevel("v5");
    setup({ gov: formedGov });
    const turn = dueTurn(16);
    await processNppGovernment(db as unknown as Db, "BR", turn, now);

    const persisted = persistedGoals();
    expect(persisted).toBeDefined();
    expect(persisted!.updatedTurn).toBe(turn);
    expect(persisted!.goals.length).toBeGreaterThan(0);
    expect(persisted!.goals.length).toBeLessThanOrEqual(GOAL_SLOT_CAP);
    for (const goal of persisted!.goals) {
      expect(goal.status).toBe("active");
      expect(goal.openedTurn).toBe(turn);
      expect(persistedAgendaDomains()).toContain(goal.domain);
    }
  });

  /** The persistence claim: a goal opened in one cycle is still being pursued,
   *  with its original clock, in the next. */
  it("carries a standing goal across the next recompute", async () => {
    atLevel("v5");
    const openedTurn = dueTurn(2);
    const standing: GoverningGoalRecord = {
      domain: "public_safety", // deliberately NOT in the fresh conditions signal
      direction: "raise",
      target: 65,
      priority: 1,
      status: "active",
      openedTurn,
      reviewedTurn: openedTurn,
      openingAttainment: 0.3,
      attainment: 0.3,
      strikes: 0,
    };
    setup({
      gov: {
        ...formedGov,
        governingAgenda: { items: [], archetype: "reformer", computedTurn: openedTurn },
        governingGoals: { goals: [standing], updatedTurn: openedTurn },
      },
    });
    const staleTurn = dueTurn(2 + Math.ceil(AGENDA_RECOMPUTE_INTERVAL_TURNS / 6) + 1);
    await processNppGovernment(db as unknown as Db, "BR", staleTurn, now);

    const persisted = persistedGoals();
    const carried = persisted!.goals.find((goal) => goal.domain === "public_safety");
    expect(carried).toBeDefined();
    expect(carried!.openedTurn).toBe(openedTurn); // hold not restarted
    expect(persistedAgendaDomains()).toContain("public_safety"); // reaches the executors
  });

  it("closes a goal whose domain reached target rather than repeating it forever", async () => {
    atLevel("v5");
    const openedTurn = dueTurn(2);
    const nearlyDone: GoverningGoalRecord = {
      domain: "healthcare",
      direction: "raise",
      target: 65,
      priority: 1,
      status: "active",
      openedTurn,
      reviewedTurn: openedTurn,
      openingAttainment: 0.3,
      attainment: 0.3,
      strikes: 0,
    };
    setup({
      gov: {
        ...formedGov,
        governingAgenda: { items: [], archetype: "reformer", computedTurn: openedTurn },
        governingGoals: { goals: [nearlyDone], updatedTurn: openedTurn },
      },
      // Health well past the 65 target → achieved.
      board: boardWith(20, { health: 95 }),
    });
    const staleTurn = dueTurn(2 + Math.ceil(AGENDA_RECOMPUTE_INTERVAL_TURNS / 6) + 1);
    await processNppGovernment(db as unknown as Db, "BR", staleTurn, now);

    const persisted = persistedGoals();
    // The achieved goal freed its slot; it is not carried as an active goal.
    const carried = persisted!.goals.find((goal) => goal.domain === "healthcare");
    expect(carried?.openedTurn).not.toBe(openedTurn);
  });

  it("gives a harder world more standing goals, without giving it more powers", async () => {
    const counts: Record<string, number> = {};
    for (const difficulty of ["easy", "normal", "hard"] as const) {
      atLevel("v5");
      setup({ gov: formedGov, difficulty });
      await processNppGovernment(db as unknown as Db, "BR", dueTurn(16), now);
      counts[difficulty] = persistedGoals()!.goals.length;
    }
    expect(counts.easy).toBeLessThanOrEqual(nppBehaviorPolicy("easy").goalSlots);
    expect(counts.hard).toBeLessThanOrEqual(nppBehaviorPolicy("hard").goalSlots);
    expect(counts.easy).toBeLessThan(counts.hard);
  });

  it("treats a world with no singleplayerConfig as normal", async () => {
    atLevel("v5");
    setup({ gov: formedGov });
    await processNppGovernment(db as unknown as Db, "BR", dueTurn(16), now);
    const hosted = persistedGoals()!.goals.length;

    atLevel("v5");
    setup({ gov: formedGov, difficulty: "normal" });
    await processNppGovernment(db as unknown as Db, "BR", dueTurn(16), now);
    expect(persistedGoals()!.goals.length).toBe(hosted);
  });

  it("still grades the outgoing agenda and nudges favorability at v5", async () => {
    atLevel("v5");
    const baseTurn = dueTurn(2);
    setup({
      gov: {
        ...formedGov,
        governingAgenda: {
          items: [{ domain: "healthcare", target: 65, direction: "raise", priority: 1 }],
          archetype: "reformer",
          computedTurn: baseTurn,
        },
      },
      board: boardWith(60, { health: 10 }),
    });
    const staleTurn = dueTurn(2 + Math.ceil(AGENDA_RECOMPUTE_INTERVAL_TURNS / 6) + 1);
    await processNppGovernment(db as unknown as Db, "BR", staleTurn, now);
    const updateMany = db.collectionMocks["npps"].updateMany as ReturnType<typeof vi.fn>;
    expect(updateMany).toHaveBeenCalledTimes(1);
  });
});
