/**
 * Unit tests for ensurePerpetualElections gap-filling logic.
 *
 * Tests that the function correctly spawns elections when gaps are detected
 * and does not duplicate elections that already exist.
 *
 * Uses the shared createMockDb utility to avoid boilerplate.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Election } from "@/lib/db/types";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

describe("ensurePerpetualElections", () => {
  let db: MockDb;

  const CA_STATE = { _id: "CA" };
  const now = new Date("2026-01-01T00:00:00Z");

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    // Initialize all collections used by ensurePerpetualElections
    db.collection("states");
    db.collection("elections");
  });

  it("spawns a house election (status=active) when no live house election exists", async () => {
    // states returns CA; no active elections; no completed elections
    db.collectionMocks["states"].find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([CA_STATE]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });
    // findOne for state data (senate seats etc.)
    db.collectionMocks["states"].findOne.mockResolvedValue({ stateSenateSeat: 2 });

    db.collectionMocks["elections"].find.mockImplementation((_filter: Record<string, unknown>) => {
      // Both active/upcoming and completed queries return empty
      return {
        toArray: vi.fn().mockResolvedValue([]),
        sort: vi.fn().mockReturnThis(),
      };
    });
    db.collectionMocks["elections"].insertMany.mockResolvedValue({ insertedIds: {} });
    db.collectionMocks["elections"].deleteMany.mockResolvedValue({ deletedCount: 0 });

    const { ensurePerpetualElections } = await import("./perpetualElections");
    await ensurePerpetualElections(now, 1);

    const insertMany = db.collectionMocks["elections"].insertMany;
    expect(insertMany).toHaveBeenCalled();

    const [inserted] = vi.mocked(insertMany).mock.calls[0];
    const houseElection = (inserted as Omit<Election, "_id">[]).find(
      (e) => e.electionType === "house" && e.state === "CA"
    );
    expect(houseElection).toBeDefined();
    expect(houseElection?.status).toBe("active");
    expect(houseElection?.cycle).toBe(1);
  });

  it("bootstraps fresh elections at cycle 1 after an empty reset", async () => {
    db.collectionMocks["states"].find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([CA_STATE]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });
    db.collectionMocks["states"].findOne.mockResolvedValue({ stateSenateSeats: 52 });

    db.collectionMocks["elections"].find.mockImplementation((filter: Record<string, unknown>) => {
      if ("$or" in filter) {
        return { toArray: vi.fn().mockResolvedValue([]), sort: vi.fn().mockReturnThis() };
      }
      return {
        toArray: vi.fn().mockResolvedValue([]),
        sort: vi.fn().mockReturnThis(),
      };
    });
    db.collectionMocks["elections"].insertMany.mockResolvedValue({ insertedIds: {} });
    db.collectionMocks["elections"].deleteMany.mockResolvedValue({ deletedCount: 0 });
    db.collection("gameState");
    db.collectionMocks["gameState"].findOne.mockResolvedValue({ _id: "current", currentTurn: 1 });

    const { ensurePerpetualElections } = await import("./perpetualElections");
    await ensurePerpetualElections(now, 1);

    const [inserted] = vi.mocked(db.collectionMocks["elections"].insertMany).mock.calls[0];
    const docs = inserted as Omit<Election, "_id">[];

    expect(docs.find((e) => e.electionType === "house" && e.state === "CA")?.cycle).toBe(1);
    expect(
      docs.find((e) => e.electionType === "senate" && e.state === "CA" && e.senateClass === 1)
        ?.cycle
    ).toBe(1);
    expect(docs.find((e) => e.electionType === "governor" && e.state === "CA")?.cycle).toBe(1);
    expect(docs.find((e) => e.electionType === "stateSenate" && e.state === "CA")?.cycle).toBe(1);
    expect(docs.find((e) => e.electionType === "president")?.cycle).toBe(1);
  });

  it("does not spawn a house election when one is already active", async () => {
    const activeHouse: Partial<Election> = {
      _id: new ObjectId(),
      electionType: "house",
      state: "CA",
      status: "active",
      cycle: 1,
    };

    db.collectionMocks["states"].find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([CA_STATE]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });
    db.collectionMocks["states"].findOne.mockResolvedValue({ stateSenateSeat: 2 });

    db.collectionMocks["elections"].find.mockImplementation((filter: Record<string, unknown>) => {
      // Active election query returns the house election; completed returns empty
      const status = filter?.status as { $in?: string[] } | string | undefined;
      const statuses =
        typeof status === "object" && status !== null && "$in" in status ? status.$in : [];
      const isLiveQuery = Array.isArray(statuses) && statuses.includes("active");
      return {
        toArray: vi.fn().mockResolvedValue(isLiveQuery ? [activeHouse] : []),
        sort: vi.fn().mockReturnThis(),
      };
    });
    db.collectionMocks["elections"].insertMany.mockResolvedValue({ insertedIds: {} });
    db.collectionMocks["elections"].deleteMany.mockResolvedValue({ deletedCount: 0 });

    const { ensurePerpetualElections } = await import("./perpetualElections");
    await ensurePerpetualElections(now, 1);

    const insertMany = db.collectionMocks["elections"].insertMany;
    // insertMany might not be called at all, or if called, should not include CA house
    if (vi.mocked(insertMany).mock.calls.length > 0) {
      const [inserted] = vi.mocked(insertMany).mock.calls[0];
      const houseElection = (inserted as Omit<Election, "_id">[]).find(
        (e) => e.electionType === "house" && e.state === "CA"
      );
      expect(houseElection).toBeUndefined();
    }
  });

  it("spawns an active senate election when previous one completed", async () => {
    const completedSenate: Partial<Election> = {
      _id: new ObjectId(),
      electionType: "senate",
      state: "CA",
      senateClass: 1,
      status: "completed",
      cycle: 1,
      durationHours: 288,
      updatedAt: new Date("2025-01-01T00:00:00Z"),
    };

    db.collectionMocks["states"].find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([CA_STATE]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });
    db.collectionMocks["states"].findOne.mockResolvedValue({ stateSenateSeat: 2 });

    db.collectionMocks["elections"].find.mockImplementation((filter: Record<string, unknown>) => {
      // Deduplication query uses $or structure — no existing duplicates
      if ("$or" in filter) {
        return { toArray: vi.fn().mockResolvedValue([]), sort: vi.fn().mockReturnThis() };
      }
      const status = filter?.status as { $in?: string[] } | string | undefined;
      const statuses =
        typeof status === "object" && status !== null && "$in" in status ? status.$in : [];
      const isLiveQuery = Array.isArray(statuses) && statuses.includes("active");
      return {
        toArray: vi.fn().mockResolvedValue(isLiveQuery ? [] : [completedSenate]),
        sort: vi.fn().mockReturnThis(),
      };
    });
    db.collectionMocks["elections"].insertMany.mockResolvedValue({ insertedIds: {} });
    db.collectionMocks["elections"].deleteMany.mockResolvedValue({ deletedCount: 0 });

    const { ensurePerpetualElections } = await import("./perpetualElections");
    await ensurePerpetualElections(now, 1);

    const insertMany = db.collectionMocks["elections"].insertMany;
    expect(insertMany).toHaveBeenCalled();

    const [inserted] = vi.mocked(insertMany).mock.calls[0];
    const senateElection = (inserted as Omit<Election, "_id">[]).find(
      (e) => e.electionType === "senate" && e.state === "CA" && e.senateClass === 1
    );
    expect(senateElection).toBeDefined();
    expect(senateElection?.cycle).toBe(2);
    // Canonical LARP: Senate Class 1 cycle 2 endTurn = 240 + 288 = 528, startTurn = 240.
    // currentTurn=1 is well before startTurn, so the spawn is "upcoming" until the
    // canonical window opens — advanceElectionTimers will flip it to "active" then.
    expect(senateElection?.status).toBe("upcoming");
    expect(senateElection?.durationHours).toBe(288);
  });

  it("spawns the next presidential election with canonical timings instead of stale inherited ones", async () => {
    const completedPresident: Partial<Election> = {
      _id: new ObjectId(),
      electionType: "president",
      state: "US",
      status: "resolved",
      cycle: 4,
      durationHours: 120,
      primaryDurationHours: 72,
      // Well before `now` so the same-tick respawn gate doesn't fire — this
      // test targets canonical scheduling, not gate behavior.
      updatedAt: new Date("2024-01-01T00:00:00Z"),
    };

    db.collectionMocks["states"].find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([CA_STATE]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });
    db.collectionMocks["states"].findOne.mockResolvedValue({ stateSenateSeats: 52 });

    db.collectionMocks["elections"].find.mockImplementation((filter: Record<string, unknown>) => {
      if ("$or" in filter) {
        return { toArray: vi.fn().mockResolvedValue([]), sort: vi.fn().mockReturnThis() };
      }
      const status = filter?.status as { $in?: string[] } | string | undefined;
      const statuses =
        typeof status === "object" && status !== null && "$in" in status ? status.$in : [];
      const isLiveQuery = Array.isArray(statuses) && statuses.includes("active");
      return {
        toArray: vi.fn().mockResolvedValue(isLiveQuery ? [] : [completedPresident]),
        sort: vi.fn().mockReturnThis(),
      };
    });
    db.collectionMocks["elections"].insertMany.mockResolvedValue({ insertedIds: {} });
    db.collectionMocks["elections"].deleteMany.mockResolvedValue({ deletedCount: 0 });

    const { ensurePerpetualElections, DEFAULT_DURATIONS } = await import("./perpetualElections");
    await ensurePerpetualElections(now, 385);

    const [inserted] = vi.mocked(db.collectionMocks["elections"].insertMany).mock.calls[0];
    const presidentElection = (inserted as Omit<Election, "_id">[]).find(
      (e) => e.electionType === "president"
    );

    expect(presidentElection).toBeDefined();
    expect(presidentElection?.cycle).toBe(5);
    expect(presidentElection?.durationHours).toBe(DEFAULT_DURATIONS.president.durationHours);
    expect(presidentElection?.primaryDurationHours).toBe(
      DEFAULT_DURATIONS.president.primaryDurationHours
    );
  });
});
