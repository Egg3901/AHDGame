import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/discordWebhooks", () => ({
  sendCountryGameEvent: vi.fn().mockResolvedValue(undefined),
  DISCORD_COLORS: { govCollapsed: 0, govFormed: 0 },
}));
vi.mock("@/lib/turn/parliamentaryGovernment", async () => {
  const actual = await vi.importActual<typeof import("@/lib/turn/parliamentaryGovernment")>(
    "@/lib/turn/parliamentaryGovernment"
  );
  return {
    ...actual,
    resetParliamentaryGovernmentAfterElection: vi.fn().mockResolvedValue(undefined),
    unformGovernmentAndVacatePM: vi.fn().mockResolvedValue(undefined),
    failInProgressBills: vi.fn().mockResolvedValue(0),
  };
});

import { triggerSnapElection, SnapElectionError } from "./snapElection";

let db: MockDb;

function setupMocks(opts: {
  currentTurn: number;
  govDoc: {
    _id: string;
    countryId: string;
    status: string;
    pmCharacterId: unknown;
    snapElectionsUsed?: number;
    lastSnapElectionTurn?: number | null;
  };
  regions?: Array<{ _id: string }>;
  seats?: Array<{ state: string; totalSeats: number }>;
  priorElections?: Array<{ state: string; electionType: string; cycle: number }>;
}) {
  db = createMockDb();
  // gameState
  db.collectionMocks["gameState"] = {
    ...db.collection("gameState"),
    findOne: vi.fn().mockResolvedValue({ _id: "current", currentTurn: opts.currentTurn }),
  } as MockDb["collectionMocks"][string];

  // governmentFormations
  db.collectionMocks["governmentFormations"] = {
    ...db.collection("governmentFormations"),
    findOne: vi.fn().mockResolvedValue(opts.govDoc),
    updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
  } as MockDb["collectionMocks"][string];

  // elections — find (to-cancel, returns ids), updateMany (cancel by _id),
  // find (prior elections for cycle inheritance), insertMany (spawn snaps).
  const cancelTargets = [{ _id: new ObjectId() }, { _id: new ObjectId() }];
  const toCancelCursor = {
    toArray: vi.fn().mockResolvedValue(cancelTargets),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
  const priorCursor = {
    toArray: vi.fn().mockResolvedValue(opts.priorElections ?? []),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
  db.collectionMocks["elections"] = {
    ...db.collection("elections"),
    updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    find: vi.fn().mockImplementation((query: Record<string, unknown>) => {
      const status = query?.status as { $in?: string[] } | undefined;
      const wantsActiveUpcoming =
        Array.isArray(status?.$in) &&
        status!.$in!.includes("active") &&
        status!.$in!.includes("upcoming");
      return wantsActiveUpcoming ? toCancelCursor : priorCursor;
    }),
    insertMany: vi.fn().mockResolvedValue({ insertedIds: {} }),
  } as MockDb["collectionMocks"][string];

  // electionCandidates — orphan-row cleanup target.
  db.collectionMocks["electionCandidates"] = {
    ...db.collection("electionCandidates"),
    updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
  } as MockDb["collectionMocks"][string];

  // bills
  db.collectionMocks["bills"] = {
    ...db.collection("bills"),
    updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
  } as MockDb["collectionMocks"][string];

  // states
  const regionsCursor = {
    toArray: vi.fn().mockResolvedValue(opts.regions ?? []),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
  db.collectionMocks["states"] = {
    ...db.collection("states"),
    find: vi.fn().mockReturnValue(regionsCursor),
  } as MockDb["collectionMocks"][string];

  // seats
  const seatsCursor = {
    toArray: vi.fn().mockResolvedValue((opts.seats ?? []).map((s) => ({ ...s }))),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
  db.collectionMocks["seats"] = {
    ...db.collection("seats"),
    find: vi.fn().mockReturnValue(seatsCursor),
  } as MockDb["collectionMocks"][string];
}

beforeEach(async () => {
  vi.clearAllMocks();
  const { getDb } = await import("@/lib/mongodb");
  setupMocks({
    currentTurn: 100,
    govDoc: {
      _id: "JP",
      countryId: "JP",
      status: "formed",
      pmCharacterId: new ObjectId(),
      snapElectionsUsed: 0,
      lastSnapElectionTurn: null,
    },
    regions: [{ _id: "tokyo" }, { _id: "osaka" }],
    seats: [
      { state: "tokyo", totalSeats: 25 },
      { state: "osaka", totalSeats: 19 },
    ],
  });
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
});

describe("triggerSnapElection", () => {
  it("spawns snap_shugiin elections and increments counters for JP", async () => {
    const result = await triggerSnapElection(db as unknown as Db, "JP", new Date(), {
      reason: "pm-trigger",
    });

    expect(result.electionsSpawned).toBe(2);
    expect(result.snapElectionType).toBe("snap_shugiin");
    expect(result.snapElectionsUsed).toBe(1);
    expect(result.snapElectionsRemaining).toBe(1);

    const insertCall = db.collectionMocks["elections"]!.insertMany.mock.calls[0]?.[0];
    expect(insertCall).toHaveLength(2);
    expect(insertCall[0].electionType).toBe("snap_shugiin");
    expect(insertCall[0].countryId).toBe("JP");
    expect(insertCall[0].cycle).toBe(1);

    const govUpdate = db.collectionMocks["governmentFormations"]!.updateOne.mock.calls[0];
    expect(govUpdate[1].$set.snapElectionsUsed).toBe(1);
    expect(govUpdate[1].$set.lastSnapElectionTurn).toBe(100);
  });

  it("cancels in-progress regular elections by id and withdraws their candidate rows", async () => {
    await triggerSnapElection(db as unknown as Db, "JP", new Date(), { reason: "pm-trigger" });

    // Elections collection was queried for active/upcoming shugiin races to cancel.
    const findCalls = db.collectionMocks["elections"]!.find.mock.calls;
    const cancelLookup = findCalls.find(
      (c: unknown[]) =>
        (c[0] as { electionType?: string; status?: { $in?: string[] } })?.electionType === "shugiin"
    );
    expect(cancelLookup).toBeDefined();

    // Cancel updateMany targets the captured ids.
    const cancelCall = db.collectionMocks["elections"]!.updateMany.mock.calls[0];
    expect(cancelCall[0]).toHaveProperty("_id.$in");
    expect(cancelCall[1].$set.status).toBe("cancelled");

    // Candidate rows on the cancelled elections must be withdrawn so they
    // don't block re-slating in the new snap race (bug #0550).
    const candCall = db.collectionMocks["electionCandidates"]!.updateMany.mock.calls[0];
    expect(candCall[0]).toMatchObject({ status: "active" });
    expect(candCall[0]).toHaveProperty("electionId.$in");
    expect(candCall[1].$set.status).toBe("withdrawn");
    expect(candCall[1].$set.withdrawnAt).toBeInstanceOf(Date);
  });

  it("fails in-progress bills (via failInProgressBills helper)", async () => {
    const now = new Date();
    await triggerSnapElection(db as unknown as Db, "JP", now, { reason: "pm-trigger" });
    const { failInProgressBills } = await import("@/lib/turn/parliamentaryGovernment");
    expect(failInProgressBills).toHaveBeenCalledWith(expect.anything(), "JP", now);
  });

  it("throws SnapElectionError when limit reached and bypassLimits is false", async () => {
    setupMocks({
      currentTurn: 100,
      govDoc: {
        _id: "JP",
        countryId: "JP",
        status: "formed",
        pmCharacterId: new ObjectId(),
        snapElectionsUsed: 2,
      },
      regions: [{ _id: "tokyo" }],
    });
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    await expect(
      triggerSnapElection(db as unknown as Db, "JP", new Date(), { reason: "pm-trigger" })
    ).rejects.toThrow(SnapElectionError);
    await expect(
      triggerSnapElection(db as unknown as Db, "JP", new Date(), { reason: "pm-trigger" })
    ).rejects.toThrow(/limit/i);
  });

  it("bypasses limit and cooldown when bypassLimits is true", async () => {
    setupMocks({
      currentTurn: 100,
      govDoc: {
        _id: "JP",
        countryId: "JP",
        status: "formed",
        pmCharacterId: new ObjectId(),
        snapElectionsUsed: 2,
        lastSnapElectionTurn: 99,
      },
      regions: [{ _id: "tokyo" }],
      seats: [{ state: "tokyo", totalSeats: 25 }],
    });
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const result = await triggerSnapElection(db as unknown as Db, "JP", new Date(), {
      reason: "auto-snap",
      bypassLimits: true,
    });
    expect(result.electionsSpawned).toBe(1);
  });

  it("throws SnapElectionError when cooldown is active", async () => {
    setupMocks({
      currentTurn: 200,
      govDoc: {
        _id: "JP",
        countryId: "JP",
        status: "formed",
        pmCharacterId: new ObjectId(),
        snapElectionsUsed: 1,
        lastSnapElectionTurn: 100, // 100 turns ago, cooldown is 336
      },
      regions: [{ _id: "tokyo" }],
    });
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    await expect(
      triggerSnapElection(db as unknown as Db, "JP", new Date(), { reason: "pm-trigger" })
    ).rejects.toThrow(/cooldown/i);
  });

  it("throws when country does not allow snap elections", async () => {
    setupMocks({
      currentTurn: 100,
      govDoc: {
        _id: "US",
        countryId: "US",
        status: "formed",
        pmCharacterId: new ObjectId(),
      },
    });
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    await expect(
      triggerSnapElection(db as unknown as Db, "US", new Date(), { reason: "admin" })
    ).rejects.toThrow(/not allowed/i);
  });

  it("uses snap_commons election type for UK", async () => {
    setupMocks({
      currentTurn: 100,
      govDoc: {
        _id: "UK",
        countryId: "UK",
        status: "formed",
        pmCharacterId: new ObjectId(),
        snapElectionsUsed: 0,
      },
      regions: [{ _id: "ENG" }],
      seats: [{ state: "ENG", totalSeats: 500 }],
    });
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const result = await triggerSnapElection(db as unknown as Db, "UK", new Date(), {
      reason: "pm-trigger",
    });
    expect(result.snapElectionType).toBe("snap_commons");
    const insertCall = db.collectionMocks["elections"]!.insertMany.mock.calls[0]?.[0];
    expect(insertCall[0].electionType).toBe("snap_commons");
  });

  it("continues cycle numbering from prior election", async () => {
    setupMocks({
      currentTurn: 100,
      govDoc: {
        _id: "JP",
        countryId: "JP",
        status: "formed",
        pmCharacterId: new ObjectId(),
        snapElectionsUsed: 0,
      },
      regions: [{ _id: "tokyo" }],
      seats: [{ state: "tokyo", totalSeats: 25 }],
      priorElections: [{ state: "tokyo", electionType: "shugiin", cycle: 3 }],
    });
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    await triggerSnapElection(db as unknown as Db, "JP", new Date(), { reason: "pm-trigger" });
    const insertCall = db.collectionMocks["elections"]!.insertMany.mock.calls[0]?.[0];
    expect(insertCall[0].cycle).toBe(4);
  });
});

describe("triggerSnapElection — VONC-active gate (Goal 2)", () => {
  function setupGateMocks(opts: {
    activeVonc: Record<string, unknown> | null;
    currentTurn?: number;
  }) {
    db = createMockDb();
    db.collectionMocks["gameState"] = {
      ...db.collection("gameState"),
      findOne: vi.fn().mockResolvedValue({ _id: "current", currentTurn: opts.currentTurn ?? 100 }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["governmentFormations"] = {
      ...db.collection("governmentFormations"),
      findOne: vi.fn().mockResolvedValue({
        _id: "UK",
        countryId: "UK",
        status: "formed",
        pmCharacterId: new ObjectId(),
        snapElectionsUsed: 0,
        lastSnapElectionTurn: null,
      }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["noConfidenceVotes"] = {
      ...db.collection("noConfidenceVotes"),
      findOne: vi.fn().mockResolvedValue(opts.activeVonc),
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["elections"] = {
      ...db.collection("elections"),
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
        sort: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      }),
      insertMany: vi.fn().mockResolvedValue({ insertedIds: {} }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["electionCandidates"] = {
      ...db.collection("electionCandidates"),
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["bills"] = {
      ...db.collection("bills"),
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["states"] = {
      ...db.collection("states"),
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
        sort: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks["seats"] = {
      ...db.collection("seats"),
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
    } as MockDb["collectionMocks"][string];
  }

  it("throws SnapElectionError when PM-triggered snap runs with an active VONC", async () => {
    setupGateMocks({
      activeVonc: { _id: new ObjectId(), countryId: "UK", status: "active" },
    });

    await expect(
      triggerSnapElection(db as unknown as Db, "UK", new Date(), { reason: "pm-trigger" })
    ).rejects.toThrow(SnapElectionError);

    // Zero side effects on gate failure
    expect(db.collectionMocks["elections"].updateMany).not.toHaveBeenCalled();
    expect(db.collectionMocks["bills"].updateMany).not.toHaveBeenCalled();
    expect(db.collectionMocks["governmentFormations"].updateOne).not.toHaveBeenCalled();
  });

  it("allows admin-triggered snap even with an active VONC (bypassLimits)", async () => {
    setupGateMocks({
      activeVonc: { _id: new ObjectId(), countryId: "UK", status: "active" },
    });

    await expect(
      triggerSnapElection(db as unknown as Db, "UK", new Date(), {
        reason: "admin",
        bypassLimits: true,
      })
    ).resolves.toBeDefined();
  });

  it("PM-triggered snap succeeds when VONC doc is in a non-active status", async () => {
    // Gate queries only status: "active" — this filter returns null.
    setupGateMocks({ activeVonc: null });

    await expect(
      triggerSnapElection(db as unknown as Db, "UK", new Date(), { reason: "pm-trigger" })
    ).resolves.toBeDefined();
  });
});
