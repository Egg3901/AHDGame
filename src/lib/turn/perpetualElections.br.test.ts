/**
 * Unit tests for Brazil Câmara dos Deputados perpetual election spawning.
 * Authored as a Phase-2 baseline BEFORE the ensureRegionalDelegateElections
 * migration so the refactor is verifiably behavior-preserving for BR.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Election } from "@/lib/db/types";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/discordWebhooks", () => ({
  sendCountryGameEventMultiple: vi.fn().mockResolvedValue(undefined),
  DISCORD_COLORS: {},
}));

const BR_REGIONS = ["NORTE", "NORDESTE", "CENTRO_OESTE", "SUDESTE", "SUL"];
// Real seed apportionment (src/lib/seeds/br/brRegions.ts) — sums to 81.
const BR_SENATE_SEATS_PER_REGION: Record<string, number> = {
  NORTE: 21,
  NORDESTE: 27,
  CENTRO_OESTE: 12,
  SUDESTE: 12,
  SUL: 9,
};

describe("ensureBRElections", () => {
  function makeBRMockDb(
    regions: string[],
    liveOrUpcoming: Election[],
    completed: Election[],
    currentTurn: number
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
      findOne: vi.fn().mockResolvedValue({ currentTurn }),
    };
    return { electionsCollection, statesCollection, gameStateCollection, insertCalls };
  }

  async function mountBRDb(mock: ReturnType<typeof makeBRMockDb>) {
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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("spawns one chamber election per BR region from empty DB", async () => {
    const now = new Date("2026-04-01T00:00:00Z");
    const mock = makeBRMockDb(BR_REGIONS, [], [], 1);
    await mountBRDb(mock);

    const { ensureBRElections } = await import("./perpetualElections");
    await ensureBRElections(now);

    const inserted = mock.insertCalls.flat();
    expect(inserted).toHaveLength(BR_REGIONS.length);
    for (const doc of inserted) {
      expect(doc.countryId).toBe("BR");
      expect(doc.electionType).toBe("chamber");
      expect(doc.totalSeats).toBe(1);
    }
    expect(inserted.map((d) => d.state).sort()).toEqual([...BR_REGIONS].sort());
  });

  it("does not duplicate active elections on second call", async () => {
    const now = new Date("2026-04-01T00:00:00Z");
    const currentTurn = 1;
    const dbState = { elections: [] as Election[] };

    const mockDb = {
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "states") {
          return {
            find: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue(BR_REGIONS.map((id) => ({ _id: id }))),
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
              if (filter.$or) {
                pool = dbState.elections.filter((e) =>
                  (filter.$or as Array<Record<string, unknown>>).some(
                    (cond) =>
                      cond.electionType === e.electionType &&
                      cond.state === e.state &&
                      ["active", "upcoming"].includes(e.status)
                  )
                );
              }
              return { sort: vi.fn().mockReturnThis(), toArray: vi.fn().mockResolvedValue(pool) };
            }),
            insertMany: vi.fn().mockImplementation((docs: Array<Omit<Election, "_id">>) => {
              for (const doc of docs) {
                dbState.elections.push({ _id: new ObjectId(), ...doc } as Election);
              }
              return Promise.resolve({ insertedIds: {} });
            }),
          };
        }
        return { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) };
      }),
    };

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(mockDb as never);

    const { ensureBRElections } = await import("./perpetualElections");
    await ensureBRElections(now);
    expect(dbState.elections).toHaveLength(BR_REGIONS.length);
    await ensureBRElections(now);
    expect(dbState.elections).toHaveLength(BR_REGIONS.length);
  });
});

/**
 * Regression coverage for Defect 2: Brazil's Federal Senate (81 seats, 27
 * states × 3) had NO spawner at all — it never held a single election. This
 * covers the new `ensureBRSenateElections`, which mirrors `ensureBRElections`
 * but sizes each macro-region's election from `stateSenateSeats` (21/27/12/12/9
 * — sums to 81, the real constitutional apportionment) instead of a flat 1.
 */
describe("ensureBRSenateElections", () => {
  function makeBRSenateMockDb(
    regions: Array<{ _id: string; stateSenateSeats: number }>,
    liveOrUpcoming: Election[],
    completed: Election[],
    currentTurn: number
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
        toArray: vi.fn().mockResolvedValue(regions),
      }),
    };
    const gameStateCollection = {
      findOne: vi.fn().mockResolvedValue({ currentTurn }),
    };
    return { electionsCollection, statesCollection, gameStateCollection, insertCalls };
  }

  async function mountBRSenateDb(mock: ReturnType<typeof makeBRSenateMockDb>) {
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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("spawns one Senate election per BR macro-region, sized by stateSenateSeats", async () => {
    const now = new Date("2026-04-01T00:00:00Z");
    const regions = BR_REGIONS.map((id) => ({
      _id: id,
      stateSenateSeats: BR_SENATE_SEATS_PER_REGION[id],
    }));
    const mock = makeBRSenateMockDb(regions, [], [], 1);
    await mountBRSenateDb(mock);

    const { ensureBRSenateElections } = await import("./perpetualElections");
    await ensureBRSenateElections(now);

    const inserted = mock.insertCalls.flat();
    expect(inserted).toHaveLength(BR_REGIONS.length);
    for (const doc of inserted) {
      expect(doc.countryId).toBe("BR");
      expect(doc.electionType).toBe("senate");
      expect(doc.totalSeats).toBe(BR_SENATE_SEATS_PER_REGION[doc.state]);
    }
    // Total apportioned seats across all regions must equal the real 81.
    expect(inserted.reduce((sum, d) => sum + (d.totalSeats ?? 0), 0)).toBe(81);
  });

  it("does not duplicate active Senate elections on second call", async () => {
    const now = new Date("2026-04-01T00:00:00Z");
    const currentTurn = 1;
    const regions = BR_REGIONS.map((id) => ({
      _id: id,
      stateSenateSeats: BR_SENATE_SEATS_PER_REGION[id],
    }));
    const dbState = { elections: [] as Election[] };

    const mockDb = {
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "states") {
          return { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(regions) }) };
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
              if (filter.$or) {
                pool = dbState.elections.filter((e) =>
                  (filter.$or as Array<Record<string, unknown>>).some(
                    (cond) =>
                      cond.electionType === e.electionType &&
                      cond.state === e.state &&
                      ["active", "upcoming"].includes(e.status)
                  )
                );
              }
              return { sort: vi.fn().mockReturnThis(), toArray: vi.fn().mockResolvedValue(pool) };
            }),
            insertMany: vi.fn().mockImplementation((docs: Array<Omit<Election, "_id">>) => {
              for (const doc of docs) {
                dbState.elections.push({ _id: new ObjectId(), ...doc } as Election);
              }
              return Promise.resolve({ insertedIds: {} });
            }),
          };
        }
        return { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) };
      }),
    };

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(mockDb as never);

    const { ensureBRSenateElections } = await import("./perpetualElections");
    await ensureBRSenateElections(now);
    expect(dbState.elections).toHaveLength(BR_REGIONS.length);
    await ensureBRSenateElections(now);
    expect(dbState.elections).toHaveLength(BR_REGIONS.length);
  });
});
