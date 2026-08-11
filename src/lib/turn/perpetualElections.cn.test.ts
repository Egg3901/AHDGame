/**
 * Unit tests for China NPC Delegate perpetual election spawning.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Election } from "@/lib/db/types";
import { CN_NPC_SEATS, CN_NPC_SEATS_1953 } from "@/lib/constants/states";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/discordWebhooks", () => ({
  sendCountryGameEventMultiple: vi.fn().mockResolvedValue(undefined),
  DISCORD_COLORS: {},
}));

describe("ensureCNElections", () => {
  const _MS = 3_600_000;

  function makeCNMockDb(
    regions: string[],
    liveOrUpcoming: Election[],
    completed: Election[],
    currentTurn: number,
    gameStateExtras: Record<string, unknown> = {}
  ) {
    const insertCalls: Omit<Election, "_id">[][] = [];
    const electionsCollection = {
      find: vi.fn().mockImplementation((filter: Record<string, unknown>) => {
        if (filter.$or) return { toArray: vi.fn().mockResolvedValue([]) };
        const status = (filter.status as { $in?: string[] }) ?? {};
        const isLive = status.$in?.includes("active") && status.$in?.includes("upcoming");
        const pool = isLive ? liveOrUpcoming : completed;
        return {
          sort: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue(pool),
        };
      }),
      insertMany: vi.fn().mockImplementation((docs: Omit<Election, "_id">[]) => {
        insertCalls.push(docs);
        return Promise.resolve({ insertedIds: {} });
      }),
    };
    const statesCollection = {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue(regions.map((id) => ({ _id: id }))),
      }),
    };
    const gameStateCollection = {
      findOne: vi.fn().mockResolvedValue({ currentTurn, ...gameStateExtras }),
    };
    return { electionsCollection, statesCollection, gameStateCollection, insertCalls };
  }

  async function mountCNDb(mock: ReturnType<typeof makeCNMockDb>) {
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "elections") return mock.electionsCollection;
        if (name === "states") return mock.statesCollection;
        if (name === "gameState") return mock.gameStateCollection;
        return {
          find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
        };
      }),
    } as never);
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("spawns exactly 7 npcDelegate elections from empty DB", async () => {
    const now = new Date("2026-04-01T00:00:00Z");
    const currentTurn = 1;
    const regions = ["DB", "HB", "HD", "HZ", "HN", "XN", "XB"];
    const mock = makeCNMockDb(regions, [], [], currentTurn);
    await mountCNDb(mock);

    const { ensureCNElections } = await import("./perpetualElections");
    await ensureCNElections(now);

    const inserted = mock.insertCalls.flat();
    expect(inserted).toHaveLength(7);
    for (const doc of inserted) {
      expect(doc.countryId).toBe("CN");
      expect(doc.electionType).toBe("npcDelegate");
      // Per-region NPC seat count, e.g. EAST=922 / NORTH=323 etc.
      expect(doc.totalSeats).toBe(CN_NPC_SEATS[doc.state!]);
    }
    expect(inserted.map((d) => d.state).sort()).toEqual(regions.sort());
  });

  it("sizes the 1953 race at the 1,226-deputy First NPC, not the modern 2,980 (#3779)", async () => {
    const now = new Date("2026-04-01T00:00:00Z");
    const regions = ["DB", "HB", "HD", "HZ", "HN", "XN", "XB"];
    const mock = makeCNMockDb(regions, [], [], 1, {
      preset: "1953-default",
      startingYear: 1953,
    });
    await mountCNDb(mock);

    const { ensureCNElections } = await import("./perpetualElections");
    await ensureCNElections(now);

    const inserted = mock.insertCalls.flat();
    expect(inserted).toHaveLength(7);
    for (const doc of inserted) {
      expect(doc.totalSeats).toBe(CN_NPC_SEATS_1953[doc.state!]);
    }
    expect(inserted.reduce((sum, d) => sum + (d.totalSeats ?? 0), 0)).toBe(1226);
  });

  it("does not duplicate active elections on second call", async () => {
    const now = new Date("2026-04-01T00:00:00Z");
    const currentTurn = 1;
    const regions = ["DB", "HB", "HD", "HZ", "HN", "XN", "XB"];

    // Use a mutable store so the mock DB reflects inserts on the second call
    const dbState = {
      elections: [] as Election[],
    };

    const mockDb = {
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "states") {
          return {
            find: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue(regions.map((id) => ({ _id: id }))),
            }),
          };
        }
        if (name === "gameState") {
          return { findOne: vi.fn().mockResolvedValue({ currentTurn }) };
        }
        if (name === "elections") {
          return {
            find: vi.fn().mockImplementation((filter: Record<string, unknown>) => {
              const status = (filter.status as { $in?: string[] }) ?? {};
              const isLive = status.$in?.includes("active") && status.$in?.includes("upcoming");

              let pool = isLive
                ? dbState.elections.filter((e) => ["active", "upcoming"].includes(e.status))
                : dbState.elections.filter((e) => ["completed", "resolved"].includes(e.status));

              // Handle $or duplicate guard
              if (filter.$or) {
                pool = dbState.elections.filter((e) =>
                  (filter.$or as Array<Record<string, unknown>>).some(
                    (cond: Record<string, unknown>) =>
                      cond.electionType === e.electionType &&
                      cond.state === e.state &&
                      ["active", "upcoming"].includes(e.status)
                  )
                );
              }

              return {
                sort: vi.fn().mockReturnThis(),
                toArray: vi.fn().mockResolvedValue(pool),
              };
            }),
            insertMany: vi.fn().mockImplementation((docs: Array<Omit<Election, "_id">>) => {
              for (const doc of docs) {
                dbState.elections.push({
                  _id: new ObjectId(),
                  ...doc,
                } as Election);
              }
              return Promise.resolve({ insertedIds: {} });
            }),
          };
        }
        return {
          find: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([]),
          }),
        };
      }),
    };

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(mockDb as never);

    const { ensureCNElections } = await import("./perpetualElections");

    // First call
    await ensureCNElections(now);
    expect(dbState.elections).toHaveLength(7);

    // Second call — should not add more
    await ensureCNElections(now);
    expect(dbState.elections).toHaveLength(7);
  });

  it("uses correct countryId and electionType for all spawned elections", async () => {
    const now = new Date("2026-04-01T00:00:00Z");
    const currentTurn = 1;
    const regions = ["DB", "HB"];
    const mock = makeCNMockDb(regions, [], [], currentTurn);
    await mountCNDb(mock);

    const { ensureCNElections } = await import("./perpetualElections");
    await ensureCNElections(now);

    const inserted = mock.insertCalls.flat();
    expect(inserted).toHaveLength(2);
    for (const doc of inserted) {
      expect(doc.countryId).toBe("CN");
      expect(doc.electionType).toBe("npcDelegate");
      expect(doc.totalSeats).toBe(CN_NPC_SEATS[doc.state!]);
    }
  });

  it("bakes electionYear=1993 (8th NPC) on spawn under 1991-default preset", async () => {
    const now = new Date("2026-04-01T00:00:00Z");
    const currentTurn = 1;
    const regions = ["HD"];

    const mockDb = {
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "states") {
          return {
            find: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue(regions.map((id) => ({ _id: id }))),
            }),
          };
        }
        if (name === "gameState") {
          return {
            findOne: vi
              .fn()
              .mockResolvedValue({ currentTurn, startingYear: 1991, preset: "1991-default" }),
          };
        }
        if (name === "elections") {
          const insertCalls: Omit<Election, "_id">[][] = [];
          return {
            find: vi.fn().mockImplementation((filter: Record<string, unknown>) => {
              if (filter.$or) return { toArray: vi.fn().mockResolvedValue([]) };
              return { sort: vi.fn().mockReturnThis(), toArray: vi.fn().mockResolvedValue([]) };
            }),
            insertMany: vi.fn().mockImplementation((docs: Omit<Election, "_id">[]) => {
              insertCalls.push(docs);
              (mockDb as unknown as { _insertCalls: typeof insertCalls })._insertCalls =
                insertCalls;
              return Promise.resolve({ insertedIds: {} });
            }),
          };
        }
        return { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) };
      }),
    } as never;

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(mockDb);

    const { ensureCNElections } = await import("./perpetualElections");
    await ensureCNElections(now);

    const insertCalls =
      (mockDb as unknown as { _insertCalls: Omit<Election, "_id">[][] })._insertCalls ?? [];
    const inserted = insertCalls.flat();
    expect(inserted).toHaveLength(1);
    expect(inserted[0].electionYear).toBe(1993);
  });

  it("bakes electionYear=2023 (14th NPC) on spawn under 2019-default preset", async () => {
    const now = new Date("2026-04-01T00:00:00Z");
    const currentTurn = 1;
    const regions = ["HD"];
    const mock = makeCNMockDb(regions, [], [], currentTurn);
    await mountCNDb(mock);

    const { ensureCNElections } = await import("./perpetualElections");
    await ensureCNElections(now);

    const inserted = mock.insertCalls.flat();
    expect(inserted).toHaveLength(1);
    expect(inserted[0].electionYear).toBe(2023);
  });
});
