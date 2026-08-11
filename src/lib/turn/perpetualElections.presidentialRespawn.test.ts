/**
 * Presidential-cycle respawn regression (found in sandbox ahd_sim_s1991-base-a):
 * in a 300-turn headless 1991-default sim the US 1992 president resolved at
 * t96 but NO 1996 race ever spawned. Root cause: `justResolvedInSameTurn` was
 * wall-clock based (`now − prev.updatedAt < 1 real hour`). Headless sims fire
 * turns seconds apart, so the guard stayed shut for hundreds of turns after
 * each resolution, permanently suppressing every ensure-based respawn
 * (president/senate/governor/JP/IE/CN/BR). Only the resolution-path respawns
 * (house/commons) kept cycling. On prod (1 turn = 1 real hour) the old and
 * new formulations agree.
 *
 * The guard is now TURN-based when the caller passes `currentTurn` and the
 * prior race carries `endTurn`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Election } from "@/lib/db/types";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

const MS = 3_600_000;

/** Mock DB: no states (isolates the national president path), one resolved US president. */
function mountWithResolvedPresident(
  prev: Partial<Election>,
  world: { currentTurn: number; startingYear: number; preset: string },
  insertedDocs: Omit<Election, "_id">[]
) {
  const electionsCollection = {
    find: vi.fn().mockImplementation((filter: Record<string, unknown>) => {
      if (filter.$or) return { toArray: vi.fn().mockResolvedValue([]) };
      const status = filter.status as { $in?: string[] } | undefined;
      if (status?.$in?.includes("active")) {
        return { sort: vi.fn().mockReturnThis(), toArray: vi.fn().mockResolvedValue([]) };
      }
      if (status?.$in?.includes("completed") || status?.$in?.includes("resolved")) {
        return {
          sort: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue([
            {
              _id: new ObjectId(),
              electionType: "president",
              countryId: "US",
              state: "US",
              status: "resolved",
              ...prev,
            } as Election,
          ]),
        };
      }
      return { sort: vi.fn().mockReturnThis(), toArray: vi.fn().mockResolvedValue([]) };
    }),
    insertMany: vi.fn().mockImplementation((docs: Omit<Election, "_id">[]) => {
      insertedDocs.push(...docs);
      return Promise.resolve({ insertedIds: {} });
    }),
  };
  const statesCollection = {
    find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    findOne: vi.fn().mockResolvedValue(null),
  };
  const gameStateCollection = { findOne: vi.fn().mockResolvedValue(world) };
  return { electionsCollection, statesCollection, gameStateCollection };
}

async function mountDb(mock: ReturnType<typeof mountWithResolvedPresident>) {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue({
    collection: vi.fn().mockImplementation((name: string) => {
      if (name === "elections") return mock.electionsCollection;
      if (name === "states") return mock.statesCollection;
      if (name === "gameState") return mock.gameStateCollection;
      return {
        find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
        findOne: vi.fn().mockResolvedValue(null),
      };
    }),
  } as never);
}

describe("justResolvedInSameTurn — turn-first semantics", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("is CLOSED on the resolving tick (currentTurn == endTurn)", async () => {
    const { justResolvedInSameTurn } = await import("./perpetualElections");
    const now = new Date("2026-04-01T00:00:00Z");
    const prev = { endTurn: 96, updatedAt: now } as Election;
    expect(justResolvedInSameTurn(prev, now, 96)).toBe(true);
  });

  it("OPENS one turn later even when almost no wall-clock time has passed (headless sim)", async () => {
    const { justResolvedInSameTurn } = await import("./perpetualElections");
    const resolvedAt = new Date("2026-04-01T00:00:00Z");
    const now = new Date(resolvedAt.getTime() + 8_000); // 8 wall-clock seconds later
    const prev = { endTurn: 96, updatedAt: resolvedAt } as Election;
    expect(justResolvedInSameTurn(prev, now, 97)).toBe(false);
  });

  it("OPENS when currentTurn still equals endTurn but resolution happened long ago (paused world / back-to-back canonical windows)", async () => {
    const { justResolvedInSameTurn } = await import("./perpetualElections");
    const resolvedAt = new Date("2026-04-01T00:00:00Z");
    const now = new Date(resolvedAt.getTime() + 5 * MS); // 5 real hours later
    const prev = { endTurn: 288, updatedAt: resolvedAt } as Election;
    expect(justResolvedInSameTurn(prev, now, 288)).toBe(false);
  });

  it("falls back to wall-clock when the prior doc has no endTurn (legacy)", async () => {
    const { justResolvedInSameTurn } = await import("./perpetualElections");
    const resolvedAt = new Date("2026-04-01T00:00:00Z");
    const prev = { updatedAt: resolvedAt } as Election;
    expect(justResolvedInSameTurn(prev, new Date(resolvedAt.getTime() + 8_000), 97)).toBe(true);
    expect(justResolvedInSameTurn(prev, new Date(resolvedAt.getTime() + MS), 97)).toBe(false);
  });

  it("falls back to wall-clock when currentTurn is not supplied (back-compat)", async () => {
    const { justResolvedInSameTurn } = await import("./perpetualElections");
    const resolvedAt = new Date("2026-04-01T00:00:00Z");
    const prev = { endTurn: 96, updatedAt: resolvedAt } as Election;
    expect(justResolvedInSameTurn(prev, new Date(resolvedAt.getTime() + 8_000))).toBe(true);
  });
});

