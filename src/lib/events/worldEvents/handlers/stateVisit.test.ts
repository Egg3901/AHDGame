import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { getEventHandler, getDefaultOptionId } from "@/lib/events/substrate/registry";
import { offerEvent } from "@/lib/events/substrate/offer";
import { resolveEvent } from "@/lib/events/substrate/resolve";
import { sweepExpired } from "@/lib/events/substrate/sweep";
import { countryScopeId } from "@/lib/events/substrate/countryScopeId";
import "./stateVisit";

describe("worldEvents.stateVisit — Phase 2 executive decision event", () => {
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
  });

  it("registers three options with 'standard' as the safe/neutral default", () => {
    const handler = getEventHandler("worldEvents.stateVisit");
    expect(handler).toBeDefined();
    expect(handler!.options.map((o) => o.id).sort()).toEqual(["decline", "lavish", "standard"]);
    expect(handler!.defaultOptionId).toBe("standard");
    expect(getDefaultOptionId("worldEvents.stateVisit")).toBe("standard");
  });

  it("'lavish' costs the treasury and boosts approval", async () => {
    db.collectionMocks.eventInstances!.findOne.mockResolvedValueOnce(null);
    db.collectionMocks.federalBudget!.findOne.mockResolvedValue({
      countryId: "US",
      treasuryBalance: 1_000_000,
    });

    const offered = await offerEvent(db as never, {
      kind: "worldEvents.stateVisit",
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
      resolvedOptionId: "lavish",
    });

    await resolveEvent(db as never, offered._id, "lavish", "player", 100);

    expect(db.collectionMocks.governmentApprovals!.updateOne).toHaveBeenCalledWith(
      { _id: "US" },
      { $inc: { approvalRating: 4 } }
    );
    expect(db.collectionMocks.federalBudget!.updateOne).toHaveBeenCalledWith(
      { countryId: "US" },
      expect.objectContaining({ $set: expect.objectContaining({ treasuryBalance: 985_000 }) })
    );
    const txDoc = db.collectionMocks.financialTxLog!.insertOne.mock.calls[0][0];
    expect(txDoc.type).toBe("world_event_payout");
    expect(txDoc.amount).toBe(-15_000);
  });

  it("'standard' has zero treasury cost and a small approval bump", async () => {
    db.collectionMocks.eventInstances!.findOne.mockResolvedValueOnce(null);
    const offered = await offerEvent(db as never, {
      kind: "worldEvents.stateVisit",
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
      resolvedOptionId: "standard",
    });

    await resolveEvent(db as never, offered._id, "standard", "player", 100);

    expect(db.collectionMocks.governmentApprovals!.updateOne).toHaveBeenCalledWith(
      { _id: "US" },
      { $inc: { approvalRating: 1 } }
    );
    // deltaAnchor: 0 is a no-op short-circuit — no treasury/ledger writes at all.
    expect(db.collectionMocks.federalBudget!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.financialTxLog!.insertOne).not.toHaveBeenCalled();
  });

  it("'decline' costs approval but never the treasury", async () => {
    db.collectionMocks.eventInstances!.findOne.mockResolvedValueOnce(null);
    const offered = await offerEvent(db as never, {
      kind: "worldEvents.stateVisit",
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
      resolvedOptionId: "decline",
    });

    await resolveEvent(db as never, offered._id, "decline", "player", 100);

    expect(db.collectionMocks.governmentApprovals!.updateOne).toHaveBeenCalledWith(
      { _id: "US" },
      { $inc: { approvalRating: -2 } }
    );
    expect(db.collectionMocks.federalBudget!.updateOne).not.toHaveBeenCalled();
  });

  it("vacant-executive timeout sweeps to the safe 'standard' default — never treasury-negative", async () => {
    const offered = {
      _id: new ObjectId(),
      kind: "worldEvents.stateVisit",
      scope: "country" as const,
      scopeId,
      definitionVersion: 1,
      status: "pending" as const,
      roll: 50,
      payload: { countryId: "US" },
      offeredAtTurn: 90,
      offeredAt: new Date(),
      expiresAtRealtimeMs: Date.now() - 1_000, // already expired
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
      resolvedOptionId: "standard",
      resolveReason: "timeout",
    });

    const result = await sweepExpired(db as never, 100);

    expect(result.skipped).toEqual([]);
    expect(result.swept).toHaveLength(1);
    expect(result.swept[0]!.resolvedOptionId).toBe("standard");
    // "standard" has deltaAnchor 0 — proves the default path never touches the treasury negatively.
    expect(db.collectionMocks.federalBudget!.updateOne).not.toHaveBeenCalled();
  });
});
