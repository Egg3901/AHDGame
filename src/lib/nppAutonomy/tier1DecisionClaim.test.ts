import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { tier1DecisionTurnForCycle } from "./tier1DecisionSchedule";
import { claimTier1NppDecisionSlot } from "./tier1DecisionClaim";

describe("claimTier1NppDecisionSlot", () => {
  let db: MockDb;
  const now = new Date("2026-07-25T12:00:00Z");

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("countryGameStates");
  });

  it("claims a due cycle and writes the watermark", async () => {
    const turn = tier1DecisionTurnForCycle("BR", 2);
    db.collectionMocks.countryGameStates!.findOne.mockResolvedValue(null);
    db.collectionMocks.countryGameStates!.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
      upsertedCount: 1,
    });

    const verdict = await claimTier1NppDecisionSlot(db as unknown as Db, "BR", turn, now);
    expect(verdict.run).toBe(true);
    expect(verdict.completedCycle).toBe(2);
    expect(db.collectionMocks.countryGameStates!.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "BR" }),
      expect.objectContaining({
        $set: expect.objectContaining({ lastNppStrategicDecisionCycle: 2 }),
      }),
      { upsert: true }
    );
  });

  it("skips player-controlled decisions without claiming", async () => {
    const turn = tier1DecisionTurnForCycle("UK", 0);
    const verdict = await claimTier1NppDecisionSlot(db as unknown as Db, "UK", turn, now, {
      playerControlled: true,
    });
    expect(verdict.reason).toBe("player-controlled");
    expect(db.collectionMocks.countryGameStates!.updateOne).not.toHaveBeenCalled();
  });

  it("treats a lost CAS race as already-completed (no double-fire)", async () => {
    const turn = tier1DecisionTurnForCycle("JP", 1);
    db.collectionMocks.countryGameStates!.findOne.mockResolvedValue({
      _id: "JP",
      lastNppStrategicDecisionCycle: 0,
    });
    db.collectionMocks.countryGameStates!.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
      upsertedCount: 0,
    });

    const verdict = await claimTier1NppDecisionSlot(db as unknown as Db, "JP", turn, now);
    expect(verdict.run).toBe(false);
    expect(verdict.reason).toBe("already-completed");
  });

  it("does not claim on a non-due turn", async () => {
    const due = tier1DecisionTurnForCycle("DE", 0);
    const verdict = await claimTier1NppDecisionSlot(db as unknown as Db, "DE", due + 1, now);
    expect(verdict.reason).toBe("not-due");
    expect(db.collectionMocks.countryGameStates!.updateOne).not.toHaveBeenCalled();
  });
});
