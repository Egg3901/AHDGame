/**
 * Regression tests for the "Opens in X turns" dead-zone bug.
 *
 * For short-window perpetual election types (IE dail/localCouncil/uachtaran,
 * CN npcDelegate/peoplesCongress, BR chamber, UK commons/regionalCouncil,
 * JP sangiin) the canonical cycle period is much longer than the election's
 * `durationHours`, so `startTurn = endTurn − durationHours` landed far in the
 * future of the prior general's end. The next cycle spawned as `upcoming`
 * ("Opens in X turns") and candidates could not register for many turns.
 *
 * The fix mirrors the shipped DE behavior: spawn the next cycle with the
 * primary open immediately (`status: "active"`, `startTurn = currentTurn`,
 * `startTime = now`) while keeping the canonical `primaryEndTurn` / `endTurn`
 * so the general still lands on its real-world year.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Election } from "@/lib/db/types";
import { canonicalTurnsForCycle } from "@/lib/elections/canonicalCycle";
import { DEFAULT_CYCLE_ANCHOR_CONTEXT } from "@/lib/elections/cycleAnchorContext";
import { getUKRegionalCouncilCycle1EndTurn } from "@/lib/elections/ukRegionalCouncilStagger";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/discordWebhooks", () => ({
  sendCountryGameEventMultiple: vi.fn().mockResolvedValue(undefined),
  DISCORD_COLORS: {},
}));

const NOW = new Date("2026-04-01T00:00:00Z");
const OLD = new Date("2026-03-01T00:00:00Z"); // > 1 turn before NOW → not justResolvedInSameTurn

/**
 * Mock db where the "completed/resolved" election find returns `completed`
 * and every "active/upcoming" find returns `live` (default []). Dedup ($or)
 * finds return []. States find returns `states`.
 */
function makeMockDb(opts: {
  states: Array<Record<string, unknown>>;
  completed: Array<Partial<Election>>;
  live?: Array<Partial<Election>>;
  currentTurn: number;
}) {
  const { states, completed, live = [], currentTurn } = opts;
  const insertCalls: Omit<Election, "_id">[][] = [];
  const electionsCollection = {
    find: vi.fn().mockImplementation((filter: Record<string, unknown>) => {
      if (filter.$or) return { toArray: vi.fn().mockResolvedValue([]) };
      const statusIn = (filter.status as { $in?: string[] } | undefined)?.$in ?? [];
      const isCompleted = statusIn.includes("completed") || statusIn.includes("resolved");
      let rows = isCompleted ? completed : live;
      // Honor chamberClass narrowing (JP sangiin processes one class at a time).
      if (filter.chamberClass != null) {
        rows = rows.filter((e) => e.chamberClass === filter.chamberClass);
      }
      return { sort: vi.fn().mockReturnThis(), toArray: vi.fn().mockResolvedValue(rows) };
    }),
    insertMany: vi.fn().mockImplementation((docs: Omit<Election, "_id">[]) => {
      insertCalls.push(docs);
      return Promise.resolve({ insertedIds: {} });
    }),
    insertOne: vi.fn().mockImplementation((doc: Omit<Election, "_id">) => {
      insertCalls.push([doc]);
      return Promise.resolve({ insertedId: {} });
    }),
    findOne: vi.fn().mockResolvedValue(null),
  };
  const statesCollection = {
    find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(states) }),
    findOne: vi.fn().mockResolvedValue(null),
    bulkWrite: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
  };
  const gameStateCollection = { findOne: vi.fn().mockResolvedValue({ currentTurn }) };
  return { electionsCollection, statesCollection, gameStateCollection, insertCalls };
}

async function mount(mock: ReturnType<typeof makeMockDb>) {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue({
    collection: vi.fn().mockImplementation((name: string) => {
      if (name === "elections") return mock.electionsCollection;
      if (name === "states") return mock.statesCollection;
      if (name === "gameState") return mock.gameStateCollection;
      return { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) };
    }),
  } as never);
}

