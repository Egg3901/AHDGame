/**
 * Focused tests for ensurePresidentialElection — verifies the atomic
 * findOneAndUpdate-with-upsert pattern that prevents duplicate election
 * docs when two admins trigger the spawn button concurrently, and the
 * canonical-LARP fields (seatId, electionYear, cycle) populated on insert.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Election } from "@/lib/db/types";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

interface ElectionsMock {
  findOne: ReturnType<typeof vi.fn>;
  findOneAndUpdate: ReturnType<typeof vi.fn>;
}

function mountDb(elections: ElectionsMock, gameState: { findOne: ReturnType<typeof vi.fn> }) {
  return async () => {
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "elections") return elections;
        if (name === "gameState") return gameState;
        return { findOne: vi.fn().mockResolvedValue(null) };
      }),
    } as never);
  };
}

describe("ensurePresidentialElection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns created=false with existing electionId when a doc already exists", async () => {
    const existingId = new ObjectId();
    const elections: ElectionsMock = {
      // The first findOne reads the latest completed/resolved race for cycle math.
      findOne: vi.fn().mockResolvedValue({ cycle: 7 }),
      // findOneAndUpdate with returnDocument:"before" returns the existing doc
      // when the filter matched (no insert happened).
      findOneAndUpdate: vi.fn().mockResolvedValue({
        _id: existingId,
        electionType: "president",
        status: "active",
        cycle: 7,
      } as Election),
    };
    const gameState = {
      findOne: vi
        .fn()
        .mockResolvedValue({ currentTurn: 1, startingYear: 2019, preset: "2019-default" }),
    };
    await mountDb(elections, gameState)();

    const { ensurePresidentialElection } = await import("./perpetualElections");
    const result = await ensurePresidentialElection(new Date("2026-01-01T00:00:00Z"));

    expect(result).toEqual({
      message: "A presidential election already exists.",
      electionId: existingId.toString(),
      created: false,
    });
    expect(elections.findOneAndUpdate).toHaveBeenCalledTimes(1);
    // Verify the upsert + setOnInsert call shape — canonical LARP fields are
    // populated so admin-spawned docs are indistinguishable from cron-spawned ones.
    const [filter, update, opts] = elections.findOneAndUpdate.mock.calls[0];
    // Filter is scoped to US so a concurrent-general country's (e.g. NG) active
    // president does not read as "already exists" and block US recovery.
    expect(filter).toEqual({
      electionType: "president",
      countryId: "US",
      status: { $in: ["active", "upcoming"] },
    });
    expect(update).toHaveProperty("$setOnInsert");
    expect(update.$setOnInsert).toMatchObject({
      electionType: "president",
      state: "US",
      countryId: "US",
      seatId: "US-president",
      cycle: 8, // latest 7 + 1
      electionYear: 2024 + 7 * 4, // 2019-default president anchor + 7 cycles × 4 years = 2052
    });
    expect(opts).toEqual({ upsert: true, returnDocument: "before" });
  });

  it("throws when the upsert read-back returns null (defensive path)", async () => {
    const elections: ElectionsMock = {
      // First call returns the latest completed/resolved cycle.
      // Second call (the read-back after insert) returns null — should never happen,
      // but guards against silent data loss if it does.
      findOne: vi
        .fn()
        .mockResolvedValueOnce({ cycle: 5 }) // cycle lookup
        .mockResolvedValueOnce(null), // read-back returns nothing
      findOneAndUpdate: vi.fn().mockResolvedValue(null),
    };
    const gameState = {
      findOne: vi
        .fn()
        .mockResolvedValue({ currentTurn: 1, startingYear: 2019, preset: "2019-default" }),
    };
    await mountDb(elections, gameState)();

    const { ensurePresidentialElection } = await import("./perpetualElections");
    await expect(ensurePresidentialElection(new Date("2026-01-01T00:00:00Z"))).rejects.toThrow(
      /Failed to read back/
    );
  });

  it("returns created=true with new electionId when no doc existed", async () => {
    const newId = new ObjectId();
    let upsertCalled = false;
    const elections: ElectionsMock = {
      findOne: vi.fn().mockImplementation(async (filter: Record<string, unknown>) => {
        // The completed/resolved query returns null (no prior election → cycle = 1)
        if (
          (filter.status as { $in?: string[] })?.$in?.includes("completed") ||
          (filter.status as { $in?: string[] })?.$in?.includes("resolved")
        ) {
          return null;
        }
        // After the upsert, the read-back returns the inserted doc.
        const statusFilter = filter.status as { $in?: string[] } | string | undefined;
        const isActiveOrUpcoming =
          typeof statusFilter === "object" &&
          statusFilter.$in?.includes("active") &&
          statusFilter.$in?.includes("upcoming");
        if (upsertCalled && isActiveOrUpcoming) {
          return { _id: newId, cycle: 1 };
        }
        return null;
      }),
      findOneAndUpdate: vi.fn().mockImplementation(async () => {
        upsertCalled = true;
        // returnDocument:"before" → null when an insert occurred
        return null;
      }),
    };
    const gameState = {
      findOne: vi
        .fn()
        .mockResolvedValue({ currentTurn: 1, startingYear: 2019, preset: "2019-default" }),
    };
    await mountDb(elections, gameState)();

    const { ensurePresidentialElection } = await import("./perpetualElections");
    const result = await ensurePresidentialElection(new Date("2026-01-01T00:00:00Z"));

    expect(result).toEqual({
      message: "Presidential election spawned.",
      electionId: newId.toString(),
      created: true,
    });
  });
});
