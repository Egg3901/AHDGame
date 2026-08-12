/**
 * Regression tests for US territorial governor races.
 *
 * `seedSeats` era-gates US seat creation on `getHouseSeats(preset)`, so a 1953
 * world has Alaska and Hawaii as territories. They have a territorial governor
 * but no federal or state-legislative representation until admission.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Election } from "@/lib/db/types";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/discordWebhooks", () => ({
  sendCountryGameEventMultiple: vi.fn().mockResolvedValue(undefined),
  DISCORD_COLORS: {},
}));

const NOW = new Date("2026-04-01T00:00:00Z");

/**
 * Minimal db: the US `states` roster contains WY plus the two pre-statehood
 * territories, no elections exist yet, and gameState carries the active preset.
 */
async function mountUsWorld(
  preset: string,
  opts: { stateDocs?: Array<Record<string, unknown>>; currentYear?: number } = {}
) {
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
      toArray: vi
        .fn()
        .mockResolvedValue(
          opts.stateDocs ?? [{ _id: "WY" }, { _id: "AK" }, { _id: "HI" }, { _id: "DC" }]
        ),
    }),
    findOne: vi.fn().mockResolvedValue(null),
    bulkWrite: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
  };
  const gameState = {
    findOne: vi.fn().mockResolvedValue({
      _id: "current",
      currentTurn: 1,
      preset,
      startingYear: 1953,
      ...(opts.currentYear !== undefined ? { currentYear: opts.currentYear } : {}),
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

  return inserted;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ensurePerpetualElections US era statehood gate", () => {
  it("spawns only territorial governor races for Alaska and Hawaii under the 1953 preset", async () => {
    const inserted = await mountUsWorld("1953-default");

    const { ensurePerpetualElections } = await import("./perpetualElections");
    await ensurePerpetualElections(NOW, 1);

    const usRaces = inserted.filter((e) => (e.countryId ?? "US") === "US");
    // Non-vacuous: WY is a 1953 state, so the spawner must have run for it.
    expect(usRaces.some((e) => e.state === "WY")).toBe(true);

    for (const territory of ["AK", "HI"]) {
      expect(usRaces.filter((e) => e.state === territory).map((e) => e.electionType)).toEqual([
        "governor",
      ]);
    }
    // DC is excluded by the pre-existing non-electoral-region gate.
    expect(usRaces.filter((e) => e.state === "DC")).toEqual([]);
  });

  it("still spawns Alaska and Hawaii races under a modern preset", async () => {
    // Guard against over-gating: the 2019 apportionment map contains AK and HI.
    const inserted = await mountUsWorld("2019-default");

    const { ensurePerpetualElections } = await import("./perpetualElections");
    await ensurePerpetualElections(NOW, 1);

    const usRaces = inserted.filter((e) => (e.countryId ?? "US") === "US");
    expect(usRaces.some((e) => e.state === "AK")).toBe(true);
    expect(usRaces.some((e) => e.state === "HI")).toBe(true);
  });

  it("spawns races for a territory admitted mid-game, in a 1953 world", async () => {
    // This is the whole mechanism by which an admitted state gets elections:
    // it joins this roster and the existing spawner does the rest, on the same
    // canonical calendar as every other state. Alaska was admitted in 1959 and
    // the world has reached 1962.
    const inserted = await mountUsWorld("1953-default", {
      stateDocs: [{ _id: "WY" }, { _id: "AK", admittedYear: 1959 }, { _id: "HI" }],
      currentYear: 1962,
    });

    const { ensurePerpetualElections } = await import("./perpetualElections");
    await ensurePerpetualElections(NOW, 1);

    const usRaces = inserted.filter((e) => (e.countryId ?? "US") === "US");
    const akTypes = new Set(usRaces.filter((e) => e.state === "AK").map((e) => e.electionType));
    expect(akTypes).toContain("house");
    expect(akTypes).toContain("senate");
    expect(akTypes).toContain("governor");
    expect(akTypes).toContain("stateSenate");
    // Hawaii was not admitted in this world and retains only its territorial governor.
    expect(usRaces.filter((e) => e.state === "HI").map((e) => e.electionType)).toEqual([
      "governor",
    ]);
  });

  it("does not spawn races before the admission year arrives", async () => {
    const inserted = await mountUsWorld("1953-default", {
      stateDocs: [{ _id: "WY" }, { _id: "AK", admittedYear: 1959 }],
      currentYear: 1955,
    });

    const { ensurePerpetualElections } = await import("./perpetualElections");
    await ensurePerpetualElections(NOW, 1);

    const usRaces = inserted.filter((e) => (e.countryId ?? "US") === "US");
    expect(usRaces.some((e) => e.state === "WY")).toBe(true);
    expect(usRaces.filter((e) => e.state === "AK").map((e) => e.electionType)).toEqual([
      "governor",
    ]);
  });
});
