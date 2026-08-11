import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("loadNPPContext", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("uses billDeadlineNow for bill voting window filters when provided", async () => {
    const gameNow = new Date("2026-04-29T15:00:00.000Z");
    const billDeadlineNow = new Date("2026-04-29T22:00:00.000Z");

    const { loadNPPContext } = await import("./context");
    await loadNPPContext(gameNow, { billDeadlineNow });

    const filter = db.collectionMocks["bills"]!.find.mock.calls[0][0] as {
      $or: Array<Record<string, unknown>>;
    };

    expect(filter.$or[0]).toEqual({ status: "active", votingEndsAt: { $gt: billDeadlineNow } });
    expect(filter.$or[1]).toEqual({
      status: "active_other",
      otherChamberVotingEndsAt: { $gt: billDeadlineNow },
    });
    expect(filter.$or[2]).toEqual({
      status: "veto_override",
      overrideVotingEndsAt: { $gt: billDeadlineNow },
    });
    expect(filter.$or[3]).toEqual({
      status: "override_shugiin",
      votingEndsAt: { $gt: billDeadlineNow },
    });
  });

  it("tracks NPP candidacies across ALL elections (incl. upcoming), not just active-status elections", async () => {
    // The unique partial index allows one active candidacy per character across
    // ANY election phase. nppCandidacies must mirror that, or Phase-1 incumbent
    // defense double-inserts and throws E11000. So the candidacy query must NOT
    // be scoped to active-status elections.
    const gameNow = new Date("2026-04-29T15:00:00.000Z");

    const { loadNPPContext } = await import("./context");
    await loadNPPContext(gameNow);

    const candidacyCalls = (
      db.collectionMocks["electionCandidates"]!.find.mock.calls as Array<
        [Record<string, unknown> | undefined]
      >
    )
      .map((c) => c[0])
      .filter(
        (f): f is Record<string, unknown> => !!f && f.isNPP === true && f.status === "active"
      );

    expect(candidacyCalls.length).toBeGreaterThan(0);
    for (const filter of candidacyCalls) {
      expect(filter).not.toHaveProperty("electionId");
    }
  });

  it("falls back to game-time now when billDeadlineNow is omitted", async () => {
    const gameNow = new Date("2026-04-29T15:00:00.000Z");

    const { loadNPPContext } = await import("./context");
    await loadNPPContext(gameNow);

    const filter = db.collectionMocks["bills"]!.find.mock.calls[0][0] as {
      $or: Array<Record<string, unknown>>;
    };

    expect(filter.$or[0]).toEqual({ status: "active", votingEndsAt: { $gt: gameNow } });
    expect(filter.$or[1]).toEqual({
      status: "active_other",
      otherChamberVotingEndsAt: { $gt: gameNow },
    });
  });
});