/** Canonical turns for cycle N under the default test ctx. */
function canon(electionType: string, cycle: number, extra: Record<string, unknown> = {}) {
  return canonicalTurnsForCycle({
    electionType,
    cycle,
    ctx: DEFAULT_CYCLE_ANCHOR_CONTEXT,
    ...extra,
  })!;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("next-cycle primaries open immediately (no 'Opens in X turns' dead zone)", () => {
  it("ensureIEElections spawns cycle 2 active with the primary open now", async () => {
    const exp1 = canon("dail", 1);
    const exp2 = canon("dail", 2);
    // currentTurn sits in the dead zone: after cycle 1 ended, before the
    // canonical cycle-2 startTurn.
    const currentTurn = exp2.startTurn - 30;

    const mock = makeMockDb({
      states: [{ _id: "DUB", houseDistricts: 64 }],
      completed: [
        { state: "DUB", electionType: "dail", cycle: 1, endTurn: exp1.endTurn, updatedAt: OLD },
      ],
      currentTurn,
    });
    await mount(mock);

    const { ensureIEElections } = await import("./perpetualElections");
    await ensureIEElections(NOW);

    const doc = mock.insertCalls.flat().find((d) => d.state === "DUB")!;
    expect(doc).toBeDefined();
    expect(doc.cycle).toBe(2);
    expect(doc.status).toBe("active");
    expect(doc.startTurn).toBe(currentTurn);
    expect(new Date(doc.startTime!).getTime()).toBe(NOW.getTime());
    // General still anchored to the canonical real-world year.
    expect(doc.primaryEndTurn).toBe(exp2.primaryEndTurn);
    expect(doc.endTurn).toBe(exp2.endTurn);
  });

  it("ensureUKElections spawns cycle 2 commons active with the primary open now", async () => {
    const exp1 = canon("commons", 1);
    const exp2 = canon("commons", 2);
    const currentTurn = exp2.startTurn - 30;

    const mock = makeMockDb({
      states: [{ _id: "LON" }],
      completed: [
        { state: "LON", electionType: "commons", cycle: 1, endTurn: exp1.endTurn, updatedAt: OLD },
      ],
      currentTurn,
    });
    await mount(mock);

    const { ensureUKElections } = await import("./perpetualElections");
    await ensureUKElections(NOW);

    const doc = mock.insertCalls.flat().find((d) => d.state === "LON")!;
    expect(doc).toBeDefined();
    expect(doc.cycle).toBe(2);
    expect(doc.status).toBe("active");
    expect(doc.startTurn).toBe(currentTurn);
    expect(new Date(doc.startTime!).getTime()).toBe(NOW.getTime());
    expect(doc.primaryEndTurn).toBe(exp2.primaryEndTurn);
    expect(doc.endTurn).toBe(exp2.endTurn);
  });

  it("ensureUKRegionalCouncilElections spawns the region's cohort cycle active now", async () => {
    const customCycle1EndTurn = getUKRegionalCouncilCycle1EndTurn(
      "LON",
      DEFAULT_CYCLE_ANCHOR_CONTEXT
    );
    const exp1 = canon("regionalCouncil", 1, { customCycle1EndTurn });
    const exp2 = canon("regionalCouncil", 2, { customCycle1EndTurn });
    const currentTurn = exp2.startTurn - 30;

    const mock = makeMockDb({
      states: [{ _id: "LON" }],
      completed: [
        {
          state: "LON",
          electionType: "regionalCouncil",
          cycle: 1,
          endTurn: exp1.endTurn,
          updatedAt: OLD,
        },
      ],
      currentTurn,
    });
    await mount(mock);

    const { ensureUKRegionalCouncilElections } = await import("./perpetualElections");
    await ensureUKRegionalCouncilElections(NOW);

    const doc = mock.insertCalls.flat().find((d) => d.state === "LON")!;
    expect(doc).toBeDefined();
    expect(doc.cycle).toBe(2);
    expect(doc.status).toBe("active");
    expect(doc.startTurn).toBe(currentTurn);
    expect(new Date(doc.startTime!).getTime()).toBe(NOW.getTime());
    expect(doc.primaryEndTurn).toBe(exp2.primaryEndTurn);
    expect(doc.endTurn).toBe(exp2.endTurn);
  });

  it("moves a synchronized transition cycle 0 into cohort cycle 1", async () => {
    const customCycle1EndTurn = getUKRegionalCouncilCycle1EndTurn(
      "SCO",
      DEFAULT_CYCLE_ANCHOR_CONTEXT
    );
    const exp1 = canon("regionalCouncil", 1, { customCycle1EndTurn });
    const currentTurn = exp1.startTurn + 10;
    const mock = makeMockDb({
      states: [{ _id: "SCO" }],
      completed: [
        {
          state: "SCO",
          electionType: "regionalCouncil",
          cycle: 0,
          endTurn: exp1.startTurn,
          updatedAt: OLD,
        },
      ],
      currentTurn,
    });
    await mount(mock);

    const { ensureUKRegionalCouncilElections } = await import("./perpetualElections");
    await ensureUKRegionalCouncilElections(NOW);

    const doc = mock.insertCalls.flat().find((d) => d.state === "SCO")!;
    expect(doc.cycle).toBe(1);
    expect(doc.status).toBe("active");
    expect(doc.endTurn).toBe(exp1.endTurn);
    expect(doc.electionYear).toBe(2025);
  });

  it("ensureJPCouncillorElections spawns cycle 2 sangiin active with the primary open now", async () => {
    const exp1 = canon("sangiin", 1, { chamberClass: 1 });
    const exp2 = canon("sangiin", 2, { chamberClass: 1 });
    const currentTurn = exp2.startTurn - 30;

    const mock = makeMockDb({
      states: [{ _id: "TKY" }],
      completed: [
        {
          state: "TKY",
          electionType: "sangiin",
          chamberClass: 1,
          cycle: 1,
          endTurn: exp1.endTurn,
          updatedAt: OLD,
        },
      ],
      currentTurn,
    });
    await mount(mock);

    const { ensureJPCouncillorElections } = await import("./perpetualElections");
    await ensureJPCouncillorElections(NOW, 1);

    const doc = mock.insertCalls.flat().find((d) => d.state === "TKY" && d.chamberClass === 1)!;
    expect(doc).toBeDefined();
    expect(doc.cycle).toBe(2);
    expect(doc.status).toBe("active");
    expect(doc.startTurn).toBe(currentTurn);
    expect(new Date(doc.startTime!).getTime()).toBe(NOW.getTime());
    expect(doc.primaryEndTurn).toBe(exp2.primaryEndTurn);
    expect(doc.endTurn).toBe(exp2.endTurn);
  });
});