describe("US presidential cycle respawn (1991-default headless-sim regression)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  const WORLD_1991 = { startingYear: 1991, preset: "1991-default" };

  it("resolving 1992 (cycle 1, t96) spawns the 1996 race (cycle 2, endTurn 288) one turn later — even seconds after resolution", async () => {
    const now = new Date("2026-04-01T00:00:10Z");
    const inserted: Omit<Election, "_id">[] = [];
    const mock = mountWithResolvedPresident(
      {
        cycle: 1,
        electionYear: 1992,
        startTurn: 1,
        primaryEndTurn: 48,
        endTurn: 96,
        // Resolved 10 wall-clock seconds ago — the old wall-clock guard
        // suppressed this respawn for the next ~450 headless turns.
        updatedAt: new Date("2026-04-01T00:00:00Z"),
      },
      { ...WORLD_1991, currentTurn: 97 },
      inserted
    );
    await mountDb(mock);

    const { ensurePerpetualElections } = await import("./perpetualElections");
    await ensurePerpetualElections(now, 97);

    const presidents = inserted.filter((d) => d.electionType === "president");
    expect(presidents).toHaveLength(1);
    expect(presidents[0].cycle).toBe(2);
    expect(presidents[0].endTurn).toBe(288); // end of 1996 in a 1991 world
    expect(presidents[0].electionYear).toBe(1996);
    expect(presidents[0].countryId).toBe("US");
  });

  it("does NOT respawn on the resolving tick itself (same-turn cascade guard still holds)", async () => {
    const now = new Date("2026-04-01T00:00:10Z");
    const inserted: Omit<Election, "_id">[] = [];
    const mock = mountWithResolvedPresident(
      { cycle: 1, endTurn: 96, updatedAt: now },
      { ...WORLD_1991, currentTurn: 96 },
      inserted
    );
    await mountDb(mock);

    const { ensurePerpetualElections } = await import("./perpetualElections");
    await ensurePerpetualElections(now, 96);

    expect(inserted.filter((d) => d.electionType === "president")).toHaveLength(0);
  });

  it("continues on 4-year cadence indefinitely — far beyond any enumerated real-election year", async () => {
    // Cycle 9 = 2024 in a 1991 world (endTurn 96 + 8×192 = 1632). The anchor
    // map only records the 1992 base year; later cycles extrapolate.
    const now = new Date("2026-04-01T00:00:10Z");
    const inserted: Omit<Election, "_id">[] = [];
    const mock = mountWithResolvedPresident(
      {
        cycle: 9,
        electionYear: 2024,
        endTurn: 1632,
        updatedAt: new Date("2026-04-01T00:00:00Z"),
      },
      { ...WORLD_1991, currentTurn: 1633 },
      inserted
    );
    await mountDb(mock);

    const { ensurePerpetualElections } = await import("./perpetualElections");
    await ensurePerpetualElections(now, 1633);

    const presidents = inserted.filter((d) => d.electionType === "president");
    expect(presidents).toHaveLength(1);
    expect(presidents[0].cycle).toBe(10);
    expect(presidents[0].endTurn).toBe(1824); // 1632 + 192
    expect(presidents[0].electionYear).toBe(2028);
  });
});
