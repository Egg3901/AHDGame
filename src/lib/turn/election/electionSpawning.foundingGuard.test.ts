import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

import { spawnHouseElection, spawnCommonsElection } from "./electionSpawning";
import type { Election } from "@/lib/db/types";

/**
 * Regression guard for the founding-phase re-spawn loop.
 *
 * These spawners run from `generalResolution` the moment a race resolves, so
 * they sit OUTSIDE the `electionCoverageAndSuccession` suppression that
 * `turnPhaseRegistry` applies while `preIteration.active` is set. Before the
 * guard, resolving a founding race handed `pickNextCanonicalCycle` a still-set
 * `preIterationActive` and got back ANOTHER cycle 0 — so
 * `detectPreIterationComplete` (which ends the phase only when no
 * active/upcoming cycle-0 race remains) could never fire and the calendar
 * stayed pinned to the era's starting year forever.
 */
function setup(db: MockDb, gameState: Record<string, unknown>): void {
  const elections = db.collection("elections");
  // No live successor exists — the pre-guard code path would proceed to spawn.
  elections.findOne = vi.fn().mockResolvedValue(null);
  elections.insertOne = vi.fn().mockResolvedValue({ insertedId: new ObjectId() });
  db.collection("gameState").findOne = vi.fn().mockResolvedValue(gameState);
}

function resolvedFoundingRace(electionType: "house" | "commons"): Election {
  return {
    _id: new ObjectId(),
    countryId: electionType === "commons" ? "UK" : "US",
    electionType,
    state: electionType === "commons" ? "LON" : "TX",
    cycle: 0,
    status: "resolved",
    totalSeats: 1,
    endTime: new Date("2026-01-02T00:00:00Z"),
  } as unknown as Election;
}

describe("post-resolution spawners during the pre-iteration founding phase", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as never);
  });

  it("does not spawn a replacement House election while the founding phase is active", async () => {
    setup(db, {
      _id: "current",
      currentTurn: 49,
      preset: "1953-default",
      startingYear: 1953,
      preIteration: { active: true, startedTurn: 1 },
    });

    await spawnHouseElection(db as never, resolvedFoundingRace("house"), new Date());

    expect(db.collection("elections").insertOne).not.toHaveBeenCalled();
  });

  it("does not spawn a replacement Commons election while the founding phase is active", async () => {
    setup(db, {
      _id: "current",
      currentTurn: 49,
      preset: "1953-default",
      startingYear: 1953,
      preIteration: { active: true, startedTurn: 1 },
    });

    await spawnCommonsElection(db as never, resolvedFoundingRace("commons"), new Date());

    expect(db.collection("elections").insertOne).not.toHaveBeenCalled();
  });

  it("still spawns the next cycle once the founding phase has ended", async () => {
    setup(db, {
      _id: "current",
      currentTurn: 49,
      preset: "1953-default",
      startingYear: 1953,
      preIteration: { active: false, startedTurn: 1, completedTurn: 49 },
      preIterationTurns: 48,
    });

    await spawnHouseElection(db as never, resolvedFoundingRace("house"), new Date());

    expect(db.collection("elections").insertOne).toHaveBeenCalledTimes(1);
    const inserted = vi.mocked(db.collection("elections").insertOne).mock
      .calls[0][0] as unknown as Election;
    // The founding race was cycle 0, so the successor must be the real cycle 1 —
    // never another founding race.
    expect(inserted.cycle).toBe(1);
  });
});
