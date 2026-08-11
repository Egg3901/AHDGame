/**
 * Unit tests for perpetual elections: timer advancement, presidential year, durations.
 * Verifies election sync logic and House timing (96h = 2 years).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Election } from "@/lib/db/types";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

describe("perpetualElections", () => {
  describe("DEFAULT_DURATIONS", () => {
    it("House is 96h (2 years), shorter than Senate (288h) and Governor (192h)", async () => {
      const { DEFAULT_DURATIONS } = await import("./perpetualElections");
      expect(DEFAULT_DURATIONS.house.durationHours).toBe(96);
      expect(DEFAULT_DURATIONS.house.primaryDurationHours).toBe(48);
      expect(DEFAULT_DURATIONS.senate.durationHours).toBe(288);
      expect(DEFAULT_DURATIONS.governor.durationHours).toBe(192);
      expect(DEFAULT_DURATIONS.president.durationHours).toBe(192);
      expect(DEFAULT_DURATIONS.president.primaryDurationHours).toBe(144);
    });

    it("House completes 3x per Senate cycle, 2x per Governor cycle", async () => {
      const { DEFAULT_DURATIONS } = await import("./perpetualElections");
      const houseTurns = DEFAULT_DURATIONS.house.durationHours;
      const senateTurns = DEFAULT_DURATIONS.senate.durationHours;
      const governorTurns = DEFAULT_DURATIONS.governor.durationHours;
      expect(senateTurns / houseTurns).toBe(3);
      expect(governorTurns / houseTurns).toBe(2);
    });
  });

  describe("justResolvedInSameTurn", () => {
    it("returns false when prev is undefined", async () => {
      const { justResolvedInSameTurn } = await import("./perpetualElections");
      expect(justResolvedInSameTurn(undefined, new Date())).toBe(false);
    });

    it("returns false when prev has no updatedAt", async () => {
      const { justResolvedInSameTurn } = await import("./perpetualElections");
      const prev = { cycle: 1 } as Election;
      expect(justResolvedInSameTurn(prev, new Date())).toBe(false);
    });

    it("returns true when prev.updatedAt is the same instant as now", async () => {
      const { justResolvedInSameTurn } = await import("./perpetualElections");
      const now = new Date("2026-04-21T00:00:00Z");
      const prev = { cycle: 1, updatedAt: now } as Election;
      expect(justResolvedInSameTurn(prev, now)).toBe(true);
    });

    it("returns true when prev resolved 30 seconds before now (same tick)", async () => {
      const { justResolvedInSameTurn } = await import("./perpetualElections");
      const now = new Date("2026-04-21T00:00:30Z");
      const prev = { cycle: 1, updatedAt: new Date("2026-04-21T00:00:00Z") } as Election;
      expect(justResolvedInSameTurn(prev, now)).toBe(true);
    });

    it("returns false when prev resolved one full turn ago", async () => {
      const { justResolvedInSameTurn } = await import("./perpetualElections");
      const now = new Date("2026-04-21T01:00:00Z");
      const prev = { cycle: 1, updatedAt: new Date("2026-04-21T00:00:00Z") } as Election;
      // Exactly 1 turn (3_600_000 ms) apart — not "same tick", must allow spawn
      expect(justResolvedInSameTurn(prev, now)).toBe(false);
    });

    it("returns false when prev resolved many turns ago", async () => {
      const { justResolvedInSameTurn } = await import("./perpetualElections");
      const now = new Date("2026-04-21T00:00:00Z");
      const prev = { cycle: 1, updatedAt: new Date("2026-04-11T00:00:00Z") } as Election;
      expect(justResolvedInSameTurn(prev, now)).toBe(false);
    });
  });

  describe("advanceElectionTimers", () => {
    const ONE_HOUR_MS = 3_600_000;
    let mockResolvePrimaries: (now: Date) => Promise<void>;
    let mockBulkWrite: ReturnType<typeof vi.fn>;
    let mockFind: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      vi.clearAllMocks();
      mockResolvePrimaries = vi.fn().mockResolvedValue(undefined) as unknown as (
        now: Date
      ) => Promise<void>;
      mockBulkWrite = vi.fn().mockResolvedValue({ modifiedCount: 1 });
      mockFind = vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      });

      const { getDb } = await import("@/lib/mongodb");
      vi.mocked(getDb).mockResolvedValue({
        collection: vi.fn().mockImplementation((name: string) => {
          if (name === "elections") {
            return { find: mockFind, bulkWrite: mockBulkWrite };
          }
          return {};
        }),
      } as never);
    });

    it("does not modify endTime/startTime/primaryEndTime (timers are absolute)", async () => {
      const now = new Date("2026-02-25T12:00:00Z");
      const base = now.getTime();
      const election: Election = {
        _id: new ObjectId(),
        electionType: "house",
        state: "CA",
        cycle: 1,
        status: "active",
        totalSeats: 52,
        startTime: new Date(base - 50 * ONE_HOUR_MS),
        primaryEndTime: new Date(base - 25 * ONE_HOUR_MS),
        endTime: new Date(base + 10 * ONE_HOUR_MS),
        durationHours: 96,
        primaryDurationHours: 24,
        createdAt: now,
        updatedAt: now,
      } as Election;

      mockFind.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([election]),
      });

      const { advanceElectionTimers } = await import("./perpetualElections");
      await advanceElectionTimers(now, 100, mockResolvePrimaries);

      expect(mockBulkWrite).toHaveBeenCalledTimes(1);
      const [ops] = mockBulkWrite.mock.calls[0];
      expect(ops).toHaveLength(1);
      const update = ops[0].updateOne.update.$set as Record<string, unknown>;
      // Timers are not modified; only status/updatedAt
      expect(update.startTime).toBeUndefined();
      expect(update.primaryEndTime).toBeUndefined();
      expect(update.endTime).toBeUndefined();
    });

    it("marks election completed when endTime <= now", async () => {
      const now = new Date("2026-02-25T12:00:00Z");
      const base = now.getTime();
      const election: Election = {
        _id: new ObjectId(),
        electionType: "house",
        state: "CA",
        cycle: 1,
        status: "active",
        startTime: new Date(base - 100 * ONE_HOUR_MS),
        primaryEndTime: new Date(base - 75 * ONE_HOUR_MS),
        endTime: new Date(base - 1 * ONE_HOUR_MS), // 1h in past → completed
        durationHours: 96,
        primaryDurationHours: 24,
        createdAt: now,
        updatedAt: now,
      } as Election;

      mockFind.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([election]),
      });

      const { advanceElectionTimers } = await import("./perpetualElections");
      await advanceElectionTimers(now, 100, mockResolvePrimaries);

      const [ops] = mockBulkWrite.mock.calls[0];
      const update = ops[0].updateOne.update.$set as Record<string, unknown>;
      expect(update.status).toBe("completed");
    });

    it("does not mark completed when endTime still in future after subtraction", async () => {
      const now = new Date("2026-02-25T12:00:00Z");
      const base = now.getTime();
      const election: Election = {
        _id: new ObjectId(),
        electionType: "house",
        state: "CA",
        cycle: 1,
        status: "active",
        startTime: new Date(base - 50 * ONE_HOUR_MS),
        primaryEndTime: new Date(base - 25 * ONE_HOUR_MS),
        endTime: new Date(base + 50 * ONE_HOUR_MS), // 50h in future
        durationHours: 96,
        primaryDurationHours: 24,
        createdAt: now,
        updatedAt: now,
      } as Election;

      mockFind.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([election]),
      });

      const { advanceElectionTimers } = await import("./perpetualElections");
      await advanceElectionTimers(now, 100, mockResolvePrimaries);

      const [ops] = mockBulkWrite.mock.calls[0];
      const update = ops[0].updateOne.update.$set as Record<string, unknown>;
      expect(update.status).toBeUndefined();
    });

    it("calls resolvePrimaries after advancing timers", async () => {
      mockFind.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      });

      const { advanceElectionTimers } = await import("./perpetualElections");
      const now = new Date();
      await advanceElectionTimers(now, 100, mockResolvePrimaries);

      expect(mockResolvePrimaries).toHaveBeenCalledTimes(1);
      expect(mockResolvePrimaries).toHaveBeenCalledWith(now);
    });

    it("House completes after exactly 96 turns (durationHours) when now advances 1h per turn", async () => {
      const { advanceElectionTimers, DEFAULT_DURATIONS } = await import("./perpetualElections");
      const houseDuration = DEFAULT_DURATIONS.house.durationHours;
      expect(houseDuration).toBe(96);

      const baseTime = new Date("2026-02-25T00:00:00Z").getTime();
      const endTime = baseTime + houseDuration * ONE_HOUR_MS; // Fixed at creation
      let status = "active";
      let completedOnTurn = 0;

      for (let turn = 1; turn <= houseDuration + 2; turn++) {
        const now = new Date(baseTime + turn * ONE_HOUR_MS);
        const election: Election = {
          _id: new ObjectId(),
          electionType: "house",
          state: "CA",
          cycle: 1,
          status: status as "active" | "upcoming" | "completed",
          endTime: new Date(endTime),
          durationHours: 96,
          createdAt: new Date(baseTime),
          updatedAt: new Date(baseTime),
        } as Election;

        mockFind.mockReturnValue({
          toArray: vi.fn().mockResolvedValue([election]),
        });

        await advanceElectionTimers(now, turn, mockResolvePrimaries);

        const [ops] = mockBulkWrite.mock.calls[mockBulkWrite.mock.calls.length - 1];
        const update = ops[0].updateOne.update.$set as Record<string, unknown>;
        status = (update.status as string) ?? status;
        if (status === "completed" && completedOnTurn === 0) completedOnTurn = turn;
      }

      expect(status).toBe("completed");
      expect(completedOnTurn).toBe(96);
    });

    it("turn-first: completes when currentTurn >= endTurn even if the endTime Date is far future", async () => {
      const now = new Date("2026-02-25T12:00:00Z");
      const election: Election = {
        _id: new ObjectId(),
        electionType: "house",
        state: "CA",
        cycle: 1,
        status: "active",
        // Dates point far into the future — the turn fields must win.
        startTime: new Date("2099-01-01T00:00:00Z"),
        primaryEndTime: new Date("2099-01-01T00:00:00Z"),
        endTime: new Date("2099-01-01T00:00:00Z"),
        startTurn: 100,
        primaryEndTurn: 120,
        endTurn: 148,
        durationHours: 96,
        createdAt: now,
        updatedAt: now,
      } as Election;

      mockFind.mockReturnValue({ toArray: vi.fn().mockResolvedValue([election]) });

      const { advanceElectionTimers } = await import("./perpetualElections");
      await advanceElectionTimers(now, 148, mockResolvePrimaries);

      const [ops] = mockBulkWrite.mock.calls[0];
      const update = ops[0].updateOne.update.$set as Record<string, unknown>;
      expect(update.status).toBe("completed");
    });

    it("turn-first: freezes — a held currentTurn never completes even when the endTime Date is long past (pause)", async () => {
      const election: Election = {
        _id: new ObjectId(),
        electionType: "house",
        state: "CA",
        cycle: 1,
        status: "active",
        // endTime years in the past — pure wall-clock would mark it completed.
        endTime: new Date("2020-01-01T00:00:00Z"),
        startTurn: 100,
        endTurn: 148,
        durationHours: 96,
        createdAt: new Date("2020-01-01T00:00:00Z"),
        updatedAt: new Date("2020-01-01T00:00:00Z"),
      } as Election;

      mockFind.mockReturnValue({ toArray: vi.fn().mockResolvedValue([election]) });

      const { advanceElectionTimers } = await import("./perpetualElections");
      // Turn held at 130 (< endTurn 148): the deadline is frozen — no completion,
      // even though effectiveNow is years past the endTime Date.
      await advanceElectionTimers(new Date("2030-01-01T00:00:00Z"), 130, mockResolvePrimaries);

      const [ops] = mockBulkWrite.mock.calls[0];
      const update = ops[0].updateOne.update.$set as Record<string, unknown>;
      expect(update.status).toBeUndefined();
    });
  });

  describe("ensurePerpetualElections — cleanupDuplicateElections", () => {
    it("keeps both JP Sangiin classes live in the same region (distinct chamberClass)", async () => {
      const now = new Date("2026-04-17T12:00:00Z");

      const sangiinClass1: Election = {
        _id: new ObjectId(),
        electionType: "sangiin",
        countryId: "JP",
        state: "KAN",
        chamberClass: 1,
        cycle: 2,
        status: "active",
        totalSeats: 40,
        startTime: new Date(now.getTime() - 1000),
        endTime: new Date(now.getTime() + 144 * 3_600_000),
        durationHours: 144,
        createdAt: new Date(now.getTime() - 60_000),
        updatedAt: now,
      } as Election;
      const sangiinClass2: Election = {
        _id: new ObjectId(),
        electionType: "sangiin",
        countryId: "JP",
        state: "KAN",
        chamberClass: 2,
        cycle: 1,
        status: "active",
        totalSeats: 40,
        startTime: new Date(now.getTime() - 2000),
        endTime: new Date(now.getTime() + 144 * 3_600_000),
        durationHours: 144,
        createdAt: new Date(now.getTime() - 120_000),
        updatedAt: now,
      } as Election;

      const mockElectionsCollection = {
        find: vi.fn().mockImplementation((filter: Record<string, unknown>) => {
          // Only the cleanupDuplicateElections query returns the live pair; everything else returns [].
          const status = filter?.status as { $in?: string[] } | undefined;
          const isLive =
            status?.$in?.includes("active") &&
            status?.$in?.includes("upcoming") &&
            !filter.electionType;
          return {
            sort: vi.fn().mockReturnThis(),
            toArray: vi.fn().mockResolvedValue(isLive ? [sangiinClass1, sangiinClass2] : []),
          };
        }),
        deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
        insertMany: vi.fn().mockResolvedValue({ insertedIds: {} }),
      };
      const mockStatesCollection = {
        find: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([]),
        }),
      };

      const { getDb } = await import("@/lib/mongodb");
      vi.mocked(getDb).mockResolvedValue({
        collection: vi.fn().mockImplementation((name: string) => {
          if (name === "elections") return mockElectionsCollection;
          if (name === "states") return mockStatesCollection;
          return {
            find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
            // gameState — needed by getCurrentTurnAndCtx for preset/startingYear lookup
            findOne: vi.fn().mockResolvedValue(null),
          };
        }),
      } as never);

      const { ensurePerpetualElections } = await import("./perpetualElections");
      await ensurePerpetualElections(now, 154);

      // deleteMany is called with $in containing election IDs only when cleanup prunes.
      const deletionCalls = mockElectionsCollection.deleteMany.mock.calls.filter((c) => {
        const filter = c[0] as { _id?: { $in?: unknown[] } };
        return Array.isArray(filter?._id?.$in) && filter._id!.$in!.length > 0;
      });
      expect(deletionCalls).toHaveLength(0);
    });
  });

  describe("ensurePerpetualElections — excludes non-electoral US regions (DC)", () => {
    it("spawns races for real states but never for DC (no House/Senate/Governor/stateSenate seats)", async () => {
      const now = new Date("2026-04-17T12:00:00Z");
      const insertedDocs: Omit<Election, "_id">[] = [];

      const electionsCollection = {
        find: vi.fn().mockImplementation((filter: Record<string, unknown>) => ({
          sort: vi.fn().mockReturnThis(),
          // Duplicate guard ($or), liveElections, and completedElections all
          // resolve empty so bootstrap spawns one race per electoral state.
          toArray: vi.fn().mockResolvedValue([]),
          _filter: filter,
        })),
        insertMany: vi.fn().mockImplementation((docs: Omit<Election, "_id">[]) => {
          insertedDocs.push(...docs);
          return Promise.resolve({ insertedIds: {} });
        }),
      };
      // states.find → both WY (real) and DC (federal district); states.findOne →
      // stateSenate seat lookup used by the stateSenate spawn path.
      const statesCollection = {
        find: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([{ _id: "WY" }, { _id: "DC" }]),
        }),
        findOne: vi.fn().mockResolvedValue({ stateSenateSeats: 30 }),
      };
      const gameStateCollection = { findOne: vi.fn().mockResolvedValue({ currentTurn: 1 }) };

      const { getDb } = await import("@/lib/mongodb");
      vi.mocked(getDb).mockResolvedValue({
        collection: vi.fn().mockImplementation((name: string) => {
          if (name === "elections") return electionsCollection;
          if (name === "states") return statesCollection;
          if (name === "gameState") return gameStateCollection;
          return {
            find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
            findOne: vi.fn().mockResolvedValue(null),
          };
        }),
      } as never);

      const { ensurePerpetualElections } = await import("./perpetualElections");
      await ensurePerpetualElections(now, 1);

      // Non-vacuous: real state WY must get races (proves generation ran).
      expect(insertedDocs.some((d) => d.state === "WY")).toBe(true);
      // The fix: DC must never be spawned for any race type.
      expect(insertedDocs.filter((d) => d.state === "DC")).toEqual([]);
    });
  });

  describe("ensurePerpetualElections — US president gate is country-scoped (ticket 926)", () => {
    // Regression: a concurrent-general country (NG) can hold its own active
    // `president` election. Before the fix the `livePresident` gate was not
    // scoped to US, so NG's live president made the gate read true and the US
    // presidential cycle was suppressed indefinitely (prod: no 2012 US race
    // spawned while NG held an active president).
    function mountWithLiveNGPresident(insertedDocs: Omit<Election, "_id">[]) {
      const electionsCollection = {
        find: vi.fn().mockImplementation((filter: Record<string, unknown>) => {
          // Duplicate guard ($or) → empty so the planned US president insert lands.
          if (filter.$or) return { toArray: vi.fn().mockResolvedValue([]) };
          const status = filter.status as { $in?: string[] } | undefined;
          // liveElections: only an ACTIVE NIGERIAN president is in flight.
          if (status?.$in?.includes("active")) {
            return {
              sort: vi.fn().mockReturnThis(),
              toArray: vi.fn().mockResolvedValue([
                {
                  _id: new ObjectId(),
                  electionType: "president",
                  countryId: "NG",
                  state: "NG",
                  status: "active",
                  cycle: 6,
                } as Election,
              ]),
            };
          }
          // completedElections: the most recent US president (cycle 5) is resolved.
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
                  cycle: 5,
                  updatedAt: new Date("2026-01-01T00:00:00Z"),
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
      // No states → isolate the national president path from per-state races.
      const statesCollection = {
        find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
        findOne: vi.fn().mockResolvedValue(null),
      };
      // 1991-default at turn 972: the cycle-6 (2012) president window is open.
      const gameStateCollection = {
        findOne: vi
          .fn()
          .mockResolvedValue({ currentTurn: 972, startingYear: 1991, preset: "1991-default" }),
      };
      return { electionsCollection, statesCollection, gameStateCollection };
    }

    it("spawns the US president even while NG holds an active president", async () => {
      const now = new Date("2026-07-09T12:00:00Z");
      const insertedDocs: Omit<Election, "_id">[] = [];
      const { electionsCollection, statesCollection, gameStateCollection } =
        mountWithLiveNGPresident(insertedDocs);

      const { getDb } = await import("@/lib/mongodb");
      vi.mocked(getDb).mockResolvedValue({
        collection: vi.fn().mockImplementation((name: string) => {
          if (name === "elections") return electionsCollection;
          if (name === "states") return statesCollection;
          if (name === "gameState") return gameStateCollection;
          return {
            find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
            findOne: vi.fn().mockResolvedValue(null),
          };
        }),
      } as never);

      const { ensurePerpetualElections } = await import("./perpetualElections");
      await ensurePerpetualElections(now, 972);

      const usPresident = insertedDocs.filter(
        (d) => d.electionType === "president" && (d.countryId ?? "US") === "US"
      );
      expect(usPresident.length).toBe(1);
      expect(usPresident[0].state).toBe("US");
    });
  });

  describe("ensureJPCouncillorElections — canonical LARP scheduling", () => {
    const MS = 3_600_000;

    function makeMockDb(
      jpRegions: string[],
      liveSangiin: Election[],
      completedSangiin: Election[],
      currentTurn: number
    ) {
      const insertCalls: Omit<Election, "_id">[][] = [];
      const electionsCollection = {
        find: vi.fn().mockImplementation((filter: Record<string, unknown>) => {
          // Duplicate-guard query uses $or — return empty so planned inserts go through.
          if (filter.$or) return { toArray: vi.fn().mockResolvedValue([]) };
          if (filter.electionType === "sangiin" && filter.status) {
            const status = filter.status as { $in?: string[] };
            const matches = (e: Election) => {
              const classMatch = !filter.chamberClass || e.chamberClass === filter.chamberClass;
              return status.$in?.includes(e.status) && classMatch;
            };
            const pool = status.$in?.includes("active")
              ? liveSangiin.filter(matches)
              : completedSangiin.filter(matches);
            return {
              sort: vi.fn().mockReturnThis(),
              toArray: vi.fn().mockResolvedValue(pool),
            };
          }
          return { sort: vi.fn().mockReturnThis(), toArray: vi.fn().mockResolvedValue([]) };
        }),
        insertMany: vi.fn().mockImplementation((docs: Omit<Election, "_id">[]) => {
          insertCalls.push(docs);
          return Promise.resolve({ insertedIds: {} });
        }),
      };
      const statesCollection = {
        find: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue(jpRegions.map((id) => ({ _id: id }))),
        }),
      };
      const gameStateCollection = {
        findOne: vi.fn().mockResolvedValue({ currentTurn }),
      };
      return { electionsCollection, statesCollection, gameStateCollection, insertCalls };
    }

    function mountDb(
      electionsCollection: ReturnType<typeof makeMockDb>["electionsCollection"],
      statesCollection: ReturnType<typeof makeMockDb>["statesCollection"],
      gameStateCollection: ReturnType<typeof makeMockDb>["gameStateCollection"]
    ) {
      return async () => {
        const { getDb } = await import("@/lib/mongodb");
        vi.mocked(getDb).mockResolvedValue({
          collection: vi.fn().mockImplementation((name: string) => {
            if (name === "elections") return electionsCollection;
            if (name === "states") return statesCollection;
            if (name === "gameState") return gameStateCollection;
            return {
              find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
            };
          }),
        } as never);
      };
    }

    it("does NOT spawn a new cycle in the same tick an admin-shortened prior cycle resolved (gate fires)", async () => {
      // Same-tick respawn guard: prev.updatedAt === now means cycle 2 resolved
      // in this very processing run. ensureJPCouncillorElections must skip and
      // retry next turn so a cascade doesn't produce back-to-back races.
      const currentTurn = 242;
      const now = new Date("2026-04-21T03:00:00Z");

      const resolved: Election = {
        _id: new ObjectId(),
        electionType: "sangiin",
        countryId: "JP",
        state: "KAN",
        chamberClass: 1,
        cycle: 2,
        status: "resolved",
        totalSeats: 40,
        endTime: now,
        durationHours: 55, // admin-shortened
        createdAt: new Date(now.getTime() - 55 * MS),
        updatedAt: now,
      } as Election;

      const mock = makeMockDb(["KAN"], [], [resolved], currentTurn);
      await mountDb(mock.electionsCollection, mock.statesCollection, mock.gameStateCollection)();

      const { ensureJPCouncillorElections } = await import("./perpetualElections");
      await ensureJPCouncillorElections(now, 1);

      expect(mock.insertCalls.flat()).toHaveLength(0);
    });

    it("spawns the next Sangiin cycle active-now with canonical LARP end-turn preserved one turn after the admin-shortened prior cycle resolved", async () => {
      // One turn after cycle 2's resolution the gate no longer fires. Canonical
      // LARP anchors cycle 3 to endTurn=747 — admin shortening does not drag the
      // calendar forward. The primary opens immediately (active now) rather than
      // waiting for the canonical startTurn (603).
      const currentTurn = 291;
      const now = new Date("2026-04-21T04:00:00Z");

      const resolved: Election = {
        _id: new ObjectId(),
        electionType: "sangiin",
        countryId: "JP",
        state: "KAN",
        chamberClass: 1,
        cycle: 2,
        status: "resolved",
        totalSeats: 40,
        endTime: new Date(now.getTime() - MS),
        durationHours: 55, // admin-shortened
        createdAt: new Date(now.getTime() - 56 * MS),
        updatedAt: new Date(now.getTime() - MS), // resolved one turn ago
      } as Election;

      const mock = makeMockDb(["KAN"], [], [resolved], currentTurn);
      await mountDb(mock.electionsCollection, mock.statesCollection, mock.gameStateCollection)();

      const { ensureJPCouncillorElections } = await import("./perpetualElections");
      await ensureJPCouncillorElections(now, 1);

      const inserted = mock.insertCalls.flat();
      expect(inserted).toHaveLength(1);
      expect(inserted[0].chamberClass).toBe(1);
      expect(inserted[0].cycle).toBe(3);
      // Primary opens immediately (active now), not at the canonical startTurn.
      expect(inserted[0].status).toBe("active");
      expect(inserted[0].startTurn).toBe(currentTurn);
      expect(new Date(inserted[0].startTime!).getTime()).toBe(now.getTime());
      // Canonical LARP end-turn (747) preserved — calendar not dragged.
      expect(inserted[0].endTurn).toBe(747);
      expect(new Date(inserted[0].endTime!).getTime()).toBe(
        now.getTime() + (747 - currentTurn) * MS
      );
      expect(inserted[0].durationHours).toBe(144);
    });

    it("spawns 'active' when currentTurn is inside the canonical active window with ≥24h primary remaining", async () => {
      // Canonical Class 1 cycle 2: startTurn=315, primaryEndTurn=387, endTurn=459.
      // currentTurn=348 → remainingPrimary = 39h ≥ 24h, general = 72h ≥ 24h. Spawn.
      const currentTurn = 348;
      const now = new Date("2026-03-01T00:00:00Z");

      const resolved: Election = {
        _id: new ObjectId(),
        electionType: "sangiin",
        countryId: "JP",
        state: "KAN",
        chamberClass: 1,
        cycle: 1,
        status: "resolved",
        totalSeats: 40,
        endTime: new Date(now.getTime() - 177 * MS),
        durationHours: 144,
        createdAt: new Date(now.getTime() - 300 * MS),
        updatedAt: new Date(now.getTime() - 177 * MS),
      } as Election;

      const mock = makeMockDb(["KAN"], [], [resolved], currentTurn);
      await mountDb(mock.electionsCollection, mock.statesCollection, mock.gameStateCollection)();

      const { ensureJPCouncillorElections } = await import("./perpetualElections");
      await ensureJPCouncillorElections(now, 1);

      const inserted = mock.insertCalls.flat();
      expect(inserted).toHaveLength(1);
      expect(inserted[0].cycle).toBe(2);
      expect(inserted[0].status).toBe("active");
      // Primary opens at currentTurn/now (not retroactively at the canonical
      // startTurn 315) so the registration window starts the moment it spawns.
      expect(inserted[0].startTurn).toBe(currentTurn);
      expect(new Date(inserted[0].startTime!).getTime()).toBe(now.getTime());
      // primaryEnd / end stay canonical so the general lands on its LARP year.
      expect(new Date(inserted[0].primaryEndTime!).getTime()).toBe(
        now.getTime() + (387 - currentTurn) * MS
      );
      expect(new Date(inserted[0].endTime!).getTime()).toBe(
        now.getTime() + (459 - currentTurn) * MS
      );
    });

    it("skips a canonical cycle when <24h of primary would remain, advancing to the next half-election", async () => {
      // Canonical Class 1 cycle 2: primaryEndTurn=387. currentTurn=368 ⇒ remainingPrimary = 19h.
      // Gate should skip cycle 2 and spawn cycle 3 (endTurn=747) instead.
      const currentTurn = 368;
      const now = new Date("2026-03-15T00:00:00Z");

      const resolved: Election = {
        _id: new ObjectId(),
        electionType: "sangiin",
        countryId: "JP",
        state: "KAN",
        chamberClass: 1,
        cycle: 1,
        status: "resolved",
        totalSeats: 40,
        endTime: new Date(now.getTime() - 197 * MS),
        durationHours: 144,
        createdAt: new Date(now.getTime() - 400 * MS),
        updatedAt: new Date(now.getTime() - 197 * MS),
      } as Election;

      const mock = makeMockDb(["KAN"], [], [resolved], currentTurn);
      await mountDb(mock.electionsCollection, mock.statesCollection, mock.gameStateCollection)();

      const { ensureJPCouncillorElections } = await import("./perpetualElections");
      await ensureJPCouncillorElections(now, 1);

      const inserted = mock.insertCalls.flat();
      expect(inserted).toHaveLength(1);
      expect(inserted[0].cycle).toBe(3); // cycle 2 skipped by the 24h gate
      expect(new Date(inserted[0].endTime!).getTime()).toBe(
        now.getTime() + (747 - currentTurn) * MS
      );
    });

    it("skips a canonical cycle when <24h of general would remain, advancing to the next half-election", async () => {
      // currentTurn places us deep in cycle 2's general window: endTurn=459, currentTurn=438
      // ⇒ general remaining = 21h. Skip to cycle 3.
      const currentTurn = 438;
      const now = new Date("2026-03-15T00:00:00Z");

      const resolved: Election = {
        _id: new ObjectId(),
        electionType: "sangiin",
        countryId: "JP",
        state: "KAN",
        chamberClass: 1,
        cycle: 1,
        status: "resolved",
        totalSeats: 40,
        endTime: new Date(now.getTime() - 267 * MS),
        durationHours: 144,
        createdAt: new Date(now.getTime() - 500 * MS),
        updatedAt: new Date(now.getTime() - 267 * MS),
      } as Election;

      const mock = makeMockDb(["KAN"], [], [resolved], currentTurn);
      await mountDb(mock.electionsCollection, mock.statesCollection, mock.gameStateCollection)();

      const { ensureJPCouncillorElections } = await import("./perpetualElections");
      await ensureJPCouncillorElections(now, 1);

      const inserted = mock.insertCalls.flat();
      expect(inserted).toHaveLength(1);
      expect(inserted[0].cycle).toBe(3);
    });
  });

  describe("ensureUKElections — canonical LARP + snap shift", () => {
    const MS = 3_600_000;

    function makeUKMockDb(
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
      const gameStateCollection = { findOne: vi.fn().mockResolvedValue({ currentTurn }) };
      return { electionsCollection, statesCollection, gameStateCollection, insertCalls };
    }

    async function mountUKDb(mock: ReturnType<typeof makeUKMockDb>) {
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

    it("suppresses new commons while snap_commons is active for that region", async () => {
      const now = new Date("2026-04-01T00:00:00Z");
      const currentTurn = 300;
      const liveSnap: Election = {
        _id: new ObjectId(),
        countryId: "UK",
        electionType: "snap_commons",
        state: "ENG",
        cycle: 3,
        status: "active",
        startTime: new Date(now.getTime() - 12 * MS),
        endTime: new Date(now.getTime() + 36 * MS),
        durationHours: 48,
        createdAt: now,
        updatedAt: now,
      } as Election;

      const mock = makeUKMockDb(["ENG"], [liveSnap], [], currentTurn);
      await mountUKDb(mock);

      const { ensureUKElections } = await import("./perpetualElections");
      await ensureUKElections(now);
      expect(mock.insertCalls.flat()).toHaveLength(0);
    });

    it("spawns the next regular commons active-now with snap.endTurn + 240 end anchor right after snap resolves", async () => {
      // Snap cycle 3 ended at LARP turn 348 (= currentTurn − 1, i.e. it just closed).
      // Canonical post-snap cycle 4 endTurn = 348 + 240 = 588. The primary opens
      // immediately (active now) rather than waiting for the canonical startTurn (540).
      const currentTurn = 349;
      const now = new Date("2026-04-01T00:00:00Z");
      const snapEnd = new Date(now.getTime() - 1 * MS); // turn 348 wallclock

      const resolved: Election = {
        _id: new ObjectId(),
        countryId: "UK",
        electionType: "snap_commons",
        state: "ENG",
        cycle: 3,
        status: "resolved",
        endTime: snapEnd,
        durationHours: 48,
        updatedAt: snapEnd,
      } as Election;

      const mock = makeUKMockDb(["ENG"], [], [resolved], currentTurn);
      await mountUKDb(mock);

      const { ensureUKElections } = await import("./perpetualElections");
      await ensureUKElections(now);

      const inserted = mock.insertCalls.flat();
      expect(inserted).toHaveLength(1);
      expect(inserted[0].electionType).toBe("commons");
      expect(inserted[0].cycle).toBe(4);
      // Primary opens immediately (active now), not at the canonical startTurn.
      expect(inserted[0].status).toBe("active");
      expect(inserted[0].startTurn).toBe(currentTurn);
      expect(inserted[0].durationHours).toBe(48);
      // endTurn = snap.endTurn (348) + 240 = 588 — snap-shift anchor preserved.
      expect(inserted[0].endTurn).toBe(588);
      expect(new Date(inserted[0].endTime!).getTime()).toBe(
        now.getTime() + (588 - currentTurn) * MS
      );
    });

    it("does NOT let an admin-accelerated regular commons drag the LARP calendar — cycle formula preserves canonical anchor", async () => {
      // Admin accelerated cycle 1 to resolve early at turn 100 (canonical was 267).
      // Canonical cycle 2 must still end at 267 + 240 = 507 regardless of the admin edit.
      const currentTurn = 101;
      const now = new Date("2026-04-01T00:00:00Z");
      const acceleratedEnd = new Date(now.getTime() - 1 * MS); // turn 100 wallclock

      const resolved: Election = {
        _id: new ObjectId(),
        countryId: "UK",
        electionType: "commons",
        state: "ENG",
        cycle: 1,
        status: "resolved",
        endTime: acceleratedEnd,
        durationHours: 10, // admin-shortened
        updatedAt: acceleratedEnd,
      } as Election;

      const mock = makeUKMockDb(["ENG"], [], [resolved], currentTurn);
      await mountUKDb(mock);

      const { ensureUKElections } = await import("./perpetualElections");
      await ensureUKElections(now);

      const inserted = mock.insertCalls.flat();
      expect(inserted).toHaveLength(1);
      expect(inserted[0].cycle).toBe(2);
      // Primary opens immediately (active now); the calendar invariant is the endTurn.
      expect(inserted[0].status).toBe("active");
      expect(inserted[0].startTurn).toBe(currentTurn);
      // Canonical cycle 2 endTurn = 267 + 240 = 507, ignoring admin acceleration
      expect(inserted[0].endTurn).toBe(507);
      expect(new Date(inserted[0].endTime!).getTime()).toBe(
        now.getTime() + (507 - currentTurn) * MS
      );
      expect(inserted[0].durationHours).toBe(48);
    });
  });

  describe("ensureJPElections — canonical LARP + snap shift", () => {
    const MS = 3_600_000;

    function makeJPMockDb(
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
      const gameStateCollection = { findOne: vi.fn().mockResolvedValue({ currentTurn }) };
      return { electionsCollection, statesCollection, gameStateCollection, insertCalls };
    }

    async function mountJPDb(mock: ReturnType<typeof makeJPMockDb>) {
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

    it("does not spawn regular shugiin while snap_shugiin is active", async () => {
      const now = new Date("2026-04-01T00:00:00Z");
      const currentTurn = 300;
      const liveSnap: Election = {
        _id: new ObjectId(),
        countryId: "JP",
        electionType: "snap_shugiin",
        state: "tokyo",
        cycle: 2,
        status: "active",
        startTime: new Date(now.getTime() - 12 * MS),
        endTime: new Date(now.getTime() + 36 * MS),
        durationHours: 48,
        updatedAt: now,
      } as Election;

      const mock = makeJPMockDb(["tokyo"], [liveSnap], [], currentTurn);
      await mountJPDb(mock);

      const { ensureJPElections } = await import("./perpetualElections");
      await ensureJPElections(now);
      expect(mock.insertCalls.flat()).toHaveLength(0);
    });

    it("spawns the next regular shugiin 'upcoming' with snap.endTurn + 192 anchor right after snap resolves", async () => {
      // Snap cycle 2 ended at LARP turn 299 (one turn before currentTurn).
      // Canonical post-snap cycle 3 endTurn = 299 + 192 = 491. startTurn = 491 − 192 = 299.
      // At currentTurn=300, startTurn is in the past (299) so status=active.
      const currentTurn = 300;
      const now = new Date("2026-04-01T00:00:00Z");
      const snapEnd = new Date(now.getTime() - 1 * MS); // turn 299 wallclock

      const resolved: Election = {
        _id: new ObjectId(),
        countryId: "JP",
        electionType: "snap_shugiin",
        state: "tokyo",
        cycle: 2,
        status: "resolved",
        endTime: snapEnd,
        durationHours: 48,
        updatedAt: snapEnd,
      } as Election;

      const mock = makeJPMockDb(["tokyo"], [], [resolved], currentTurn);
      await mountJPDb(mock);

      const { ensureJPElections } = await import("./perpetualElections");
      await ensureJPElections(now);

      const inserted = mock.insertCalls.flat();
      expect(inserted).toHaveLength(1);
      expect(inserted[0].electionType).toBe("shugiin");
      expect(inserted[0].cycle).toBe(3);
      expect(inserted[0].durationHours).toBe(192); // regular 4-yr, NOT snap's 48h
      // endTurn = snap.endTurn (299) + 192 = 491
      expect(new Date(inserted[0].endTime!).getTime()).toBe(
        now.getTime() + (491 - currentTurn) * MS
      );
    });

    it("does NOT let an admin-accelerated regular shugiin drag the LARP calendar", async () => {
      // Admin accelerated cycle 1 shugiin to resolve at turn 100 (canonical was 288).
      // Cycle 2 must still end at canonical 288 + 192 = 480.
      const currentTurn = 101;
      const now = new Date("2026-04-01T00:00:00Z");
      const acceleratedEnd = new Date(now.getTime() - 1 * MS); // turn 100 wallclock

      const resolved: Election = {
        _id: new ObjectId(),
        countryId: "JP",
        electionType: "shugiin",
        state: "tokyo",
        cycle: 1,
        status: "resolved",
        endTime: acceleratedEnd,
        durationHours: 15,
        updatedAt: acceleratedEnd,
      } as Election;

      const mock = makeJPMockDb(["tokyo"], [], [resolved], currentTurn);
      await mountJPDb(mock);

      const { ensureJPElections } = await import("./perpetualElections");
      await ensureJPElections(now);

      const inserted = mock.insertCalls.flat();
      expect(inserted).toHaveLength(1);
      expect(inserted[0].cycle).toBe(2);
      expect(inserted[0].status).toBe("upcoming");
      expect(new Date(inserted[0].endTime!).getTime()).toBe(
        now.getTime() + (480 - currentTurn) * MS
      );
      expect(inserted[0].durationHours).toBe(192);
    });
  });

  describe("ensureCNElections — canonical LARP scheduling", () => {
    const MS = 3_600_000;

    function makeCNMockDb(
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
      const gameStateCollection = { findOne: vi.fn().mockResolvedValue({ currentTurn }) };
      return { electionsCollection, statesCollection, gameStateCollection, insertCalls };
    }

    async function mountCNDb(mock: ReturnType<typeof makeCNMockDb>) {
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

    it("spawns exactly 7 regional NPC Delegate elections from empty DB", async () => {
      const currentTurn = 1;
      const now = new Date("2026-04-01T00:00:00Z");
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
        expect(doc.status).toBe("active"); // cycle 1 starts at turn 1
        expect(doc.durationHours).toBe(48);
        expect(doc.primaryDurationHours).toBe(24);
      }
      const statesSet = new Set(inserted.map((d) => d.state));
      expect(statesSet.size).toBe(7);
    });

    it("does not duplicate active elections", async () => {
      const currentTurn = 100;
      const now = new Date("2026-04-01T00:00:00Z");
      const regions = ["DB", "HB", "HD", "HZ", "HN", "XN", "XB"];
      const live: Election = {
        _id: new ObjectId(),
        countryId: "CN",
        electionType: "npcDelegate",
        state: "HD",
        cycle: 1,
        status: "active",
        startTime: new Date(now.getTime() - 10 * MS),
        endTime: new Date(now.getTime() + 140 * MS),
        durationHours: 48,
        updatedAt: now,
      } as Election;

      const mock = makeCNMockDb(regions, [live], [], currentTurn);
      await mountCNDb(mock);

      const { ensureCNElections } = await import("./perpetualElections");
      await ensureCNElections(now);

      const inserted = mock.insertCalls.flat();
      // EAST is suppressed; other 6 regions spawn
      expect(inserted).toHaveLength(6);
      expect(inserted.some((d) => d.state === "HD")).toBe(false);
    });

    it("spawns cycle 2 active-now (primary opens immediately) when cycle 1 is resolved", async () => {
      // Canonical cycle 1 endTurn = 240, cycle 2 endTurn = 240 + 240 = 480.
      const currentTurn = 241;
      const now = new Date("2026-04-01T00:00:00Z");
      const regions = ["DB"];

      const resolved: Election = {
        _id: new ObjectId(),
        countryId: "CN",
        electionType: "npcDelegate",
        state: "DB",
        cycle: 1,
        status: "resolved",
        endTime: new Date(now.getTime() - 1 * MS), // resolved at turn 240
        durationHours: 48,
        updatedAt: new Date(now.getTime() - 1 * MS),
      } as Election;

      const mock = makeCNMockDb(regions, [], [resolved], currentTurn);
      await mountCNDb(mock);

      const { ensureCNElections } = await import("./perpetualElections");
      await ensureCNElections(now);

      const inserted = mock.insertCalls.flat();
      expect(inserted).toHaveLength(1);
      expect(inserted[0].cycle).toBe(2);
      // Primary opens immediately at currentTurn (was the canonical startTurn 432).
      expect(inserted[0].status).toBe("active");
      expect(inserted[0].startTurn).toBe(currentTurn);
      // endTurn stays canonical (480) so the general lands on its LARP year.
      expect(inserted[0].endTurn).toBe(480);
      expect(new Date(inserted[0].endTime!).getTime()).toBe(
        now.getTime() + (480 - currentTurn) * MS
      );
    });

    it("does NOT let an admin-accelerated cycle drag the LARP calendar", async () => {
      // Admin accelerated cycle 1 to resolve at turn 100 (canonical was 240).
      // Cycle 2 must still end at canonical 240 + 240 = 480.
      const currentTurn = 101;
      const now = new Date("2026-04-01T00:00:00Z");
      const regions = ["DB"];

      const resolved: Election = {
        _id: new ObjectId(),
        countryId: "CN",
        electionType: "npcDelegate",
        state: "DB",
        cycle: 1,
        status: "resolved",
        endTime: new Date(now.getTime() - 1 * MS), // turn 100
        durationHours: 10, // admin-shortened
        updatedAt: new Date(now.getTime() - 1 * MS),
      } as Election;

      const mock = makeCNMockDb(regions, [], [resolved], currentTurn);
      await mountCNDb(mock);

      const { ensureCNElections } = await import("./perpetualElections");
      await ensureCNElections(now);

      const inserted = mock.insertCalls.flat();
      expect(inserted).toHaveLength(1);
      expect(inserted[0].cycle).toBe(2);
      // Primary opens immediately (active now); the calendar invariant is the endTurn.
      expect(inserted[0].status).toBe("active");
      expect(inserted[0].startTurn).toBe(currentTurn);
      // Cycle 2 must still end at canonical 480 regardless of the admin edit.
      expect(inserted[0].endTurn).toBe(480);
      expect(new Date(inserted[0].endTime!).getTime()).toBe(
        now.getTime() + (480 - currentTurn) * MS
      );
      expect(inserted[0].durationHours).toBe(48);
    });
  });

  describe("ensurePerpetualElections — senate per-state init", () => {
    // Regression guard for the gap noted in the 2026-05-27 design review (E1):
    // a US state with no senate history was silently skipped when other states
    // had already completed senate elections (typical case: state admin-added
    // mid-game, or admin cleanup wiped that state's history). The fix in
    // ensurePerpetualElections adds a per-state init branch — for any state
    // listed in SENATE_CLASSES with no senate (live or completed), seed every
    // class it owns.
    function makeUSMockDb(
      usStateIds: string[],
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
        deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
        insertMany: vi.fn().mockImplementation((docs: Omit<Election, "_id">[]) => {
          insertCalls.push(docs);
          return Promise.resolve({ insertedIds: {} });
        }),
      };
      const statesCollection = {
        find: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue(usStateIds.map((id) => ({ _id: id }))),
        }),
        findOne: vi.fn().mockResolvedValue({ stateSenateSeats: 40 }),
      };
      const gameStateCollection = {
        findOne: vi.fn().mockResolvedValue({ currentTurn }),
      };
      return { electionsCollection, statesCollection, gameStateCollection, insertCalls };
    }

    async function mountUSDb(mock: ReturnType<typeof makeUSMockDb>) {
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

    it("seeds both senate classes for a state with no senate history when other states already have completed senate (per-state init)", async () => {
      // Setup: AL has completed senate class 2 (anyStateHasCompletedSenate=true).
      // CA has NO senate at all (no live, no completed). Without the per-state
      // init branch, CA would be silently skipped because !isBootstrap.
      // AL's classes are [2, 3]; CA's classes are [1, 3].
      const currentTurn = 100;
      const now = new Date("2026-04-01T00:00:00Z");
      const alSenateCompleted: Election = {
        _id: new ObjectId(),
        countryId: "US",
        electionType: "senate",
        state: "AL",
        senateClass: 2,
        cycle: 1,
        status: "resolved",
        endTime: new Date(now.getTime() - 24 * 3_600_000),
        durationHours: 288,
        updatedAt: new Date(now.getTime() - 24 * 3_600_000),
      } as Election;

      const mock = makeUSMockDb(["AL", "CA"], [], [alSenateCompleted], currentTurn);
      await mountUSDb(mock);

      const { ensurePerpetualElections } = await import("./perpetualElections");
      await ensurePerpetualElections(now, currentTurn);

      const senateInserts = mock.insertCalls.flat().filter((d) => d.electionType === "senate");

      // CA per-state init: both CA classes (1 and 3) should be spawned.
      // This is the regression guard for the gap fixed by per-state init.
      const caClasses = senateInserts
        .filter((d) => d.state === "CA")
        .map((d) => d.senateClass)
        .sort();
      expect(caClasses).toEqual([1, 3]);
    });

    it("does NOT trigger per-state init when a state already has senate (live or completed)", async () => {
      // Scope guard: per-state init must only fire when the state has zero
      // senate history. A state with class 1 live and class 3 live should
      // produce no new senate inserts even though anyStateHasCompletedSenate
      // is false (bootstrap-only path would otherwise try to seed it).
      const currentTurn = 100;
      const now = new Date("2026-04-01T00:00:00Z");
      // CA's classes: [1, 3]. AL's classes: [2, 3]. Cover all 4 live.
      const liveCA1: Election = {
        _id: new ObjectId(),
        countryId: "US",
        electionType: "senate",
        state: "CA",
        senateClass: 1,
        cycle: 2,
        status: "active",
        endTime: new Date(now.getTime() + 100 * 3_600_000),
        durationHours: 288,
        updatedAt: now,
      } as Election;
      const liveCA3: Election = {
        _id: new ObjectId(),
        countryId: "US",
        electionType: "senate",
        state: "CA",
        senateClass: 3,
        cycle: 2,
        status: "active",
        endTime: new Date(now.getTime() + 100 * 3_600_000),
        durationHours: 288,
        updatedAt: now,
      } as Election;
      const liveAL2: Election = {
        _id: new ObjectId(),
        countryId: "US",
        electionType: "senate",
        state: "AL",
        senateClass: 2,
        cycle: 2,
        status: "active",
        endTime: new Date(now.getTime() + 100 * 3_600_000),
        durationHours: 288,
        updatedAt: now,
      } as Election;
      const liveAL3: Election = {
        _id: new ObjectId(),
        countryId: "US",
        electionType: "senate",
        state: "AL",
        senateClass: 3,
        cycle: 2,
        status: "active",
        endTime: new Date(now.getTime() + 100 * 3_600_000),
        durationHours: 288,
        updatedAt: now,
      } as Election;

      const mock = makeUSMockDb(
        ["AL", "CA"],
        [liveCA1, liveCA3, liveAL2, liveAL3],
        [],
        currentTurn
      );
      await mountUSDb(mock);

      const { ensurePerpetualElections } = await import("./perpetualElections");
      await ensurePerpetualElections(now, currentTurn);

      const senateInserts = mock.insertCalls.flat().filter((d) => d.electionType === "senate");
      expect(senateInserts).toHaveLength(0);
    });
  });
});
