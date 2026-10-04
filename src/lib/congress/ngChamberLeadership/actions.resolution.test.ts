import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn().mockResolvedValue({ currentTurn: 100, effectiveNow: new Date() }),
}));

describe("NG leadership election start during resolution recovery", () => {
  it("rejects a new cycle while the prior close claim is incomplete", async () => {
    const db: MockDb = createMockDb();
    db.collection("ngChamberLeadershipElections");
    db.collectionMocks.ngChamberLeadershipElections!.findOne.mockResolvedValue({
      _id: "speaker_ng_reps",
      status: "closed",
      startedAt: new Date("2026-01-01T00:00:00.000Z"),
      endsAt: new Date("2026-01-02T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      resolution: {
        id: "resolution-id",
        winner: null,
        resolvedAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    } as never);

    const { handleNgChamberLeadershipAction } = await import("./actions");
    await expect(
      handleNgChamberLeadershipAction({
        db: db as unknown as Db,
        partyMap: new Map(),
        role: "speaker_ng_reps",
        authUser: { userId: "000000000000000000000001", isAdmin: true },
        action: "start_election",
      })
    ).resolves.toEqual({
      success: false,
      error:
        "The previous election is still being resolved. Retry ending it before starting another.",
      status: 409,
    });

    expect(db.collectionMocks.ngChamberLeadershipElections!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.ngChamberLeadershipNominations).toBeUndefined();
  });

  it("clears the completed resolution journal when opening a new cycle", async () => {
    const db: MockDb = createMockDb();
    db.collection("ngChamberLeadershipElections");
    db.collection("ngChamberLeadershipNominations");
    db.collectionMocks.ngChamberLeadershipElections!.findOne.mockResolvedValue({
      _id: "speaker_ng_reps",
      status: "closed",
      startedAt: new Date("2026-01-01T00:00:00.000Z"),
      endsAt: new Date("2026-01-02T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      resolution: {
        id: new ObjectId(),
        winner: null,
        resolvedAt: new Date("2026-01-02T00:00:00.000Z"),
        completedAt: new Date("2026-01-02T00:00:01.000Z"),
      },
    } as never);

    const { handleNgChamberLeadershipAction } = await import("./actions");
    await expect(
      handleNgChamberLeadershipAction({
        db: db as unknown as Db,
        partyMap: new Map(),
        role: "speaker_ng_reps",
        authUser: { userId: "000000000000000000000001", isAdmin: true },
        action: "start_election",
      })
    ).resolves.toMatchObject({ success: true });

    expect(db.collectionMocks.ngChamberLeadershipElections!.updateOne).toHaveBeenCalledWith(
      { _id: "speaker_ng_reps" },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "voting" }),
        $unset: { resolution: "" },
      }),
      { upsert: true }
    );
  });
});
