import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { getEventHandler, getDefaultOptionId } from "@/lib/events/substrate/registry";
import { offerEvent } from "@/lib/events/substrate/offer";
import { resolveEvent } from "@/lib/events/substrate/resolve";
import { sweepExpired } from "@/lib/events/substrate/sweep";
import { countryScopeId } from "@/lib/events/substrate/countryScopeId";
import "./intlSummit";

describe("worldEvents.intlSummit — Phase 2 executive decision event", () => {
  let db: MockDb;
  const scopeId = countryScopeId("US");

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("eventInstances");
    db.collection("federalBudget");
    db.collection("financialTxLog");
    db.collection("governmentApprovals");
    db.collection("eventCooldownLedger");
    db.collection("countryModifiers");
  });

  it("registers three options with 'moderate' as the safe default (no treasuryDelta at all)", () => {
    const handler = getEventHandler("worldEvents.intlSummit");
    expect(handler).toBeDefined();
    expect(handler!.options.map((o) => o.id).sort()).toEqual([
      "assertive",
      "conciliatory",
      "moderate",
    ]);
    expect(handler!.defaultOptionId).toBe("moderate");
    expect(getDefaultOptionId("worldEvents.intlSummit")).toBe("moderate");
  });

  async function resolveOption(optionId: string) {
    db.collectionMocks.eventInstances!.findOne.mockResolvedValueOnce(null);
    const offered = await offerEvent(db as never, {
      kind: "worldEvents.intlSummit",
      scope: "country",
      scopeId,
      definitionVersion: 1,
      roll: 50,
      payload: { countryId: "US" },
      offeredAtTurn: 100,
      expiresAtRealtimeMs: Date.now() + 60_000,
    });
    db.collectionMocks.eventInstances!.findOne.mockResolvedValue({ ...offered, status: "pending" });
    db.collectionMocks.eventInstances!.findOneAndUpdate.mockResolvedValue({
      ...offered,
      status: "resolved",
      resolvedOptionId: optionId,
    });
    await resolveEvent(db as never, offered._id, optionId, "player", 100);
  }

  it("'assertive' raises approval and dents manufacturing demand", async () => {
    await resolveOption("assertive");
    expect(db.collectionMocks.governmentApprovals!.updateOne).toHaveBeenCalledWith(
      { _id: "US" },
      { $inc: { approvalRating: 3 } }
    );
    expect(db.collectionMocks.countryModifiers!.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ sectorType: "manufacturing", pct: -3 })
    );
  });

  it("'moderate' has no treasury or sector effect — never spends", async () => {
    await resolveOption("moderate");
    expect(db.collectionMocks.governmentApprovals!.updateOne).toHaveBeenCalledWith(
      { _id: "US" },
      { $inc: { approvalRating: 1 } }
    );
    expect(db.collectionMocks.federalBudget!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.countryModifiers!.insertOne).not.toHaveBeenCalled();
  });

  it("'conciliatory' costs approval but boosts manufacturing demand", async () => {
    await resolveOption("conciliatory");
    expect(db.collectionMocks.governmentApprovals!.updateOne).toHaveBeenCalledWith(
      { _id: "US" },
      { $inc: { approvalRating: -1 } }
    );
    expect(db.collectionMocks.countryModifiers!.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ sectorType: "manufacturing", pct: 3 })
    );
  });

  it("vacant-executive timeout sweeps to the safe 'moderate' default — no treasury writes", async () => {
    const offered = {
      _id: new ObjectId(),
      kind: "worldEvents.intlSummit",
      scope: "country" as const,
      scopeId,
      definitionVersion: 1,
      status: "pending" as const,
      roll: 50,
      payload: { countryId: "US" },
      offeredAtTurn: 90,
      offeredAt: new Date(),
      expiresAtRealtimeMs: Date.now() - 1_000,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    db.collectionMocks.eventInstances!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([offered]),
    });
    db.collectionMocks.eventInstances!.findOne.mockResolvedValue(offered);
    db.collectionMocks.eventInstances!.findOneAndUpdate.mockResolvedValue({
      ...offered,
      status: "expired",
      resolvedOptionId: "moderate",
      resolveReason: "timeout",
    });

    const result = await sweepExpired(db as never, 100);

    expect(result.skipped).toEqual([]);
    expect(result.swept[0]!.resolvedOptionId).toBe("moderate");
    expect(db.collectionMocks.federalBudget!.updateOne).not.toHaveBeenCalled();
  });
});
