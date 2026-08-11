/**
 * Query-count regression guard for ensurePerpetualElections (perf audit
 * 2026-08-03).
 *
 * The stateSenate spawn path used to issue a per-state `states.findOne` inside
 * the state loop — ~50 sequential round-trips every turn. The seat counts now
 * ride the single roster `find` at the top of the function. These tests pin
 * that shape: reintroducing a per-state lookup fails the count assertions, and
 * the seat-count assertion proves the batched projection actually feeds the
 * spawned elections (the guard is not vacuous).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Election } from "@/lib/db/types";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/discordWebhooks", () => ({
  sendCountryGameEventMultiple: vi.fn().mockResolvedValue(undefined),
  DISCORD_COLORS: {},
}));

const NOW = new Date("2026-04-01T00:00:00Z");

async function mountUsWorld(stateDocs: Array<Record<string, unknown>>) {
  const inserted: Omit<Election, "_id">[] = [];
  const elections = {
    find: vi.fn().mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    }),
    findOne: vi.fn().mockResolvedValue(null),
    insertMany: vi.fn().mockImplementation((docs: Omit<Election, "_id">[]) => {
      inserted.push(...docs);
      return Promise.resolve({ insertedIds: {} });
    }),
    insertOne: vi.fn().mockImplementation((doc: Omit<Election, "_id">) => {
      inserted.push(doc);
      return Promise.resolve({ insertedId: {} });
    }),
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    bulkWrite: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
  };
  const states = {
    find: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue(stateDocs),
    }),
    findOne: vi.fn().mockResolvedValue(null),
    bulkWrite: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
  };
  const gameState = {
    findOne: vi.fn().mockResolvedValue({
      _id: "current",
      currentTurn: 1,
      preset: "2019-default",
      startingYear: 2019,
    }),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
  };

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue({
    collection: vi.fn().mockImplementation((name: string) => {
      if (name === "elections") return elections;
      if (name === "states") return states;
      if (name === "gameState") return gameState;
      return {
        find: vi.fn().mockReturnValue({
          sort: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue([]),
        }),
        findOne: vi.fn().mockResolvedValue(null),
        insertMany: vi.fn().mockResolvedValue({ insertedIds: {} }),
        insertOne: vi.fn().mockResolvedValue({ insertedId: {} }),
        deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
        updateOne: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
        bulkWrite: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
      };
    }),
  } as never);

  return { inserted, states };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ensurePerpetualElections query batching", () => {
  it("never issues a per-state states.findOne and reads the roster once", async () => {
    const { inserted, states } = await mountUsWorld([
      { _id: "WY", stateSenateSeats: 30 },
      { _id: "CA", stateSenateSeats: 40 },
      { _id: "TX", stateSenateSeats: 31 },
    ]);

    const { ensurePerpetualElections } = await import("./perpetualElections");
    await ensurePerpetualElections(NOW, 1);

    // Non-vacuous: the bootstrap world must actually spawn stateSenate races,
    // which is the exact path that used to findOne per state.
    const stateSenate = inserted.filter((e) => e.electionType === "stateSenate");
    expect(stateSenate.length).toBeGreaterThan(0);

    expect(states.findOne).not.toHaveBeenCalled();
    // O(1) roster reads regardless of state count (the perpetual-spawn roster
    // plus the presidential path's read) — never O(states).
    expect(states.find.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("feeds batched stateSenateSeats into the spawned stateSenate races", async () => {
    const { inserted } = await mountUsWorld([
      { _id: "WY", stateSenateSeats: 30 },
      { _id: "CA", stateSenateSeats: 40 },
    ]);

    const { ensurePerpetualElections } = await import("./perpetualElections");
    await ensurePerpetualElections(NOW, 1);

    const wy = inserted.find((e) => e.electionType === "stateSenate" && e.state === "WY");
    const ca = inserted.find((e) => e.electionType === "stateSenate" && e.state === "CA");
    expect(wy?.totalSeats).toBe(30);
    expect(ca?.totalSeats).toBe(40);
  });

  it("falls back to 40 seats when the state doc carries no stateSenateSeats", async () => {
    const { inserted } = await mountUsWorld([{ _id: "WY" }]);

    const { ensurePerpetualElections } = await import("./perpetualElections");
    await ensurePerpetualElections(NOW, 1);

    const wy = inserted.find((e) => e.electionType === "stateSenate" && e.state === "WY");
    expect(wy?.totalSeats).toBe(40);
  });
});
