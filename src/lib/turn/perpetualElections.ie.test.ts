/**
 * Unit tests for Ireland Dáil Éireann perpetual election spawning.
 *
 * Guards that each per-region general election is spawned with the
 * constituency's full PR-STV magnitude (`state.houseDistricts`), not the
 * single-seat fallback that previously collapsed `/predict` and election
 * resolution to 1 seat per constituency (160-seat Dáil → 8).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Election } from "@/lib/db/types";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/discordWebhooks", () => ({
  sendCountryGameEventMultiple: vi.fn().mockResolvedValue(undefined),
  DISCORD_COLORS: {},
}));

// Canonical 1991 per-region Dáil magnitudes (sum 160).
const IE_REGION_SEATS: Record<string, number> = {
  DUB: 64,
  KIL: 13,
  MID: 10,
  WEX: 14,
  LIM: 11,
  COR: 18,
  GAL: 14,
  DON: 16,
};

describe("ensureIEElections", () => {
  function makeIEMockDb(
    states: Array<{ _id: string; houseDistricts?: number }>,
    currentTurn: number
  ) {
    const insertCalls: Omit<Election, "_id">[][] = [];
    const electionsCollection = {
      find: vi.fn().mockImplementation((filter: Record<string, unknown>) => {
        if (filter.$or) return { toArray: vi.fn().mockResolvedValue([]) };
        return { sort: vi.fn().mockReturnThis(), toArray: vi.fn().mockResolvedValue([]) };
      }),
      insertMany: vi.fn().mockImplementation((docs: Omit<Election, "_id">[]) => {
        insertCalls.push(docs);
        return Promise.resolve({ insertedIds: {} });
      }),
    };
    const statesCollection = {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(states) }),
    };
    const gameStateCollection = { findOne: vi.fn().mockResolvedValue({ currentTurn }) };
    return { electionsCollection, statesCollection, gameStateCollection, insertCalls };
  }

  async function mountIEDb(mock: ReturnType<typeof makeIEMockDb>) {
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

  it("spawns one Dáil election per region with the constituency's full seat magnitude", async () => {
    const now = new Date("2026-04-01T00:00:00Z");
    const states = Object.entries(IE_REGION_SEATS).map(([id, houseDistricts]) => ({
      _id: id,
      houseDistricts,
    }));
    const mock = makeIEMockDb(states, 1);
    await mountIEDb(mock);

    const { ensureIEElections } = await import("./perpetualElections");
    await ensureIEElections(now);

    const inserted = mock.insertCalls.flat();
    expect(inserted).toHaveLength(8);
    for (const doc of inserted) {
      expect(doc.countryId).toBe("IE");
      expect(doc.electionType).toBe("dail");
      // The bug spawned totalSeats: 1 for every constituency; assert full magnitude.
      expect(doc.totalSeats).toBe(IE_REGION_SEATS[doc.state!]);
    }
    expect(inserted.reduce((s, d) => s + (d.totalSeats ?? 0), 0)).toBe(160);
  });

  it("falls back to a single seat only when a region is missing houseDistricts", async () => {
    const now = new Date("2026-04-01T00:00:00Z");
    const mock = makeIEMockDb([{ _id: "DUB", houseDistricts: 64 }, { _id: "XXX" }], 1);
    await mountIEDb(mock);

    const { ensureIEElections } = await import("./perpetualElections");
    await ensureIEElections(now);

    const inserted = mock.insertCalls.flat();
    expect(inserted.find((d) => d.state === "DUB")?.totalSeats).toBe(64);
    expect(inserted.find((d) => d.state === "XXX")?.totalSeats).toBe(1);
  });
});
